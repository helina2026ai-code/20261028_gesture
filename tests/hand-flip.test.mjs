import test from "node:test";
import assert from "node:assert/strict";
import { HandFlipController, palmFacing } from "../static/hand-flip-controller.mjs";
import { SlideDeck } from "../static/gallery.mjs";

function hand(angle = 0, centerX = 0.5, { left = false, pose = "palm", id = "Right" } = {}) {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.8, z: 0 }));
  points[0] = { x: 0.5, y: 0.9, z: 0 };
  [5, 9, 13, 17].forEach((base, finger) => {
    const extended = pose === "palm" || (pose === "index" && finger === 0);
    const ys = extended ? [0.65, 0.5, 0.37, 0.24] : [0.65, 0.5, 0.6, 0.7];
    ys.forEach((y, joint) => { points[base + joint] = { x: 0.4 + finger * 0.065, y, z: 0 }; });
  });
  const palm = [0, 5, 9, 13, 17];
  const cx = palm.reduce((sum, index) => sum + points[index].x, 0) / 5;
  const cy = palm.reduce((sum, index) => sum + points[index].y, 0) / 5;
  const radians = angle * Math.PI / 180;
  const worldLandmarks = points.map((point) => {
    const x = (point.x - cx) * (left ? -1 : 1);
    return { x: x * Math.cos(radians), y: point.y - cy, z: -x * Math.sin(radians) };
  });
  return { id, worldLandmarks, landmarks: worldLandmarks.map((point) => ({ ...point, x: point.x + centerX, y: point.y + 0.55 })) };
}

function frames(controller, hands, start, end) {
  const outputs = [];
  for (let time = start; time <= end; time += 70) {
    outputs.push(controller.update(typeof hands === "function" ? hands(time) : hands, time));
  }
  return outputs;
}

test("palm normal distinguishes opposite sides and ignores edge-on or closed fingers", () => {
  for (const left of [false, true]) {
    const front = palmFacing(hand(0, 0.5, { left }));
    assert.equal(palmFacing(hand(180, 0.5, { left })), -front);
    assert.equal(palmFacing(hand(90, 0.5, { left })), 0);
  }
  assert.equal(palmFacing(hand(0, 0.5, { pose: "index" })), null);
  assert.equal(palmFacing({ landmarks: [] }), null);
});

test("initial appearance sets a reference; front/back turns each emit once", () => {
  const controller = new HandFlipController();
  assert.equal(frames(controller, [hand()], 0, 210).some((result) => result.flip), false);
  const edge = frames(controller, [hand(90)], 280, 350);
  assert(edge.every((result) => result.turning && !result.flip));
  assert.equal(frames(controller, [hand(180)], 420, 2100).filter((result) => result.flip).length, 1);
  assert.equal(frames(controller, [hand()], 2170, 2800).filter((result) => result.flip).length, 1);
});

test("both anatomical hands work without requiring an absolute palm-side label", () => {
  for (const left of [false, true]) {
    const controller = new HandFlipController();
    frames(controller, [hand(0, 0.5, { left })], 0, 210);
    assert.equal(frames(controller, [hand(180, 0.5, { left, id: "Changed label" })], 280, 700).filter((result) => result.flip).length, 1);
  }
});

test("two-hand turns coalesce once and stay matched when result order changes", () => {
  const controller = new HandFlipController();
  frames(controller, (time) => {
    const pair = [hand(0, 0.25), hand(0, 0.75, { left: true })];
    return time % 140 === 0 ? pair.reverse() : pair;
  }, 0, 210);
  const outputs = frames(controller, (time) => {
    const pair = [hand(180, 0.25, { id: "flipped" }), hand(180, 0.75, { left: true })];
    return time % 140 === 0 ? pair.reverse() : pair;
  }, 280, 1400);
  assert.equal(outputs.filter((result) => result.flip).length, 1);
});

test("either of two hands can trigger while the other stays still", () => {
  for (const active of [0, 1]) {
    const controller = new HandFlipController();
    frames(controller, [hand(0, 0.25), hand(0, 0.75)], 0, 210);
    const pair = [hand(active === 0 ? 180 : 0, 0.25), hand(active === 1 ? 180 : 0, 0.75)];
    assert.equal(frames(controller, pair, 280, 1400).filter((result) => result.flip).length, 1);
  }
});

