import test from "node:test";
import assert from "node:assert/strict";
import { TwoHandController } from "../static/two-hand-controller.mjs";
import { SlideDeck } from "../static/gallery.mjs";

function hand(screenX, screenY = 0.5, { side = 1, pose = "palm" } = {}) {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.8, z: 0 }));
  points[0] = { x: 0.5, y: 0.9, z: 0 };
  [5, 9, 13, 17].forEach((base, finger) => {
    const ys = pose === "palm" ? [0.65, 0.5, 0.37, 0.24] : [0.65, 0.5, 0.6, 0.7];
    ys.forEach((y, joint) => { points[base + joint] = { x: 0.4 + finger * 0.065, y, z: 0 }; });
  });
  const palm = [0, 5, 9, 13, 17];
  const cx = palm.reduce((sum, index) => sum + points[index].x, 0) / 5;
  const cy = palm.reduce((sum, index) => sum + points[index].y, 0) / 5;
  const worldLandmarks = points.map((point) => ({ x: (point.x - cx) * side, y: point.y - cy, z: 0 }));
  return { worldLandmarks, landmarks: worldLandmarks.map((point) => ({ x: 1 - screenX + point.x, y: screenY + point.y, z: point.z })) };
}

const pair = (span = 0.4, dy = 0) => [hand(0.5 - span / 2, 0.5 - dy / 2), hand(0.5 + span / 2, 0.5 + dy / 2)];

function session(options = {}, initialView = { scale: 1, rotation: 0, aspectRatio: 4 / 3 }) {
  const controller = new TwoHandController(options);
  let view = { ...initialView };
  return { controller, get view() { return view; }, frame(hands, now, extras = {}) {
    const output = controller.update(hands, now, { ...view, ...extras });
    if (output.changed) view = { ...view, scale: output.scale, rotation: output.rotation };
    return output;
  }, feed(hands, start, end) {
    let output;
    for (let time = start; time <= end; time += 70) output = this.frame(hands, time);
    return output;
  } };
}

test("two open hands establish a reference without changing the current image view", () => {
  const s = session({}, { scale: 1.5, rotation: 30, aspectRatio: 4 / 3 });
  assert.equal(s.frame(pair(), 0).acquiring, true);
  assert.equal(s.frame(pair(), 70).changed, false);
  assert.equal(s.feed(pair(), 140, 560).active, true);
  assert.equal(s.view.scale, 1.5);
  assert.equal(s.view.rotation, 30);
});

test("pulling hands apart enlarges, moving closer shrinks, and pure horizontal motion does not rotate", () => {
  const s = session();
  s.feed(pair(), 0, 210);
  s.feed(pair(0.6), 280, 1400);
  assert(s.view.scale > 1.4 && s.view.scale < 1.5);
  assert.equal(s.view.rotation, 0);
  s.feed(pair(), 1470, 2800);
  assert(Math.abs(s.view.scale - 1) < 0.01);
});

test("screen-right hand higher rotates left, lower rotates right without changing scale", () => {
  for (const dy of [-0.3, 0.3]) {
    const s = session();
    s.feed(pair(), 0, 210);
    s.feed(pair(0.4, dy), 280, 1400);
    assert.equal(Math.sign(s.view.rotation), Math.sign(dy));
    assert(Math.abs(s.view.rotation) > 20);
    assert.equal(s.view.scale, 1);
  }
});

test("angle calculation respects the camera aspect ratio", () => {
  const s = session({ smoothing: 1 }, { scale: 1, rotation: 0, aspectRatio: 2 });
  s.feed(pair(), 0, 210);
  s.frame(pair(0.4, 0.3), 280);
  const expected = Math.atan2(0.3, 0.8) * 180 / Math.PI - 6;
  assert(Math.abs(s.view.rotation - expected) < 0.001);
});

test("model output order and both palm sides do not change control direction", () => {
  const a = session();
  const b = session();
  const reverse = (hands) => hands.map((entry) => ({ ...entry,
    worldLandmarks: entry.worldLandmarks.map((point) => ({ ...point, x: -point.x })) })).reverse();
  a.feed(pair(), 0, 210);
  b.feed(reverse(pair()), 0, 210);
  a.feed(pair(0.6, 0.2), 280, 1400);
  b.feed(reverse(pair(0.6, 0.2)), 280, 1400);
  assert(Math.abs(a.view.scale - b.view.scale) < 0.001);
  assert(Math.abs(a.view.rotation - b.view.rotation) < 0.001);
});

