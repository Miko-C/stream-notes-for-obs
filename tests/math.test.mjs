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

const normalizedRevenue = normalizeMathNotation(String.raw`**[ Revenue\_{2035} ==============

**Revenue\_{\\mathrm{base}} \\times \\frac{ContentIndex\_{2035}}{100} ]**`);
assert.equal(
  normalizedRevenue,
  String.raw`$$Revenue_{2035} = Revenue_{\mathrm{base}} \times \frac{ContentIndex_{2035}}{100}$$`
);
const revenueDisplay = katex.renderToString(normalizedRevenue.slice(2, -2), {
  displayMode: true,
  throwOnError: false
});
assert.match(revenueDisplay, /mfrac/);
assert.match(revenueDisplay, /Revenue/);
assert.match(revenueDisplay, /ContentIndex/);

assert.equal(
  normalizeMathNotation(String.raw`[ C:\Users\Owner\Documents ]`),
  String.raw`[ C:\Users\Owner\Documents ]`
);
assert.equal(normalizeMathNotation(String.raw`[ \alpha ]`), String.raw`$$\alpha$$`);

console.log("math ok");
