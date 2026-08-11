const headingPattern = /^(#{1,4})\s+(.+)$/;
const footnotePattern = /^\[[^\]]+\]:\s+/;
const horizontalRulePattern = /^\s*[-*_]{3,}\s*$/;
const listPattern = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/;
const fenceStartPattern = /^\s*(`{3,}|~{3,})\s*([^\s`]*)?\s*$/;
const boldBracketMathPattern = /(\*\*|__)\s*\[\s*([\s\S]*?)\s*\]\s*\1/g;
const plainBracketMathPattern = /\[\s*([\s\S]*?)\s*\]/g;
const latexCommandPattern = /\\[A-Za-z]+/;
const standaloneMathCommandPattern = /\\(?:alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|rho|sigma|tau|phi|psi|omega|sum|prod|int|lim|infty)\b/i;
const MAX_DIAGRAM_BLOCK_LINES = 120;
const DIAGRAM_SCAN_LINES = 32;

export function parseMarkdownReport(markdown = "") {
  const source = normalizeDocumentMath(markdown).trim();
  const lines = source.split("\n");
  const sections = [];
  let title = "";
  let target = "";
  let currentSection = null;
  let titleCaptured = false;

  const ensureSection = (fallbackTitle = "配信ノート", level = 2) => {
    if (!currentSection) {
      currentSection = {
        title: fallbackTitle,
        level,
        blocks: []
      };
      sections.push(currentSection);
    }
    return currentSection;
  };

  const pushBlock = (block) => {
    ensureSection().blocks.push(block);
  };

  for (let index = 0; index < lines.length;) {
    const rawLine = lines[index] || "";
    const line = rawLine.trim();

    if (!line || footnotePattern.test(line) || horizontalRulePattern.test(line)) {
      index += 1;
      continue;
    }

    const fence = rawLine.match(fenceStartPattern);
    if (fence) {
      const fenceMarker = fence[1];
      const language = (fence[2] || "").toLocaleLowerCase();
      const diagramLines = [];
      index += 1;

      while (index < lines.length && !isFenceEnd(lines[index], fenceMarker)) {
        diagramLines.push(lines[index] || "");
        index += 1;
      }
      if (index < lines.length) index += 1;

      const content = trimBlankLines(diagramLines).join("\n");
      if (content) {
        if (["math", "latex", "katex", "tex"].includes(language) && !looksLikeDiagram(content)) {
          pushBlock({ type: "paragraph", text: `$$${content}$$` });
        } else {
          pushDiagramBlocks(content, pushBlock);
        }
      }
      continue;
    }

    const heading = line.match(headingPattern);
    if (heading) {
      const level = heading[1].length;
      const text = stripMarkdownInline(heading[2]);

      if (!titleCaptured && level <= 2) {
        title = text;
        titleCaptured = true;
        index += 1;
        continue;
      }

      if (level <= 2 || !currentSection) {
        currentSection = { title: text, level, blocks: [] };
        sections.push(currentSection);
      } else {
        pushBlock({ type: "subheading", level, text });
      }
      index += 1;
      continue;
    }

    const metadataLine = stripMarkdownInline(line);
    if (!target && /^(対象|テーマ|概要|用途)[:：]/.test(metadataLine)) {
      target = metadataLine.replace(/^(対象|テーマ|概要|用途)[:：]\s*/, "");
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const tableLines = [];
      while (index < lines.length && isTableLine(lines[index])) {
        tableLines.push(lines[index]);
        index += 1;
      }

      const table = parseTable(tableLines);
      if (table.headers.length && table.rows.length) {
        pushBlock({ type: "table", ...table });
      }
      continue;
    }

    if (listPattern.test(rawLine)) {
      const items = [];
      const ordered = /^\s*\d+[.)]\s+/.test(rawLine);

      while (index < lines.length && listPattern.test(lines[index] || "")) {
        const item = (lines[index] || "").match(listPattern)?.[1] || "";
        items.push(stripMarkdownInline(item));
        index += 1;
      }

      const metrics = items.map(extractMetric).filter(Boolean);
      if (metrics.length >= 2) {
        pushBlock({ type: "chart", metrics, items });
      } else {
        pushBlock({ type: "list", ordered, items });
      }
      continue;
    }

    if (isRawDiagramStart(lines, index)) {
      const diagramLines = [];
      while (index < lines.length && (lines[index] || "").trim()) {
        diagramLines.push(lines[index] || "");
        index += 1;
      }
      pushDiagramBlocks(diagramLines.join("\n"), pushBlock);
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length) {
      const nextLine = lines[index] || "";
      const trimmed = nextLine.trim();

      if (
        !trimmed ||
        headingPattern.test(trimmed) ||
        footnotePattern.test(trimmed) ||
        horizontalRulePattern.test(trimmed) ||
        fenceStartPattern.test(nextLine) ||
        isTableStart(lines, index) ||
        listPattern.test(nextLine) ||
        isRawDiagramStart(lines, index)
      ) {
        break;
      }

      paragraphLines.push(trimmed);
      index += 1;
    }

    if (paragraphLines.length) {
      pushBlock({
        type: "paragraph",
        text: normalizeMathNotation(stripInlineLinks(paragraphLines.join(" ")))
      });
    } else {
      index += 1;
    }
  }

  if (!sections.length && source) {
    sections.push({
      title: "配信ノート",
      level: 2,
      blocks: [{ type: "paragraph", text: normalizeMathNotation(stripInlineLinks(source)) }]
    });
  }

  return {
    title: title || "配信ノート",
    target,
    sections,
    highlights: extractHighlights(source)
  };
}