test("small palm jitter stays inside the scale and angle dead zones", () => {
  const s = session();
  s.feed(pair(), 0, 210);
  for (let frame = 0; frame < 40; frame++) s.frame(pair(0.4 + Math.sin(frame) * 0.01, Math.cos(frame) * 0.02), 280 + frame * 70);
  assert.equal(s.view.scale, 1);
  assert.equal(s.view.rotation, 0);
});

test("single hand, closed fingers, overlapped hands and invalid coordinates do not manipulate the view", () => {
  for (const hands of [[hand(0.5)], [hand(0.3, 0.5, { pose: "fist" }), hand(0.7)], pair(0.1), [{ landmarks: [] }, hand(0.7)]]) {
    const s = session();
    assert.equal(s.feed(hands, 0, 700).active, false);
    assert.equal(s.view.scale, 1);
    assert.equal(s.view.rotation, 0);
  }
});

test("reacquisition after a tracking gap, crossing or a palm-side change has no view jump", () => {
  for (const mode of ["gap", "lost", "cross", "side", "jump", "aspect"]) {
    const s = session();
    s.feed(pair(), 0, 210);
    let hands = pair(0.6, 0.2);
    let start = 280;
    if (mode === "gap") start = 700;
    if (mode === "lost") s.frame([], 250);
    if (mode === "cross") s.frame(pair(0.1), 250);
    if (mode === "side") hands = hands.map((entry) => ({ ...entry, worldLandmarks: entry.worldLandmarks.map((point) => ({ ...point, x: -point.x })) }));
    if (mode === "jump") hands = pair(0.9);
    if (mode === "aspect") s.frame(hands, start, { aspectRatio: 2 });
    s.feed(hands, start, start + 700);
    assert.equal(s.view.scale, 1, mode);
    assert.equal(s.view.rotation, 0, mode);
  }
});

test("manual suppression discards the previous reference and preserves the new view", () => {
  const s = session();
  s.feed(pair(), 0, 210);
  s.controller.suppress(280);
  assert.equal(s.feed(pair(0.7, 0.3), 280, 1120).active, false);
  s.feed(pair(0.7, 0.3), 1190, 1890);
  assert.equal(s.view.scale, 1);
  assert.equal(s.view.rotation, 0);
});

test("zoom limits are enforced and rotation wraps by the shortest path", () => {
  const s = session({ smoothing: 1 }, { scale: 2.9, rotation: 175, aspectRatio: 4 / 3 });
  s.feed(pair(), 0, 210);
  s.frame(pair(0.6, 0.3), 280);
  assert.equal(s.view.scale, 3);
  assert(s.view.rotation < -160 && s.view.rotation >= -180);
  s.frame(pair(0.18), 350);
  assert(s.view.scale >= 1 && s.view.scale <= 3);
});

test("view state is stored per slide, composes with mirrors, and reset preserves both mirrors", () => {
  const deck = new SlideDeck();
  deck.toggleMirror();
  deck.toggleVerticalMirror();
  deck.setView({ scale: 1.8, rotation: 45 });
  deck.navigate("next");
  assert.deepEqual(deck.view, { scale: 1, rotation: 0 });
  deck.navigate("previous");
  assert.deepEqual(deck.view, { scale: 1.8, rotation: 45 });
  deck.resetView();
  assert.deepEqual(deck.view, { scale: 1, rotation: 0 });
  assert(deck.isMirrored && deck.isVerticallyMirrored);
  deck.setView({ scale: 7, rotation: 370 });
  assert.deepEqual(deck.view, { scale: 3, rotation: 10 });
  assert.throws(() => deck.setView({ scale: NaN, rotation: 0 }));
  deck.setSlides([{ src: "new", title: "new" }]);
  assert.deepEqual(deck.view, { scale: 1, rotation: 0 });
  assert(!deck.isMirrored && !deck.isVerticallyMirrored);
});
