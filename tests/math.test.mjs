import assert from "node:assert/strict";
import katex from "katex";
import { mapOutsideMath, normalizeLatexForDisplay, normalizeMathNotation } from "../parser.js";

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

const nativeMathExamples = [
  String.raw`$$\text{従来LTA} \approx \text{長期の購入予定・需給調整}$$`,
  String.raw`\[\text{SCA} \approx \text{複数年の法的拘束力を持つ容量予約契約}\]`,
  String.raw`\(\sqrt[3]{x} + \alpha\)`,
  String.raw`本文の $\sqrt[3]{x}$ はインライン数式です。`,
  String.raw`\[
\begin{array}{cc}
\sqrt[3]{8} & [x] \\

1 & 2
\end{array}
\]`
];

for (const input of nativeMathExamples) {
  assert.equal(normalizeMathNotation(input), input, `Native math must be preserved: ${input}`);
  assert.equal(normalizeMathNotation(normalizeMathNotation(input)), input);
}

const arrayExpression = nativeMathExamples.at(-1).slice(2, -2);
const nativeArrayDisplay = katex.renderToString(arrayExpression, {
  displayMode: true,
  throwOnError: true
});
assert.match(nativeArrayDisplay, /katex-display/);
assert.match(nativeArrayDisplay, /mtable/);
assert.match(nativeArrayDisplay, /sqrt/);

const literalExamples = [
  '`' + String.raw`[ \alpha ]` + '`',
  '``' + String.raw`[ \alpha ]` + '``',
  ["```text", String.raw`**[ \alpha ]**`, "```"].join("\n"),
  ["~~~latex", String.raw`[ \alpha ]`, "~~~"].join("\n"),
  String.raw`[\alpha](https://example.com/formula)`,
  String.raw`![\alpha](https://example.com/formula.png)`,
  String.raw`\[ \alpha ]`,
  String.raw`[ C:\Temp\Documents ]`,
  "[重要] この表記は通常文です。"
];
for (const input of literalExamples) {
  assert.equal(normalizeMathNotation(input), input, `Literal content must be preserved: ${input}`);
}

const mixedMath = String.raw`[ \alpha ] と \(\sqrt[3]{x}\) と ` + '`' + String.raw`[ \beta ]` + '`';
const expectedMixedMath = String.raw`$$\alpha$$ と \(\sqrt[3]{x}\) と ` + '`' + String.raw`[ \beta ]` + '`';
assert.equal(normalizeMathNotation(mixedMath), expectedMixedMath);
assert.equal(normalizeMathNotation(expectedMixedMath), expectedMixedMath);

const formatText = (text) => text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
assert.equal(
  mapOutsideMath(String.raw`__説明__ $x_{a__b}$ と \(\text{__原文__}\)`, formatText),
  String.raw`<strong>説明</strong> $x_{a__b}$ と \(\text{__原文__}\)`
);
assert.equal(
  normalizeMathNotation(String.raw`$$\begin{aligned}a &= 1 \\ b &= 2\end{aligned} + \text{\$500M}$$`),
  String.raw`$$\begin{aligned}a &= 1 \\ b &= 2\end{aligned} + \text{\$500M}$$`
);
assert.equal(
  mapOutsideMath(String.raw`__説明 $x_{a__b}$ と \(\text{__原文__}\)__`, formatText),
  String.raw`<strong>説明 $x_{a__b}$ と \(\text{__原文__}\)</strong>`
);
assert.equal(
  mapOutsideMath("\uE0000\uE001 __本文__ $x$", formatText),
  "\uE0000\uE001 <strong>本文</strong> $x$"
);
for (const text of [String.raw`[ \alpha + \(x\) ]`, String.raw`[ \alpha + ` + '`code` ]']) {
  assert.equal(normalizeMathNotation(text, { blockSpacing: true }), text);
}
const aiJapaneseLabel = String.raw`AI\需要急増`;
assert.equal(normalizeLatexForDisplay(aiJapaneseLabel), String.raw`AI\text{需要急増}`);
assert.doesNotThrow(() => katex.renderToString(normalizeLatexForDisplay(aiJapaneseLabel), { throwOnError: true, strict: "ignore" }));
const standardJapaneseMath = String.raw`\begin{aligned}\text{需要} &= 1 \\日本語 &= 2\end{aligned}`;
assert.equal(normalizeLatexForDisplay(standardJapaneseMath), standardJapaneseMath);
assert.equal(normalizeMathNotation(String.raw`\[AI\需要急増\]`), String.raw`\[AI\需要急増\]`);

console.log("math ok");
