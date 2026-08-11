import assert from "node:assert/strict";
import { parseMarkdownReport, splitIntoSlides, collectMetrics } from "../parser.js";

const markdown = `## 日次マーケットレポート

対象：米国 7月8日引け

### 全体像

今日は**AI半導体の買い戻し**が入りました。

* Nasdaq Composite：+0.2％
* S&P 500：-0.3％
* SOX：+2.2％

| 銘柄 | 騰落 | 材料 |
| --- | ---: | --- |
| NVIDIA | +3.7％ | H200期待 |
| Broadcom | +4.8％ | AI関連投資 |

[1]: https://example.com/source
`;

const report = parseMarkdownReport(markdown);

assert.equal(report.title, "日次マーケットレポート");
assert.equal(report.target, "米国 7月8日引け");
assert.equal(report.sections.length, 1);
assert.equal(report.sections[0].title, "全体像");
assert.equal(report.sections[0].blocks[1].type, "chart");
assert.equal(report.sections[0].blocks[2].type, "table");
assert.equal(report.sections[0].blocks[2].rows.length, 2);
assert.equal(collectMetrics(report).length, 3);
assert.ok(splitIntoSlides(report).length >= 1);

const splitReport = parseMarkdownReport(`## Report

## Section

### Metrics

* A：+1％
* B：+2％
* C：+3％
* D：+4％
* E：+5％
* F：+6％
* G：+7％

### Table

| Name | Value |
| --- | --- |
| A | +1％ |
| B | +2％ |
| C | +3％ |
| D | +4％ |
`);

const splitSlides = splitIntoSlides(splitReport, { maxWeight: 5 });
assert.notEqual(splitSlides[0].blocks.at(-1)?.type, "subheading");

const balancedSlides = splitIntoSlides({
  sections: [{
    title: "Balance",
    level: 2,
    blocks: ["A", "B", "C", "D"].map((text) => ({ type: "paragraph", text }))
  }]
}, { maxWeight: 4.5 });
assert.deepEqual(balancedSlides.map((slide) => slide.blocks.length), [2, 2]);

const genericReport = parseMarkdownReport(`# インフラ調査

テーマ：配信用

## 比較

- GPU稼働率：82％
- 冷却効率：68％
- 送電余力：44MW
`);

assert.equal(genericReport.target, "配信用");
assert.equal(genericReport.sections[0].blocks[0].type, "chart");
assert.equal(genericReport.sections[0].blocks[0].metrics[0].sentiment, "neutral");
assert.equal(genericReport.sections[0].blocks[0].metrics[2].unit, "MW");

const proseList = parseMarkdownReport(`# 調査メモ

## 確認状況

- 確認済みの構造要因：Rubin、HBM4、長期契約
- 未確認：HBM4とHBM3Eの実際の価格差
- Samsung Electronics：005930.KS
`);

assert.equal(proseList.sections[0].blocks[0].type, "list");

const boldTarget = parseMarkdownReport(`# 文書

**対象：2026年7月**

本文
`);

assert.equal(boldTarget.target, "2026年7月");

const mathReport = parseMarkdownReport(String.raw`# 数式

## 式

エネルギーは $E = mc^2$ です。

$$P = \frac{E}{t}$$
`);

assert.match(mathReport.sections[0].blocks[0].text, /\$E = mc\^2\$/);
assert.match(mathReport.sections[0].blocks[1].text, /\\frac\{E\}\{t\}/);

const aiBracketMath = parseMarkdownReport(String.raw`# 数式

## 面積比率

**[ \\frac{\\text{SRAM面積}} {\\text{Chip総面積}} ]**
`);

assert.equal(
  aiBracketMath.sections[0].blocks[0].text,
  String.raw`$$\frac{\text{SRAM面積}} {\text{Chip総面積}}$$`
);
assert.deepEqual(aiBracketMath.highlights, []);

const singleSlashBracketMath = parseMarkdownReport(String.raw`# 数式

## 面積比率

[ \frac{\text{SRAM面積}} {\text{Chip総面積}} ]
`);

assert.equal(
  singleSlashBracketMath.sections[0].blocks[0].text,
  String.raw`$$\frac{\text{SRAM面積}} {\text{Chip総面積}}$$`
);

const regularBrackets = parseMarkdownReport(`# 注記

## 通常文

**[重要]** この表記は数式に変換しません。
`);

assert.equal(regularBrackets.sections[0].blocks[0].text, "**[重要]** この表記は数式に変換しません。");

const fencedDiagram = parseMarkdownReport([
  "# 光トランシーバー",
  "",
  "## 構成",
  "",
  "```text",
  "GPU / Switch ASIC",
  "      │",
  "      ▼",
  "┌──── 光トランシーバー ────┐",
  "│ DSP → Driver → Laser      │",
  "└─────────┬──────────┘",
  "          │",
  "        Fiber",
  "```"
].join("\n"));

assert.equal(fencedDiagram.sections[0].blocks[0].type, "diagram");
assert.doesNotMatch(fencedDiagram.sections[0].blocks[0].text, /```|^text$/m);
assert.match(fencedDiagram.sections[0].blocks[0].text, /光トランシーバー/);

const rawDiagram = parseMarkdownReport(`# 通信構成

## レーン

Lane 1   200G ────────→
Lane 2   200G ────────→
Lane 3   200G ────────→
Lane 4   200G ────────→

合計 1.6 Tb/s
`);

assert.equal(rawDiagram.sections[0].blocks[0].type, "diagram");
assert.equal(rawDiagram.sections[0].blocks[0].rows, 4);
assert.equal(rawDiagram.sections[0].blocks[1].type, "paragraph");
assert.equal(splitIntoSlides(rawDiagram, { maxWeight: 5.61 }).length, 1);

const fencedLatex = parseMarkdownReport([
  "# 数式",
  "",
  "## 光電力",
  "",
  "```latex",
  String.raw`P_{out} = P_{in} \times 10^{-L/10}`,
  "```"
].join("\n"));

assert.equal(fencedLatex.sections[0].blocks[0].type, "paragraph");
assert.match(fencedLatex.sections[0].blocks[0].text, /^\$\$/);

const longDiagramSource = [
  "# 長い図",
  "",
  "## 32レーン",
  "",
  "```text",
  ...Array.from({ length: 25 }, (_, index) => `Lane ${index + 1}  200G ─────→`),
  "```"
].join("\n");
const longDiagram = parseMarkdownReport(longDiagramSource);
assert.equal(longDiagram.sections[0].blocks.length, 1);
assert.equal(longDiagram.sections[0].blocks[0].rows, 25);

const scrollableDiagramSource = [
  "# 長い図",
  "",
  "## 全体構造",
  "",
  "```text",
  ...Array.from({ length: 36 }, (_, index) => (
    index === 18 ? "" : `Stage ${index + 1}  ─────→`
  )),
  "```"
].join("\n");
const scrollableDiagram = parseMarkdownReport(scrollableDiagramSource);
assert.equal(scrollableDiagram.sections[0].blocks.length, 1);
assert.equal(scrollableDiagram.sections[0].blocks[0].rows, 36);
assert.match(scrollableDiagram.sections[0].blocks[0].text, /Stage 36/);
assert.match(scrollableDiagram.sections[0].blocks[0].text, /Stage 18[^\n]*\n\nStage 20/);

console.log("parser ok");
