import assert from "node:assert/strict";
import katex from "katex";
import { normalizeMathNotation } from "../parser.js";

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

const normalizedAiMath = normalizeMathNotation(String.raw`**[ \\frac{\\text{SRAM面積}} {\\text{Chip総面積}} ]**`);
assert.equal(normalizedAiMath, String.raw`$$\frac{\text{SRAM面積}} {\text{Chip総面積}}$$`);
const normalizedDisplay = katex.renderToString(normalizedAiMath.slice(2, -2), {
  displayMode: true,
  throwOnError: false
});
assert.match(normalizedDisplay, /mfrac/);
assert.match(normalizedDisplay, /SRAM面積/);
assert.match(normalizedDisplay, /Chip総面積/);

console.log("math ok");
