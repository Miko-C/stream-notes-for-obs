import assert from "node:assert/strict";
import {
  createDocument,
  deriveDocumentTitle,
  getActiveDocument,
  sanitizeState
} from "../state.js";

const legacy = sanitizeState({
  source: "# 保存済み文書\n\n本文",
  fileName: "saved.md",
  autoAdvance: false,
  updatedAt: 1234
});

assert.equal(legacy.version, 2);
assert.equal(legacy.documents.length, 1);
assert.equal(getActiveDocument(legacy).source, "# 保存済み文書\n\n本文");
assert.equal(getActiveDocument(legacy).title, "保存済み文書");
assert.equal(legacy.autoAdvance, false);
assert.equal(legacy.textSize, "large");

const extraLarge = sanitizeState({
  documents: legacy.documents,
  activeDocumentId: legacy.activeDocumentId,
  textSize: "xlarge"
});
assert.equal(extraLarge.textSize, "xlarge");

const document = createDocument({
  source: "テーマ：配信\n\n最初の一文",
  fileName: "notes.txt"
});

assert.equal(deriveDocumentTitle(document.source, document.fileName), "最初の一文");
assert.ok(document.id);

console.log("state ok");