test("slightly staggered two-hand turns do not cancel the visual flip", () => {
  const controller = new HandFlipController();
  frames(controller, [hand(0, 0.25), hand(0, 0.75)], 0, 210);
  const first = frames(controller, [hand(180, 0.25), hand(0, 0.75)], 280, 630);
  const second = frames(controller, [hand(180, 0.25), hand(180, 0.75)], 700, 2100);
  assert.equal([...first, ...second].filter((result) => result.flip).length, 1);
});

test("transient sign noise, horizontal translations and side-on holds do not flip", () => {
  const controller = new HandFlipController();
  frames(controller, [hand()], 0, 210);
  assert.equal(controller.update([hand(180)], 280).flip, false);
  assert.equal(frames(controller, [hand()], 350, 700).some((result) => result.flip), false);
  assert.equal(frames(controller, (time) => [hand(0, 0.3 + (time - 770) * 0.0003)], 770, 1400).some((result) => result.flip), false);
  assert.equal(frames(controller, [hand(90)], 1470, 2100).some((result) => result.flip), false);
});

test("long tracking gaps, jumps, overlapping hands and reset cannot cause a stale flip", () => {
  for (const mode of ["gap", "missing", "jump", "overlap", "reset"]) {
    const controller = new HandFlipController();
    frames(controller, [hand(0, 0.25)], 0, 210);
    let start = 280;
    let x = 0.25;
    if (mode === "gap") start = 700;
    if (mode === "missing") { frames(controller, [], 280, 700); start = 770; }
    if (mode === "jump") x = 0.8;
    if (mode === "overlap") {
      const output = controller.update([hand(180, 0.49), hand(180, 0.51)], 280);
      assert(output.overlapping && !output.flip);
      start = 350;
    }
    if (mode === "reset") controller.reset();
    assert.equal(frames(controller, [hand(180, x)], start, start + 700).some((result) => result.flip), false, mode);
  }
});

test("closing fingers clears the reference before returning with the other side", () => {
  const controller = new HandFlipController();
  frames(controller, [hand()], 0, 210);
  frames(controller, [hand(180, 0.5, { pose: "index" })], 280, 700);
  assert.equal(frames(controller, [hand(180)], 770, 1400).some((result) => result.flip), false);
});

test("in-plane hand rotation and an overly long edge-on pause do not count as a flip", () => {
  const rotated = hand();
  rotated.worldLandmarks = rotated.worldLandmarks.map((point) => ({ x: -point.y, y: point.x, z: point.z }));
  assert.equal(palmFacing(rotated), palmFacing(hand()));
  const controller = new HandFlipController();
  frames(controller, [hand()], 0, 210);
  assert.equal(frames(controller, [hand(90)], 280, 2520).some((result) => result.flip), false);
  assert.equal(frames(controller, [hand(180)], 2590, 3290).some((result) => result.flip), false);
});

test("manual suppression commits the new reference without a delayed duplicate", () => {
  const controller = new HandFlipController();
  frames(controller, [hand()], 0, 210);
  controller.suppress(280);
  assert.equal(frames(controller, [hand(180)], 280, 2100).some((result) => result.flip), false);
  assert.equal(frames(controller, [hand()], 2170, 2800).filter((result) => result.flip).length, 1);
});

test("mirror state belongs to each slide, preserves navigation, and resets for a new collection", () => {
  const deck = new SlideDeck();
  assert.equal(deck.isMirrored, false);
  assert.equal(deck.toggleMirror(), true);
  assert.equal(deck.index, 0);
  deck.navigate("next");
  assert.equal(deck.isMirrored, false);
  deck.navigate("previous");
  assert.equal(deck.isMirrored, true);
  assert.equal(deck.toggleMirror(), false);
  deck.toggleMirror();
  deck.setSlides([{ src: "new", title: "new image" }]);
  assert.equal(deck.isMirrored, false);
});
