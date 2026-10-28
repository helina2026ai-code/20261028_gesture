// Geometry uses world coordinates; horizontal motion uses mirrored screen x.
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));

function jointAngle(a, b, c) {
  const ab = distance(a, b);
  const bc = distance(b, c);
  if (ab * bc < 1e-10) return 0;
  const cosine = (ab * ab + bc * bc - distance(a, c) ** 2) / (2 * ab * bc);
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
}

function fingerState(points, mcp) {
  const [base, pip, dip, tip] = points.slice(mcp, mcp + 4);
  const pipAngle = jointAngle(base, pip, dip);
  const dipAngle = jointAngle(pip, dip, tip);
  const tipDistance = distance(points[0], tip);
  const jointDistance = distance(points[0], pip);
  if (pipAngle > 150 && dipAngle > 150 && tipDistance > jointDistance * 1.12) return "extended";
  if (pipAngle < 125 || tipDistance < jointDistance * 0.95) return "folded";
  return "uncertain";
}

export function classifyPose(points) {
  if (!Array.isArray(points) || points.length !== 21 || points.some((p) =>
    !Number.isFinite(p?.x) || !Number.isFinite(p?.y) || !Number.isFinite(p?.z ?? 0))) return "none";
  const [index, middle, ring, pinky] = [5, 9, 13, 17].map((base) => fingerState(points, base));
  // Thumb position is deliberately ignored for both single-finger commands.
  if ([index, middle, ring, pinky].every((state) => state === "extended")) return "palm";
  if (index === "extended" && [middle, ring, pinky].every((state) => state === "folded")) return "index";
  if (pinky === "extended" && [index, middle, ring].every((state) => state === "folded")) return "pinky";
  return "none";
}

export class GestureController {
  constructor({ holdMs = 450, releaseMs = 200, cooldownMs = 900, swipeDistance = 0.17,
    swipeWindowMs = 650, minSwipeMs = 130, maxVerticalDrift = 0.12 } = {}) {
    Object.assign(this, { holdMs, releaseMs, cooldownMs, swipeDistance, swipeWindowMs, minSwipeMs, maxVerticalDrift });
    this.reset();
  }

  reset() {
    this.samples = [];
    this.pose = "none";
    this.poseSince = null;
    this.latchedPose = null;
    this.releaseSince = null;
    this.cooldownUntil = -Infinity;
    this.lastTime = null;
    this.handId = null;
  }

  suppress(now) {
    this.cooldownUntil = now + this.cooldownMs;
    this.samples = [];
    this.poseSince = now;
  }

  update(hand, now) {
    const pose = hand ? classifyPose(hand.worldLandmarks ?? hand.landmarks) : "none";
    if (this.lastTime !== null && (now - this.lastTime > 250 || now < this.lastTime)) {
      this.samples = [];
      this.poseSince = now;
    }
    this.lastTime = now;
    if (hand && this.handId !== hand.id) {
      this.handId = hand.id;
      this.samples = [];
      this.poseSince = now;
    }
    if (pose !== this.pose || this.poseSince === null) {
      this.pose = pose;
      this.poseSince = now;
      this.samples = [];
    }
    // Require a deliberate release before a held finger can issue another command.
    if (pose !== this.latchedPose) {
      this.releaseSince ??= now;
      if (now - this.releaseSince >= this.releaseMs) this.latchedPose = null;
    } else {
      this.releaseSince = null;
    }
    if (now < this.cooldownUntil) {
      this.samples = [];
      return { pose, action: null };
    }
    if ((pose === "index" || pose === "pinky") && pose !== this.latchedPose && now - this.poseSince >= this.holdMs) {
      this.latchedPose = pose;
      this.releaseSince = null;
      this.suppress(now);
      return { pose, action: pose === "index" ? "first" : "last" };
    }
    if (pose !== "palm") return { pose, action: null };
    const palm = [0, 5, 9, 13, 17].map((index) => hand.landmarks[index]);
    if (palm.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      this.samples = [];
      return { pose, action: null };
    }
    const center = {
      x: 1 - palm.reduce((sum, point) => sum + point.x, 0) / palm.length,
      y: palm.reduce((sum, point) => sum + point.y, 0) / palm.length,
      time: now,
    };
    const previous = this.samples.at(-1);
    // Discontinuous detections are a new track, not a swipe.
    if (previous && Math.hypot(center.x - previous.x, center.y - previous.y) > 0.2) this.samples = [];
    this.samples.push(center);
    this.samples = this.samples.filter((sample) => now - sample.time <= this.swipeWindowMs);
    const first = this.samples[0];
    const dx = center.x - first.x;
    const verticalRange = Math.max(...this.samples.map((p) => p.y)) - Math.min(...this.samples.map((p) => p.y));
    const pathLength = this.samples.slice(1).reduce((sum, sample, index) => sum + Math.abs(sample.x - this.samples[index].x), 0);
    if (this.samples.length >= 3 && now - first.time >= this.minSwipeMs &&
      Math.abs(dx) >= this.swipeDistance && verticalRange <= this.maxVerticalDrift &&
      Math.abs(dx) / Math.max(pathLength, 1e-8) >= 0.8) {
      this.suppress(now);
      return { pose, action: dx < 0 ? "previous" : "next" };
    }
    return { pose, action: null };
  }
}
