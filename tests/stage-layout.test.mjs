import assert from "node:assert/strict";
import {
  calculateStageFit,
  isNativeStageSize,
  normalizeStagePoint,
  STAGE_HEIGHT,
  STAGE_WIDTH
} from "../stage-layout.js";

const widescreen = calculateStageFit(1920, 1080);
assert.equal(widescreen.scale, 1);
assert.equal(widescreen.width, STAGE_WIDTH);
assert.equal(widescreen.height, STAGE_HEIGHT);

const fourByThree = calculateStageFit(1024, 768);
assert.equal(fourByThree.width, 1024);
assert.equal(fourByThree.height, 576);

assert.equal(isNativeStageSize(1920, 1080), true);
assert.equal(isNativeStageSize(1919.75, 1080.25), true);
assert.equal(isNativeStageSize(800, 600), false);

const point = normalizeStagePoint(612, 388, {
  left: 100,
  top: 100,
  width: 1024,
  height: 576
});
assert.equal(point.x, 0.5);
assert.equal(point.y, 0.5);

const clamped = normalizeStagePoint(-20, 900, {
  left: 100,
  top: 100,
  width: 1024,
  height: 576
});
assert.equal(clamped.x, 0);
assert.equal(clamped.y, 1);

console.log("stage layout ok");
