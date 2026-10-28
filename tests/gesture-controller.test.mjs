import test from "node:test";
import assert from "node:assert/strict";
import { classifyPose, GestureController } from "../static/gesture-controller.mjs";
import { SAMPLE_SLIDES, SlideDeck } from "../static/gallery.mjs";

// Synthetic landmarks isolate decision logic; real model accuracy needs camera QA.
function pointsFor(pose) {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.8, z: 0 }));
  points[0] = { x: 0.5, y: 0.9, z: 0 };
  [5, 9, 13, 17].forEach((base, finger) => {
    const extended = pose === "palm" || (pose === "index" && finger === 0) || (pose === "pinky" && finger === 3);
    const x = 0.4 + finger * 0.065;
    const ys = extended ? [0.65, 0.5, 0.37, 0.24] : [0.65, 0.5, 0.6, 0.7];
    ys.forEach((y, joint) => { points[base + joint] = { x, y, z: 0 }; });
  });
  return points;
}

function hand(pose = "palm", dx = 0, dy = 0, id = "Right") {
  const worldLandmarks = pointsFor(pose);
  return { id, worldLandmarks, landmarks: worldLandmarks.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) };
}

function feed(controller, pose, from, to) {
  const actions = [];
  for (let time = from; time <= to; time += 70) {
    const result = controller.update(pose ? hand(pose) : null, time);
    if (result.action) actions.push(result.action);
  }
  return actions;
}

test("recognizes open palm, isolated index and isolated pinky; rejects a fist and malformed data", () => {
  for (const pose of ["palm", "index", "pinky"]) assert.equal(classifyPose(pointsFor(pose)), pose);
  assert.equal(classifyPose(pointsFor("fist")), "none");
  assert.equal(classifyPose([]), "none");
  assert.equal(classifyPose(null), "none");
  const malformed = pointsFor("palm");
  malformed[8].x = NaN;
  assert.equal(classifyPose(malformed), "none");
});

test("finger recognition is invariant under translation, uniform scale and rotation", () => {
  for (const pose of ["palm", "index", "pinky"]) {
    const rotated = pointsFor(pose).map((p) => ({ x: p.y * 0.12 - 0.3, y: -p.x * 0.12 + 0.1, z: 0.2 }));
    assert.equal(classifyPose(rotated), pose);
  }
});

test("holding a finger issues only one first/last command until released", () => {
  for (const [pose, action] of [["index", "first"], ["pinky", "last"]]) {
    const controller = new GestureController();
    assert.deepEqual(feed(controller, pose, 0, 420), []);
    assert.deepEqual(feed(controller, pose, 490, 2800), [action]);
    feed(controller, null, 2870, 3220);
    assert.deepEqual(feed(controller, pose, 3290, 3990), [action]);
  }
});

test("brief pose changes and tracking flicker do not rearm a held finger", () => {
  const controller = new GestureController();
  assert.deepEqual(feed(controller, "index", 0, 1960), ["first"]);
  controller.update(null, 2030);
  assert.deepEqual(feed(controller, "index", 2100, 3500), []);
});

test("screen-left palm motion goes previous; screen-right goes next after mirroring", () => {
  for (const [direction, action] of [[1, "previous"], [-1, "next"]]) {
    const controller = new GestureController();
    const actions = [];
    for (let frame = 0; frame < 6; frame += 1) {
      const result = controller.update(hand("palm", direction * frame * 0.05), frame * 70);
      if (result.action) actions.push(result.action);
    }
    assert.deepEqual(actions, [action]);
  }
});

test("palm jitter, vertical drift and slow movement do not navigate", () => {
  for (const mode of ["jitter", "vertical", "slow"]) {
    const controller = new GestureController();
    const actions = [];
    for (let frame = 0; frame < 40; frame += 1) {
      const dx = mode === "jitter" ? Math.sin(frame) * 0.025 : mode === "slow" ? frame * 0.004 : frame * 0.04;
      const dy = mode === "vertical" ? frame * 0.05 : 0;
      const result = controller.update(hand("palm", dx, dy), frame * 70);
      if (result.action) actions.push(result.action);
    }
    assert.deepEqual(actions, [], mode);
  }
});

test("cooldown and manual suppression prevent immediate repeat actions", () => {
  const controller = new GestureController();
  assert.deepEqual(feed(controller, "index", 0, 560), ["first"]);
  assert.deepEqual(feed(controller, "pinky", 630, 1330), []);
  assert.deepEqual(feed(controller, "pinky", 1400, 1680), ["last"]);
  controller.suppress(1750);
  assert.deepEqual(feed(controller, "index", 1750, 2590), []);
});

test("tracking gaps, hand switches and lost hands discard partial swipes", () => {
  for (const mode of ["gap", "switch", "missing"]) {
    const controller = new GestureController();
    controller.update(hand("palm", 0), 0);
    controller.update(hand("palm", 0.08), 70);
    if (mode === "missing") controller.update(null, 140);
    const command = controller.update(hand("palm", 0.18, 0, mode === "switch" ? "Left" : "Right"), mode === "gap" ? 600 : 210);
    assert.equal(command.action, null, mode);
  }
});

test("gallery clamps boundaries, supports first/last and resets when replacing images", () => {
  const deck = new SlideDeck();
  assert.equal(deck.navigate("previous"), false);
  assert.equal(deck.index, 0);
  assert.equal(deck.navigate("next"), true);
  assert.equal(deck.index, 1);
  deck.navigate("last");
  assert.equal(deck.index, SAMPLE_SLIDES.length - 1);
  assert.equal(deck.navigate("next"), false);
  deck.navigate("first");
  assert.equal(deck.index, 0);
  deck.setSlides([{ src: "local", title: "only image" }]);
  for (const action of ["first", "last", "previous", "next"]) assert.equal(deck.navigate(action), false);
  assert.equal(deck.index, 0);
  assert.throws(() => deck.setSlides([]));
  assert.throws(() => deck.navigate("invalid"));
});
