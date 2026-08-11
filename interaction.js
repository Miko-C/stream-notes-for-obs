export const POINTER_MODES = ["cursor", "laser", "spotlight"];
export const CALLOUT_TONES = ["question", "note", "answer"];
export const DRAWING_TOOLS = ["pen", "marker", "eraser"];

const DEFAULT_DRAWING_COLOR = "#f1b84c";
const MAX_DRAWING_STROKES = 160;
const MAX_POINTS_PER_STROKE = 4096;
const MAX_DRAWING_POINTS = 24_000;
const MAX_SCROLL_POSITIONS = 80;

export function sanitizeInteractionState(value = {}) {
  return {
    version: 3,
    pointer: sanitizePointer(value.pointer),
    callout: sanitizeCallout(value.callout),
    drawing: sanitizeDrawing(value.drawing),
    scroll: sanitizeScroll(value.scroll),
    output: sanitizeOutput(value.output),
    revision: clampInteger(Number(value.revision || 0), 0, Number.MAX_SAFE_INTEGER)
  };
}

export function mergeInteractionState(current = {}, patch = {}, revision) {
  const base = current?.version === 3 ? current : sanitizeInteractionState(current);
  const next = {
    ...base,
    version: 3,
    revision: clampInteger(
      Number(revision ?? patch.revision ?? base.revision),
      0,
      Number.MAX_SAFE_INTEGER
    )
  };

  if (patch.pointer && typeof patch.pointer === "object") {
    next.pointer = sanitizePointer({ ...base.pointer, ...patch.pointer });
  }
  if (patch.callout && typeof patch.callout === "object") {
    next.callout = sanitizeCallout({ ...base.callout, ...patch.callout });
  }
  if (patch.drawing && typeof patch.drawing === "object") {
    next.drawing = sanitizeDrawing({ ...base.drawing, ...patch.drawing });
  }
  if (patch.scroll && typeof patch.scroll === "object") {
    next.scroll = sanitizeScroll({ ...base.scroll, ...patch.scroll });
  }
  if (patch.output && typeof patch.output === "object") {
    next.output = sanitizeOutput({ ...base.output, ...patch.output });
  }

  return next;
}

function sanitizePointer(value = {}) {
  const pointer = value && typeof value === "object" ? value : {};
  return {
    enabled: Boolean(pointer.enabled),
    visible: Boolean(pointer.visible),
    x: clamp(Number(pointer.x ?? 0.5), 0, 1),
    y: clamp(Number(pointer.y ?? 0.5), 0, 1),
    mode: POINTER_MODES.includes(pointer.mode) ? pointer.mode : "cursor",
    clickId: clampInteger(Number(pointer.clickId || 0), 0, Number.MAX_SAFE_INTEGER)
  };
}

function sanitizeCallout(value = {}) {
  const callout = value && typeof value === "object" ? value : {};
  return {
    visible: Boolean(callout.visible),
    text: typeof callout.text === "string" ? callout.text.trim().slice(0, 220) : "",
    tone: CALLOUT_TONES.includes(callout.tone) ? callout.tone : "question"
  };
}

function sanitizeDrawing(value = {}) {
  const drawing = value && typeof value === "object" ? value : {};
  return {
    enabled: Boolean(drawing.enabled),
    tool: DRAWING_TOOLS.includes(drawing.tool) ? drawing.tool : "pen",
    color: sanitizeColor(drawing.color),
    size: clamp(Number(drawing.size || 10), 4, 64),
    strokes: sanitizeDrawingStrokes(drawing.strokes)
  };
}

function sanitizeScroll(value = {}) {
  const scroll = value && typeof value === "object" ? value : {};
  return { positions: sanitizeScrollPositions(scroll.positions) };
}

function sanitizeOutput(value = {}) {
  const output = value && typeof value === "object" ? value : {};
  return {
    width: clampInteger(Number(output.width || 0), 0, 7680),
    height: clampInteger(Number(output.height || 0), 0, 4320),
    dpr: clamp(Number(output.dpr || 1), 0.5, 4),
    updatedAt: clampInteger(Number(output.updatedAt || 0), 0, Number.MAX_SAFE_INTEGER)
  };
}

function sanitizeScrollPositions(value) {
  if (!Array.isArray(value)) return [];
  const positions = [];
  const seenKeys = new Set();

  for (const item of value.slice().reverse()) {
    if (!item || typeof item !== "object") continue;
    const pageKey = sanitizeIdentifier(item.pageKey, "");
    if (!pageKey || seenKeys.has(pageKey)) continue;
    seenKeys.add(pageKey);
    positions.unshift({
      pageKey,
      x: clamp(Number(item.x || 0), 0, 1),
      y: clamp(Number(item.y || 0), 0, 1)
    });
    if (positions.length >= MAX_SCROLL_POSITIONS) break;
  }

  return positions;
}

function sanitizeDrawingStrokes(value) {
  const source = Array.isArray(value) ? value.slice(-MAX_DRAWING_STROKES) : [];
  const strokes = [];
  let remainingPoints = MAX_DRAWING_POINTS;

  for (let index = source.length - 1; index >= 0 && remainingPoints > 0; index -= 1) {
    const stroke = sanitizeDrawingStroke(source[index], remainingPoints);
    if (!stroke) continue;
    strokes.unshift(stroke);
    remainingPoints -= stroke.points.length;
  }

  return strokes;
}

function sanitizeDrawingStroke(value, remainingPoints) {
  if (!value || typeof value !== "object") return null;
  const rawPoints = Array.isArray(value.points) ? value.points : [];
  const pointLimit = Math.min(MAX_POINTS_PER_STROKE, remainingPoints);
  const points = rawPoints.slice(0, pointLimit).map(sanitizeDrawingPoint).filter(Boolean);
  if (!points.length) return null;

  return {
    id: sanitizeIdentifier(value.id, `stroke-${Date.now()}`),
    pageKey: sanitizeIdentifier(value.pageKey, "page"),
    tool: DRAWING_TOOLS.includes(value.tool) ? value.tool : "pen",
    color: sanitizeColor(value.color),
    size: clamp(Number(value.size || 10), 4, 64),
    points
  };
}

function sanitizeDrawingPoint(value) {
  if (!value || typeof value !== "object") return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1)
  };
}

function sanitizeColor(value) {
  const color = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^#[0-9a-f]{6}$/.test(color) ? color : DEFAULT_DRAWING_COLOR;
}

function sanitizeIdentifier(value, fallback) {
  const identifier = typeof value === "string" ? value.trim().slice(0, 180) : "";
  return identifier || fallback;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function clampInteger(value, min, max) {
  return Math.round(clamp(value, min, max));
}
