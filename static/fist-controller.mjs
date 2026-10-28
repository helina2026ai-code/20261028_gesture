import { classifyPose } from "./gesture-controller.mjs";

// Reuse the model's Closed_Fist class so a thumbs-up is not treated as a fist.
export class FistController {
  constructor({ openMs = 200, holdMs = 450, cooldownMs = 900, scoreThreshold = 0.65,
    maxGapMs = 250, maxTransitionMs = 1800, matchDistance = 0.22 } = {}) {
    Object.assign(this, { openMs, holdMs, cooldownMs, scoreThreshold, maxGapMs, maxTransitionMs, matchDistance });
    this.reset();
  }

  clearTracking() {
    this.armed = false;
    this.openSince = null;
    this.lastOpen = null;
    this.fistSince = null;
    this.center = null;
  }

  reset() {
    this.clearTracking();
    this.lastTime = null;
    this.cooldownUntil = -Infinity;
  }

  suppress(now) {
    this.cooldownUntil = now + this.cooldownMs;
    this.clearTracking();
  }

  update(hands, now) {
    if (this.lastTime !== null && (now < this.lastTime || now - this.lastTime > this.maxGapMs)) this.clearTracking();
    this.lastTime = now;
    const points = hands.length === 1 ? hands[0].landmarks : null;
    if (!Array.isArray(points) || points.length !== 21 || points.some((point) => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))) {
      this.clearTracking();
      return { flip: false, closing: false, pose: "none" };
    }
    const palm = [0, 5, 9, 13, 17].map((index) => points[index]);
    const center = { x: palm.reduce((sum, point) => sum + point.x, 0) / 5, y: palm.reduce((sum, point) => sum + point.y, 0) / 5 };
    if (this.center && Math.hypot(center.x - this.center.x, center.y - this.center.y) > this.matchDistance) this.clearTracking();
    this.center = center;
    const gesture = hands[0].gesture;
    const isFist = gesture?.categoryName === "Closed_Fist" && Number.isFinite(gesture.score) && gesture.score >= this.scoreThreshold && gesture.score <= 1;
    const isOpen = !isFist && classifyPose(hands[0].worldLandmarks ?? points) === "palm";
    if (now < this.cooldownUntil) {
      this.clearTracking();
      return { flip: false, closing: false, pose: isFist ? "fist" : "none" };
    }
    if (isOpen) {
      this.openSince ??= now;
      this.lastOpen = now;
      this.fistSince = null;
      if (now - this.openSince >= this.openMs) this.armed = true;
      return { flip: false, closing: false, pose: "palm" };
    }
    this.openSince = null;
    if (this.lastOpen === null || now - this.lastOpen > this.maxTransitionMs) this.armed = false;
    if (!isFist || !this.armed) {
      this.fistSince = null;
      return { flip: false, closing: false, pose: isFist ? "fist" : "none" };
    }
    this.fistSince ??= now;
    if (now - this.fistSince >= this.holdMs) {
      this.suppress(now);
      return { flip: true, closing: false, pose: "fist" };
    }
    return { flip: false, closing: true, pose: "fist" };
  }
}
