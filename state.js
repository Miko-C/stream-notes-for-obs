export const DEFAULT_SECONDS = 14;

const DEFAULT_DOCUMENT_TITLE = "新しい配信ノート";
const MAX_DOCUMENTS = 80;
const MAX_SOURCE_LENGTH = 750_000;

export function sanitizeState(value = {}, fallbackSource = "") {
  const rawDocuments = Array.isArray(value.documents) && value.documents.length
    ? value.documents
    : [legacyDocument(value, fallbackSource)];
  const documents = normalizeDocuments(rawDocuments);
  const safeDocuments = documents.length
    ? documents
    : [createDocument({ source: fallbackSource, title: deriveDocumentTitle(fallbackSource) })];
  const requestedActiveId = typeof value.activeDocumentId === "string" ? value.activeDocumentId : "";
  const activeDocumentId = safeDocuments.some((document) => document.id === requestedActiveId)
    ? requestedActiveId
    : safeDocuments[0].id;

  return {
    version: 2,
    documents: safeDocuments,
    activeDocumentId,
    autoAdvance: typeof value.autoAdvance === "boolean" ? value.autoAdvance : true,
    seconds: clamp(Number(value.seconds || DEFAULT_SECONDS), 6, 40),
    density: value.density === "compact" ? "compact" : "normal",
    textSize: ["normal", "large", "xlarge"].includes(value.textSize) ? value.textSize : "large",
    showTicker: typeof value.showTicker === "boolean" ? value.showTicker : true,
    outputHidden: Boolean(value.outputHidden),
    slideIndex: clamp(Number(value.slideIndex || 0), 0, 999),
    updatedAt: Number(value.updatedAt || 0)
  };
}

export function createDocument(input = {}) {
  const now = Date.now();
  const source = typeof input.source === "string" ? input.source.slice(0, MAX_SOURCE_LENGTH) : "";
  const fileName = typeof input.fileName === "string" ? input.fileName.slice(0, 240) : "";
  const explicitTitle = typeof input.title === "string" ? input.title.trim().slice(0, 160) : "";

  return {
    id: typeof input.id === "string" && input.id ? input.id : makeDocumentId(),
    title: explicitTitle || deriveDocumentTitle(source, fileName),
    titleLocked: Boolean(input.titleLocked),
    source,
    fileName,
    createdAt: Number(input.createdAt || now),
    updatedAt: Number(input.updatedAt || now)
  };
}

export function getActiveDocument(state) {
  return state.documents.find((document) => document.id === state.activeDocumentId) || state.documents[0];
}

export function deriveDocumentTitle(source = "", fileName = "") {
  const heading = String(source)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^#{1,4}\s+\S/.test(line));

  if (heading) {
    return cleanTitle(heading.replace(/^#{1,4}\s+/, ""));
  }

  const firstLine = String(source)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !/^[-*_]{3,}$/.test(line) && !/^(対象|テーマ|概要|用途)[:：]/.test(line));

  if (firstLine) {
    return cleanTitle(firstLine);
  }

  if (fileName) {
    return cleanTitle(String(fileName).replace(/\.(?:md|markdown|txt)$/i, ""));
  }

  return DEFAULT_DOCUMENT_TITLE;
}

function legacyDocument(value, fallbackSource) {
  const source = typeof value.source === "string" && value.source.trim() ? value.source : fallbackSource;
  const fileName = typeof value.fileName === "string" ? value.fileName : "";

  return {
    id: "legacy-document",
    source,
    fileName,
    title: deriveDocumentTitle(source, fileName),
    titleLocked: false,
    createdAt: Number(value.updatedAt || Date.now()),
    updatedAt: Number(value.updatedAt || Date.now())
  };
}

function normalizeDocuments(rawDocuments) {
  const seenIds = new Set();
  const documents = [];

  for (const item of rawDocuments.slice(0, MAX_DOCUMENTS)) {
    if (!item || typeof item !== "object") continue;
    const document = createDocument(item);
    while (seenIds.has(document.id)) {
      document.id = makeDocumentId();
    }
    seenIds.add(document.id);
    documents.push(document);
  }

  return documents;
}

function cleanTitle(value) {
  const title = String(value)
    .replace(/\*\*|__/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`|]/g, "")
    .trim()
    .slice(0, 160);
  return title || DEFAULT_DOCUMENT_TITLE;
}

function makeDocumentId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
