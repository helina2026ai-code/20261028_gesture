import test from "node:test";
import assert from "node:assert/strict";
import { FistController } from "../static/fist-controller.mjs";
import { SlideDeck } from "../static/gallery.mjs";

function hand(pose = "palm", { score = 0.95, dx = 0 } = {}) {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.8, z: 0 }));
  points[0] = { x: 0.5, y: 0.9, z: 0 };
  [5, 9, 13, 17].forEach((base, finger) => {
    const ys = pose === "palm" ? [0.65, 0.5, 0.37, 0.24] : [0.65, 0.5, 0.6, 0.7];
    ys.forEach((y, joint) => { points[base + joint] = { x: 0.4 + finger * 0.065, y, z: 0 }; });
  });
  return { worldLandmarks: points, landmarks: points.map((point) => ({ ...point, x: point.x + dx })),
    gesture: { categoryName: pose === "palm" ? "Open_Palm" : pose === "fist" ? "Closed_Fist" : pose, score } };
}

function feed(controller, hands, start, end) {
  const outputs = [];
  for (let time = start; time <= end; time += 70) outputs.push(controller.update(hands, time));
  return outputs;
}

test("initial fist and a fleeting open palm cannot trigger a vertical flip", () => {
  const controller = new FistController();
  assert.equal(feed(controller, [hand("fist")], 0, 2100).some((result) => result.flip), false);
  feed(controller, [hand()], 2170, 2240);
  assert.equal(feed(controller, [hand("fist")], 2310, 3010).some((result) => result.flip), false);
});

test("open palm then a stable fist emits once, and reopening rearms it", () => {
  const controller = new FistController();
  feed(controller, [hand()], 0, 210);
  const waiting = feed(controller, [hand("fist")], 280, 700);
  assert(waiting.every((result) => result.closing && !result.flip));
  assert.equal(feed(controller, [hand("fist")], 770, 1960).filter((result) => result.flip).length, 1);
  assert.equal(feed(controller, [hand("fist")], 2030, 2800).some((result) => result.flip), false);
  feed(controller, [hand()], 2870, 3150);
  assert.equal(feed(controller, [hand("fist")], 3220, 3920).filter((result) => result.flip).length, 1);
});

test("two hands cancel arming and a single fist afterward needs a new open palm", () => {
  const controller = new FistController();
  feed(controller, [hand()], 0, 210);
  assert.equal(feed(controller, [hand("fist"), hand("fist", { dx: 0.3 })], 280, 980).some((result) => result.flip), false);
  assert.equal(feed(controller, [hand("fist")], 1050, 1750).some((result) => result.flip), false);
  feed(controller, [hand()], 1820, 2100);
  assert.equal(feed(controller, [hand("fist")], 2170, 2870).filter((result) => result.flip).length, 1);
});

test("thumbs-up, low-confidence and malformed classifier results cannot flip", () => {
  for (const gesture of [
    { categoryName: "Thumb_Up", score: 0.99 }, { categoryName: "Closed_Fist", score: 0.4 },
    { categoryName: "Closed_Fist", score: NaN }, { categoryName: "Closed_Fist", score: 2 }, null,
  ]) {
    const controller = new FistController();
    feed(controller, [hand()], 0, 210);
    const other = { ...hand("fist"), gesture };
    assert.equal(feed(controller, [other], 280, 1400).some((result) => result.flip), false);
  }
});

test("a briefly detected fist must still meet the continuous hold duration", () => {
  const controller = new FistController();
  feed(controller, [hand()], 0, 210);
  feed(controller, [hand("fist")], 280, 490);
  controller.update([hand("fist", { score: 0.2 })], 560);
  assert.equal(feed(controller, [hand("fist")], 630, 1050).some((result) => result.flip), false);
  assert.equal(controller.update([hand("fist")], 1120).flip, true);
});

test("lost tracking, frame gaps, abrupt position changes and resets discard stale arming", () => {
  for (const mode of ["missing", "gap", "jump", "reset"]) {
    const controller = new FistController();
    feed(controller, [hand()], 0, 210);
    let start = 280;
    let dx = 0;
    if (mode === "missing") controller.update([], 240);
    if (mode === "gap") start = 700;
    if (mode === "jump") dx = 0.5;
    if (mode === "reset") controller.reset();
    assert.equal(feed(controller, [hand("fist", { dx })], start, start + 700).some((result) => result.flip), false, mode);
  }
});

test("manual control suppression requires a fresh open-and-close gesture", () => {
  const controller = new FistController();
  feed(controller, [hand()], 0, 210);
  controller.suppress(280);
  assert.equal(feed(controller, [hand("fist")], 280, 2100).some((result) => result.flip), false);
  feed(controller, [hand()], 2170, 2450);
  assert.equal(feed(controller, [hand("fist")], 2520, 3220).filter((result) => result.flip).length, 1);
});

test("waiting too long after an open palm expires arming", () => {
  const controller = new FistController();
  feed(controller, [hand()], 0, 210);
  feed(controller, [hand("Thumb_Up")], 280, 2240);
  assert.equal(feed(controller, [hand("fist")], 2310, 3010).some((result) => result.flip), false);
});

test("vertical and horizontal mirror states combine independently for each image", () => {
  const deck = new SlideDeck();
  assert.equal(deck.isVerticallyMirrored, false);
  assert.equal(deck.toggleVerticalMirror(), true);
  assert.equal(deck.isMirrored, false);
  assert.equal(deck.index, 0);
  deck.toggleMirror();
  assert(deck.isMirrored && deck.isVerticallyMirrored);
  deck.toggleVerticalMirror();
  assert(deck.isMirrored && !deck.isVerticallyMirrored);
  deck.toggleVerticalMirror();
  deck.navigate("next");
  assert(!deck.isMirrored && !deck.isVerticallyMirrored);
  deck.navigate("previous");
  assert(deck.isMirrored && deck.isVerticallyMirrored);
  deck.setSlides([{ src: "new", title: "new" }]);
  assert(!deck.isMirrored && !deck.isVerticallyMirrored);
});