export function splitIntoSlides(report, options = {}) {
  const maxWeight = Number(options.maxWeight || 8.5);
  const slides = [];

  for (const section of report.sections) {
    const chunks = [];
    let blocks = [];
    let weight = 0;

    for (let index = 0; index < section.blocks.length; index += 1) {
      const block = section.blocks[index];
      const nextBlock = section.blocks[index + 1];
      const nextWeight = blockWeight(block);
      const bundleWeight = block.type === "subheading" && nextBlock ? nextWeight + blockWeight(nextBlock) : nextWeight;

      if (block.type === "subheading" && nextBlock && blocks.length && weight + bundleWeight > maxWeight) {
        chunks.push(blocks);
        blocks = [];
        weight = 0;
      }

      if (block.type === "subheading" && nextBlock && !blocks.length && bundleWeight > maxWeight) {
        blocks.push(block, nextBlock);
        weight = bundleWeight;
        index += 1;
        continue;
      }

      if (blocks.length && weight + nextWeight > maxWeight) {
        chunks.push(blocks);
        blocks = [];
        weight = 0;
      }

      blocks.push(block);
      weight += nextWeight;
    }

    if (blocks.length || !chunks.length) {
      chunks.push(blocks);
    }

    rebalanceTrailingChunk(chunks);

    chunks.forEach((chunk, chunkIndex) => {
      slides.push({
        title: section.title,
        level: section.level,
        part: chunkIndex + 1,
        totalParts: chunks.length,
        blocks: chunk
      });
    });
  }

  return slides;
}

function rebalanceTrailingChunk(chunks) {
  if (chunks.length < 2) return;
  const last = chunks.at(-1);
  const previous = chunks.at(-2);

  if (last.length === 1 && previous.length > 2) {
    last.unshift(previous.pop());
  }
}

export function collectMetrics(report) {
  const metrics = [];

  for (const section of report.sections) {
    for (const block of section.blocks) {
      if (block.type === "chart") {
        metrics.push(...block.metrics.map((metric) => ({ ...metric, section: section.title })));
      }
    }
  }

  return metrics;
}

