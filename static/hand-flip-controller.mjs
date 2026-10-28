import { classifyPose } from "./gesture-controller.mjs";

const PALM = [0, 5, 9, 13, 17];
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function validPoints(points) {
  return Array.isArray(points) && points.length === 21 && points.every((point) =>
    Number.isFinite(point?.x) && Number.isFinite(point?.y) && Number.isFinite(point?.z ?? 0));
}

export function palmFacing(hand, threshold = 0.45) {
  const points = hand.worldLandmarks ?? hand.landmarks;
  if (!validPoints(points) || classifyPose(points) !== "palm") return null;
  const wrist = points[0];
  const vector = (point) => ({ x: point.x - wrist.x, y: point.y - wrist.y, z: (point.z ?? 0) - (wrist.z ?? 0) });
  const index = vector(points[5]);
  const pinky = vector(points[17]);
  const normal = {
    x: index.y * pinky.z - index.z * pinky.y,
    y: index.z * pinky.x - index.x * pinky.z,
    z: index.x * pinky.y - index.y * pinky.x,
  };
  const size = Math.hypot(normal.x, normal.y, normal.z);
  if (size < 1e-8) return null;
  // For a 2D-only fallback, also reject a collapsed palm triangle near edge-on.
  const armProduct = Math.hypot(index.x, index.y, index.z) * Math.hypot(pinky.x, pinky.y, pinky.z);
  if (armProduct < 1e-8 || size / armProduct < 0.12) return null;
  const facing = normal.z / size;
  return Math.abs(facing) >= threshold ? Math.sign(facing) : 0;
}

function matchTracks(hands, tracks, maxDistance) {
  // At most two hands: consider every assignment instead of depending on model order
  // or handedness labels, which can change while the palm turns over.
  const assignments = [];
  function visit(index, used, matches, cost) {
    if (index === hands.length) {
      assignments.push({ matches, cost, count: matches.filter(Boolean).length });
      return;
    }
    visit(index + 1, used, [...matches, null], cost + maxDistance + 0.04);
    for (const track of tracks) {
      const delta = distance(hands[index].center, track.center);
      if (!used.has(track) && delta <= maxDistance) {
        visit(index + 1, new Set([...used, track]), [...matches, track], cost + delta);
      }
    }
  }
  visit(0, new Set(), [], 0);
  assignments.sort((a, b) => a.cost - b.cost);
  const [best, second] = assignments;
  const ambiguous = second && best.count > 0 && best.count === second.count && second.cost - best.cost < 0.035;
  return ambiguous ? hands.map(() => null) : best.matches;
}

export class HandFlipController {
  constructor({ stableMs = 200, cooldownMs = 900, maxGapMs = 250, maxTurnMs = 1800,
    matchDistance = 0.22, minHandSeparation = 0.14 } = {}) {
    Object.assign(this, { stableMs, cooldownMs, maxGapMs, maxTurnMs, matchDistance, minHandSeparation });
    this.reset();
  }

  reset() {
    this.tracks = [];
    this.lastTime = null;
    this.cooldownUntil = -Infinity;
  }

  suppress(now) {
    this.cooldownUntil = now + this.cooldownMs;
  }

  update(input, now) {
    if (this.lastTime !== null && (now < this.lastTime || now - this.lastTime > this.maxGapMs)) this.tracks = [];
    this.lastTime = now;
    const hands = input.slice(0, 2).filter((hand) => validPoints(hand.landmarks)).map((hand) => ({
      ...hand,
      center: { x: PALM.reduce((sum, index) => sum + hand.landmarks[index].x, 0) / PALM.length,
        y: PALM.reduce((sum, index) => sum + hand.landmarks[index].y, 0) / PALM.length },
    }));
    if (hands.length === 2 && distance(hands[0].center, hands[1].center) < this.minHandSeparation) {
      this.tracks = [];
      return { flip: false, turning: true, overlapping: true };
    }
    const previous = this.tracks.filter((track) => now - track.lastSeen <= this.maxGapMs);
    const matches = matchTracks(hands, previous, this.matchDistance);
    let changed = false;
    let turning = false;
    const visible = hands.map((hand, index) => {
      const track = matches[index] ?? { side: null, candidate: null, candidateSince: now, turnSince: null, lastOpen: now };
      track.center = hand.center;
      track.lastSeen = now;
      const side = palmFacing(hand);
      if (side === null) {
        track.candidate = null;
        if (now - track.lastOpen > this.maxGapMs) track.side = null;
        return track;
      }
      track.lastOpen = now;
      if (side === 0 || (track.side !== null && side !== track.side)) {
        turning = true;
        track.turnSince ??= now;
      } else {
        track.turnSince = null;
      }
      if (track.turnSince !== null && now - track.turnSince > this.maxTurnMs) {
        track.side = null;
        track.candidate = null;
        track.turnSince = null;
      }
      if (side === 0) {
        track.candidate = null;
        return track;
      }
      if (side !== track.candidate) {
        track.candidate = side;
        track.candidateSince = now;
      }
      if (now - track.candidateSince >= this.stableMs) {
        if (track.side !== null && side !== track.side) changed = true;
        track.side = side;
        track.turnSince = null;
      }
      return track;
    });
    // Unseen tracks retain identity only briefly; their pending confirmation is cleared.
    const unseen = previous.filter((track) => !visible.includes(track)).map((track) => ({ ...track, candidate: null }));
    this.tracks = [...visible, ...unseen].slice(0, 2);
    const flip = changed && now >= this.cooldownUntil;
    // All tracks commit their new facing together, so two simultaneous turns emit once.
    if (flip) this.suppress(now);
    return { flip, turning, overlapping: false };
  }
}
