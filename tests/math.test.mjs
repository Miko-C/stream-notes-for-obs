import assert from "node:assert/strict";
import katex from "katex";

const inline = katex.renderToString(String.raw`E = mc^2`, {
  throwOnError: false
});
const display = katex.renderToString(String.raw`P = \frac{E}{t}`, {
  displayMode: true,
  throwOnError: false
});

assert.match(inline, /katex/);
assert.match(inline, /mord mathnormal/);
assert.match(display, /katex-display/);
assert.match(display, /mfrac/);

console.log("math ok");