export function stripMarkdownInline(value = "") {
  return normalizeMathNotation(stripInlineLinks(value))
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

export function normalizeMathNotation(value = "", options = {}) {
  const convert = (whole, expression) => {
    if (expression.length > 10_000 || /(?:^|\n)\s*#{1,4}\s/.test(expression)) return whole;
    const latex = expression
      .replace(/\*\*|__/g, " ")
      .replace(/={3,}/g, " = ")
      .replace(/\\\\(?=[A-Za-z])/g, "\\")
      .replace(/\\{1,2}([_^])(?=\{)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (!looksLikeLatexExpression(latex)) return whole;
    const math = `$$${latex}$$`;
    return options.blockSpacing ? `\n\n${math}\n\n` : math;
  };

  return String(value)
    .replace(boldBracketMathPattern, (whole, _marker, expression) => convert(whole, expression))
    .replace(plainBracketMathPattern, (whole, expression) => convert(whole, expression));
}

function looksLikeLatexExpression(value) {
  if (/^[A-Za-z]:\\/.test(value) || !latexCommandPattern.test(value)) return false;
  return /[=+\-*/^_{}<>]|\d/.test(value) || standaloneMathCommandPattern.test(value);
}

function normalizeDocumentMath(value = "") {
  const lines = normalizeNewlines(value).split("\n");
  const output = [];
  let proseLines = [];
  let fenceMarker = "";

  const flushProse = () => {
    if (!proseLines.length) return;
    output.push(normalizeMathNotation(proseLines.join("\n"), { blockSpacing: true }));
    proseLines = [];
  };

  for (const line of lines) {
    if (fenceMarker) {
      output.push(line);
      if (isFenceEnd(line, fenceMarker)) fenceMarker = "";
      continue;
    }

    const fence = line.match(fenceStartPattern);
    if (fence) {
      flushProse();
      fenceMarker = fence[1];
      output.push(line);
      continue;
    }

    proseLines.push(line);
  }

  flushProse();
  return output.join("\n");
}

function normalizeNewlines(value) {
  return String(value || "").replace(/\r\n?/g, "\n");
}

function isFenceEnd(line, fenceMarker) {
  const marker = fenceMarker[0];
  return new RegExp(`^\\s*${marker}{${fenceMarker.length},}\\s*$`).test(line || "");
}

function pushDiagramBlocks(content, pushBlock) {
  const sourceLines = trimBlankLines(normalizeNewlines(content).split("\n"));

  for (let index = 0; index < sourceLines.length; index += MAX_DIAGRAM_BLOCK_LINES) {
    const lines = removeCommonIndent(sourceLines.slice(index, index + MAX_DIAGRAM_BLOCK_LINES));
    const text = lines.join("\n");
    pushBlock({
      type: "diagram",
      text,
      rows: lines.length,
      columns: Math.max(...lines.map(displayColumnWidth), 1)
    });
  }
}

function trimBlankLines(lines) {
  const output = [...lines];
  while (output.length && !output[0].trim()) output.shift();
  while (output.length && !output.at(-1).trim()) output.pop();
  return output;
}

function removeCommonIndent(lines) {
  const indents = lines
    .filter((line) => line.trim())
    .map((line) => line.match(/^\s*/)?.[0].replace(/\t/g, "    ").length || 0);
  const commonIndent = indents.length ? Math.min(...indents) : 0;
  if (!commonIndent) return lines;
  return lines.map((line) => line.slice(commonIndent));
}

function displayColumnWidth(value) {
  let width = 0;
  for (const character of String(value || "")) {
    width += /[\u1100-\u115f\u2329\u232a\u2e80-\u9fff\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe6f\uff01-\uff60\uffe0-\uffe6]/u.test(character) ? 2 : 1;
  }
  return width;
}

function isRawDiagramStart(lines, index) {
  const first = lines[index] || "";
  if (!first.trim() || fenceStartPattern.test(first)) return false;

  const group = [];
  for (let cursor = index; cursor < lines.length && group.length < DIAGRAM_SCAN_LINES; cursor += 1) {
    const line = lines[cursor] || "";
    if (!line.trim()) break;
    if (cursor > index && (headingPattern.test(line.trim()) || listPattern.test(line) || isTableStart(lines, cursor))) break;
    group.push(line);
  }

  const structuralLines = group.filter(isDiagramStructuralLine).length;
  const score = group.reduce((total, line) => total + diagramLineScore(line), 0);
  if (group.length === 1) {
    return structuralLines === 1 && /^[\s\u2500-\u257f●○◆◇■□▲△▼▽→←↑↓▁▂▃▄▅▆▇█]+$/u.test(group[0]);
  }
  return structuralLines >= 2 || (group.length >= 4 && structuralLines >= 1 && score >= 3);
}

function looksLikeDiagram(content) {
  const lines = normalizeNewlines(content).split("\n");
  return lines.filter(isDiagramStructuralLine).length >= 2;
}

function isDiagramStructuralLine(line) {
  return diagramLineScore(line) >= 1;
}

function diagramLineScore(line) {
  const value = String(line || "");
  let score = 0;
  if (/[┌┐└┘├┤┬┴┼│─━╭╮╰╯╞╡╪]/u.test(value)) score += 2;
  if (/[▼▲→←↓↑⇒⇢]/u.test(value) || /-{2,}>|<-{2,}/.test(value)) score += 1;
  if (/[●○◆◇■□▁▂▃▄▅▆▇█]/u.test(value)) score += 1;
  if (/^\s*[|+]\s*(?:[-+|]\s*){2,}/.test(value)) score += 2;
  if (/\bLane\s*\d+/i.test(value) && /→|->/.test(value)) score += 1;
  return score;
}

function stripInlineLinks(value = "") {
  return String(value)
    .replace(/\[([^\]]+)\]\[\d+\]/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/\[\d+\]/g, "")
    .trim();
}

function isTableLine(line = "") {
  return /^\s*\|?.+\|.+\|?\s*$/.test(line);
}

function isTableStart(lines, index) {
  return isTableLine(lines[index] || "") && isTableLine(lines[index + 1] || "") && /-{3,}/.test(lines[index + 1] || "");
}

function parseTable(tableLines) {
  const rows = tableLines
    .map(splitTableRow)
    .filter((row) => row.some(Boolean));

  if (!rows.length) {
    return { headers: [], rows: [] };
  }

  const headers = rows[0].map(stripMarkdownInline);
  const body = rows.slice(1);
  const dataRows = body[0]?.every(isAlignmentCell) ? body.slice(1) : body;

  return {
    headers,
    rows: dataRows.map((row) => row.map(stripMarkdownInline))
  };
}

function splitTableRow(row) {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isAlignmentCell(cell = "") {
  return /^:?-{3,}:?$/.test(cell.trim());
}

function extractMetric(text) {
  const clean = stripMarkdownInline(text);
  const separator = clean.search(/[:：]/);

  if (separator < 1) {
    return null;
  }

  const label = clean.slice(0, separator).trim();
  const detail = clean.slice(separator + 1).trim();
  const match = detail.match(
    /^([+-]?\s*\d[\d,]*(?:\.\d+)?)\s*(％|%|円|ドル|件|人|台|倍|年|月|日|時間|分|秒|GB|TB|MW|GW|℃|°C|ポイント|pt)?/i
  );

  if (!match) {
    return null;
  }

  const remainder = detail.slice(match[0].length).trim();
  const hasUnit = Boolean(match[2]);
  const hasSign = /^[+-]/.test(match[1].trim());
  if (!hasUnit && !hasSign && remainder && !/^[,、（(]/.test(remainder)) {
    return null;
  }

  const value = Number(match[1].replace(/\s+/g, "").replace(/,/g, ""));
  if (!Number.isFinite(value)) {
    return null;
  }

  const signed = hasSign;

  return {
    label,
    value,
    unit: /^(?:％|%)$/.test(match[2] || "") ? "%" : (match[2] || ""),
    detail,
    signed,
    sentiment: signed && value > 0 ? "positive" : signed && value < 0 ? "negative" : "neutral"
  };
}

function blockWeight(block) {
  if (block.type === "subheading") return 0.8;
  if (block.type === "paragraph") return Math.max(1.4, Math.ceil(block.text.length / 130));
  if (block.type === "list") return Math.max(1.6, block.items.length * 0.52);
  if (block.type === "chart") return Math.max(2.8, Math.min(5.8, block.metrics.length * 0.62 + 1.6));
  if (block.type === "table") return Math.max(2.8, Math.min(6.4, block.rows.length * 0.48 + 1.8));
  if (block.type === "diagram") {
    const rowWeight = block.rows * 0.42;
    const widthWeight = Math.max(0, (block.columns - 46) / 22);
    return Math.max(1.2, Math.min(8, rowWeight + widthWeight + 0.8));
  }
  return 1;
}

function extractHighlights(source) {
  const highlights = [];
  const boldPattern = /\*\*([^*]+)\*\*/g;
  let match = boldPattern.exec(source);

  while (match) {
    const highlight = stripMarkdownInline(match[1]);
    if (!/^\$\$[\s\S]+\$\$$/.test(highlight)) highlights.push(highlight);
    match = boldPattern.exec(source);
  }

  return [...new Set(highlights)].slice(0, 8);
}
