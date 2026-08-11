import assert from "node:assert/strict";
import {
  mergeInteractionState,
  sanitizeInteractionState
} from "../interaction.js";

const initial = sanitizeInteractionState();
assert.equal(initial.pointer.enabled, false);
assert.equal(initial.pointer.mode, "cursor");
assert.equal(initial.callout.visible, false);
assert.equal(initial.drawing.enabled, false);
assert.equal(initial.drawing.tool, "pen");
assert.deepEqual(initial.drawing.strokes, []);
assert.deepEqual(initial.scroll.positions, []);
assert.equal(initial.output.width, 0);

const moved = mergeInteractionState(initial, {
  pointer: {
    enabled: true,
    visible: true,
    x: 1.4,
    y: -0.2,
    mode: "laser",
    clickId: 12
  }
}, 4);

assert.equal(moved.pointer.enabled, true);
assert.equal(moved.pointer.x, 1);
assert.equal(moved.pointer.y, 0);
assert.equal(moved.pointer.mode, "laser");
assert.equal(moved.revision, 4);

const message = mergeInteractionState(moved, {
  callout: {
    visible: true,
    text: "  ここに注目してください  ",
    tone: "answer"
  }
}, 5);

assert.equal(message.pointer.mode, "laser");
assert.equal(message.callout.text, "ここに注目してください");
assert.equal(message.callout.tone, "answer");
assert.equal(message.revision, 5);

const output = mergeInteractionState(message, {
  output: {
    width: 1920,
    height: 1080,
    dpr: 1,
    updatedAt: 12345
  }
}, 6);

assert.equal(output.output.width, 1920);
assert.equal(output.output.height, 1080);
assert.equal(output.output.updatedAt, 12345);

const drawing = mergeInteractionState(output, {
  drawing: {
    enabled: true,
    tool: "marker",
    color: "#52D3AA",
    size: 200,
    strokes: [{
      id: "stroke-1",
      pageKey: "document-1:0",
      tool: "marker",
      color: "#52D3AA",
      size: 30,
      points: [
        { x: -1, y: 0.25 },
        { x: 0.75, y: 2 },
        { x: "bad", y: 0.5 }
      ]
    }]
  }
}, 7);

assert.equal(drawing.drawing.enabled, true);
assert.equal(drawing.drawing.tool, "marker");
assert.equal(drawing.drawing.color, "#52d3aa");
assert.equal(drawing.drawing.size, 64);
assert.equal(drawing.drawing.strokes.length, 1);
assert.deepEqual(drawing.drawing.strokes[0].points, [
  { x: 0, y: 0.25 },
  { x: 0.75, y: 1 }
]);

const scrolled = mergeInteractionState(drawing, {
  scroll: {
    positions: [
      { pageKey: "document-1:0", x: -1, y: 0.35 },
      { pageKey: "document-1:1", x: 0.8, y: 2 }
    ]
  }
}, 8);

assert.deepEqual(scrolled.scroll.positions, [
  { pageKey: "document-1:0", x: 0, y: 0.35 },
  { pageKey: "document-1:1", x: 0.8, y: 1 }
]);

const lightweightPointerMove = mergeInteractionState(scrolled, {
  pointer: { x: 0.25, y: 0.75 }
}, 9);
assert.strictEqual(lightweightPointerMove.drawing, scrolled.drawing);
assert.strictEqual(lightweightPointerMove.scroll, scrolled.scroll);
assert.strictEqual(lightweightPointerMove.callout, scrolled.callout);
assert.equal(lightweightPointerMove.pointer.x, 0.25);
assert.equal(lightweightPointerMove.pointer.y, 0.75);

console.log("interaction ok");
