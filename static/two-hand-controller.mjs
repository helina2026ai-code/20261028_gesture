import { palmFacing } from "./hand-flip-controller.mjs";

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const angleDifference = (value) => ((value + 180) % 360 + 360) % 360 - 180;
const withoutDeadZone = (value, threshold) => Math.sign(value) * Math.max(0, Math.abs(value) - threshold);

function measureHand(hand) {
  if (!Array.isArray(hand.landmarks) || hand.landmarks.length !== 21 || hand.landmarks.some((point) =>
    !Number.isFinite(point?.x) || !Number.isFinite(point?.y))) return null;
  const side = palmFacing(hand);
  if (side === null || side === 0) return null;
  const palm = [0, 5, 9, 13, 17].map((index) => hand.landmarks[index]);
  return { x: 1 - palm.reduce((sum, point) => sum + point.x, 0) / 5,
    y: palm.reduce((sum, point) => sum + point.y, 0) / 5, side };
}

export class TwoHandController {
  constructor({ stableMs = 200, maxGapMs = 250, minSpan = 0.16, maxStep = 0.2,
    scaleDeadZone = 0.06, angleDeadZone = 6, smoothing = 0.35, cooldownMs = 900 } = {}) {
    Object.assign(this, { stableMs, maxGapMs, minSpan, maxStep, scaleDeadZone, angleDeadZone, smoothing, cooldownMs });
    this.reset();
  }

  clearTracking() {
    this.previous = null;
    this.candidateSince = null;
    this.reference = null;
  }

  reset() {
    this.clearTracking();
    this.lastTime = null;
    this.cooldownUntil = -Infinity;
  }

  suppress(now) {
    this.clearTracking();
    this.cooldownUntil = now + this.cooldownMs;
  }

  update(hands, now, { scale = 1, rotation = 0, aspectRatio = 4 / 3 } = {}) {
    if (!Number.isFinite(scale) || !Number.isFinite(rotation) || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
      this.clearTracking();
      return { active: false, changed: false };
    }
    if (this.lastTime !== null && (now < this.lastTime || now - this.lastTime > this.maxGapMs)) this.clearTracking();
    this.lastTime = now;
    const pair = hands.length === 2 ? hands.map(measureHand) : [];
    if (pair.length !== 2 || pair.some((hand) => hand === null) || now < this.cooldownUntil) {
      this.clearTracking();
      return { active: false, changed: false };
    }
    // Screen ordering is independent of model order/handedness. Crossing hands
    // must pass the minimum-span gate and establish a fresh reference.
    pair.sort((a, b) => a.x - b.x);
    const span = pair[1].x - pair[0].x;
    if (span < this.minSpan) {
      this.clearTracking();
      return { active: false, changed: false };
    }
    if (this.previous && pair.some((hand, index) =>
      Math.hypot(hand.x - this.previous[index].x, hand.y - this.previous[index].y) > this.maxStep || hand.side !== this.previous[index].side)) {
      this.clearTracking();
    }
    if (this.reference && Math.abs(this.reference.aspectRatio - aspectRatio) > 0.01) this.clearTracking();
    this.previous = pair;
    this.candidateSince ??= now;
    // Normalize x/y to the same physical image units before computing the angle.
    const angle = Math.atan2(pair[1].y - pair[0].y, span * aspectRatio) * 180 / Math.PI;
    if (!this.reference) {
      if (now - this.candidateSince < this.stableMs) return { active: false, changed: false, acquiring: true };
      this.reference = { span, angle, scale, rotation, aspectRatio };
    }
    const scaleDelta = withoutDeadZone(span / this.reference.span - 1, this.scaleDeadZone);
    const rotationDelta = withoutDeadZone(angleDifference(angle - this.reference.angle), this.angleDeadZone);
    const targetScale = clamp(this.reference.scale * (1 + scaleDelta), 1, 3);
    const targetRotation = this.reference.rotation + rotationDelta;
    const nextScale = clamp(scale + (targetScale - scale) * this.smoothing, 1, 3);
    const nextRotation = angleDifference(rotation + angleDifference(targetRotation - rotation) * this.smoothing);
    return { active: true, changed: Math.abs(nextScale - scale) > 0.002 || Math.abs(angleDifference(nextRotation - rotation)) > 0.15,
      scale: nextScale, rotation: nextRotation };
  }
}
