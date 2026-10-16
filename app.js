import {
  collectMetrics,
  mapOutsideMath,
  normalizeLatexForDisplay,
  parseMarkdownReport,
  splitIntoSlides
} from "./parser.js";
import {
  createDocument,
  deriveDocumentTitle,
  getActiveDocument,
  sanitizeState
} from "./state.js";
import {
  mergeInteractionState,
  sanitizeInteractionState
} from "./interaction.js";
import {
  calculateStageFit,
  isNativeStageSize,
  normalizeStagePoint,
  STAGE_HEIGHT,
  STAGE_WIDTH
} from "./stage-layout.js";
import renderMathInElement from "./node_modules/katex/dist/contrib/auto-render.mjs";

const STORAGE_KEY = "stream-notes-overlay:v2";
const LEGACY_STORAGE_KEY = "obs-market-overlay:v1";
const CHANNEL_NAME = "stream-notes-overlay";
const SAVE_DELAY = 420;
const MAX_INTERACTION_IN_FLIGHT = 1;
const TICKER_DURATION_MS = 52_000;
const DRAWING_TOOL_SIZES = {
  pen: 10,
  marker: 34,
  eraser: 44
};
const isOverlayView = new URLSearchParams(window.location.search).get("view") === "overlay";
const interactionClientId = globalThis.crypto?.randomUUID?.()
  || `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const sampleSource = `# AIデータセンター調査メモ

テーマ：配信トーク用

## 今回の要点

生成AIの普及で、計算資源だけでなく**電力・冷却・ネットワークを一体で考える必要性**が高まっています。GPUを増やすだけでは処理能力を十分に引き出せず、設備全体の設計が競争力を左右します。

## 指標の比較

- GPU稼働率：82％
- 冷却設備効率：68％
- 送電余力：44％

## 計算メモ

推定消費電力は $P = N \\times W$ と表せます。

$$E = P \\times t$$

## 方式ごとの特徴

| 方式 | 強み | 注意点 |
| --- | --- | --- |
| 空冷 | 導入しやすい | 高密度化に限界 |
| 液冷 | 高密度GPUに対応 | 設備更新が必要 |
| 液浸冷却 | 冷却効率が高い | 運用ノウハウが必要 |

## 配信で触れるポイント

- AI競争はチップ単体から設備全体へ広がっている
- **電力確保が次のボトルネック**になりやすい
- 新設だけでなく既存施設の更新需要も大きい`;

const app = document.querySelector("#app");
const channel = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL_NAME) : null;
let state = loadState();
let interaction = sanitizeInteractionState();
let slideIndex = Number(state.slideIndex || 0);
let lastDocumentId = "";
let lastSource = "";
let autoTimer = 0;
let pollTimer = 0;
let saveTimer = 0;
let interactionFrame = 0;
let interactionRenderFrame = 0;
let toastTimer = 0;
let libraryQuery = "";
let persistQueue = Promise.resolve();
let pendingInteractionPatch = {};
let interactionEvents = null;
let interactionInFlight = 0;
let inFlightInteractionPatch = {};
let pendingInteractionRender = createInteractionRenderFlags();
let interactionSequence = 0;
let stageResizeObserver = null;
let outputStatusTimer = 0;
let activeDrawingPointerId = null;
let activeStrokeId = "";

if (isOverlayView) {
  document.body.classList.add("overlay-only");
  app.innerHTML = `<main class="overlay-root"><div class="obs-stage" id="stage"></div></main>`;
} else {
  document.body.classList.add("control-view");
  app.innerHTML = controlTemplate();
}

const stage = document.querySelector("#stage");
const sourceInput = document.querySelector("#sourceInput");
const documentTitleInput = document.querySelector("#documentTitleInput");
const fileInput = document.querySelector("#fileInput");
const fileName = document.querySelector("#fileName");
const saveStatus = document.querySelector("#saveStatus");
const documentList = document.querySelector("#documentList");
const documentCount = document.querySelector("#documentCount");
const documentSearch = document.querySelector("#documentSearch");
const characterCount = document.querySelector("#characterCount");
const speakingTime = document.querySelector("#speakingTime");
const updatedTime = document.querySelector("#updatedTime");
const autoToggle = document.querySelector("#autoToggle");
const speedInput = document.querySelector("#speedInput");
const speedValue = document.querySelector("#speedValue");
const densityInput = document.querySelector("#densityInput");
const textSizeInput = document.querySelector("#textSizeInput");
const tickerToggle = document.querySelector("#tickerToggle");
const pointerToggle = document.querySelector("#pointerToggle");
const drawingToggle = document.querySelector("#drawingToggle");
const drawingSizeInput = document.querySelector("#drawingSizeInput");
const drawingSizeValue = document.querySelector("#drawingSizeValue");
const contentScrollControls = document.querySelector("#contentScrollControls");
const contentScrollStatus = document.querySelector("#contentScrollStatus");
const calloutInput = document.querySelector("#calloutInput");
const calloutTone = document.querySelector("#calloutTone");
const obsQualityStatus = document.querySelector("#obsQualityStatus");
const outputToggleButton = document.querySelector("#outputToggleButton");
const prevButton = document.querySelector("#prevButton");
const nextButton = document.querySelector("#nextButton");
const slideRange = document.querySelector("#slideRange");
const slideNumberInput = document.querySelector("#slideNumberInput");
const slideStatus = document.querySelector("#slideStatus");
const toast = document.querySelector("#toast");

wireControls();
wireSharedEvents();
wireStageInteraction();
wireContentScroll();
wireStageSizing();
renderAll();
restartAutoTimer();
startInteractionSync();
startOutputStatus();

if (isOverlayView) {
  pollTimer = window.setInterval(syncFromServer, 900);
}
syncFromServer(true);

function controlTemplate() {
  return `
    <main class="app-shell" id="dropZone">
      <aside class="library-pane">
        <header class="library-header">
          <div>
            <p class="eyebrow">STREAM NOTES</p>
            <h1>配信ノート</h1>
          </div>
          <button class="control-button strong" id="newDocumentButton" type="button">新規</button>
        </header>

        <div class="library-tools">
          <label class="search-field">
            <span class="sr-only">文書を検索</span>
            <input id="documentSearch" type="search" placeholder="文書を検索" autocomplete="off">
          </label>
          <div class="import-row">
            <label class="file-button" for="fileInput">ファイル追加</label>
            <input id="fileInput" type="file" multiple accept=".md,.markdown,.txt,text/markdown,text/plain">
            <button class="control-button" id="pasteButton" type="button">貼り付けて追加</button>
          </div>
        </div>

        <div class="library-summary">
          <span>文書</span>
          <strong id="documentCount"></strong>
        </div>
        <div class="document-list" id="documentList"></div>
        <footer class="library-footer">
          <button class="text-button" id="sampleButton" type="button">サンプルを追加</button>
        </footer>
      </aside>

      <section class="editor-pane">
        <header class="editor-header">
          <label class="title-field">
            <span>文書タイトル</span>
            <input id="documentTitleInput" type="text" maxlength="160" autocomplete="off">
          </label>
          <div class="editor-actions">
            <button class="control-button" id="duplicateButton" type="button">複製</button>
            <button class="control-button danger" id="deleteButton" type="button">削除</button>
          </div>
        </header>
        <div class="editor-meta">
          <span id="fileName"></span>
          <span id="saveStatus" aria-live="polite">保存済</span>
        </div>
        <textarea id="sourceInput" spellcheck="false" aria-label="配信文書の本文" placeholder="本文"></textarea>
        <footer class="editor-status">
          <span id="characterCount"></span>
          <span id="speakingTime"></span>
          <span id="updatedTime"></span>
        </footer>
      </section>

      <section class="preview-pane">
        <div class="preview-toolbar">
          <div class="broadcast-settings">
            <label class="toggle-line">
              <input id="autoToggle" type="checkbox">
              <span>自動送り</span>
            </label>
            <label class="range-line">
              <span id="speedValue"></span>
              <input id="speedInput" type="range" min="6" max="40" step="1">
            </label>
            <label class="select-line">
              <span>文字量</span>
              <select id="densityInput">
                <option value="normal">通常</option>
                <option value="compact">多め</option>
              </select>
            </label>
            <label class="select-line">
              <span>文字サイズ</span>
              <select id="textSizeInput">
                <option value="normal">標準</option>
                <option value="large">大</option>
                <option value="xlarge">特大</option>
              </select>
            </label>
            <label class="toggle-line">
              <input id="tickerToggle" type="checkbox">
              <span>テロップ</span>
            </label>
            <button class="quality-status" id="obsQualityStatus" type="button" title="クリックしてOBS推奨設定をコピー">OBS確認中</button>
          </div>
          <div class="stage-controls">
            <button class="control-button output-toggle" id="outputToggleButton" type="button"></button>
            <button class="icon-button" id="prevButton" type="button" aria-label="前のページ">&#8249;</button>
            <div class="page-navigation" aria-label="ページ移動">
              <label class="slide-range-field">
                <span class="sr-only">ページスライダー</span>
                <input id="slideRange" type="range" min="1" max="1" step="1" value="1" aria-label="ページスライダー">
              </label>
              <label class="page-number-field">
                <span class="sr-only">移動先ページ</span>
                <input id="slideNumberInput" type="number" min="1" max="1" step="1" value="1" inputmode="numeric" aria-label="移動先ページ">
                <span id="slideStatus">/ 1</span>
              </label>
            </div>
            <button class="icon-button" id="nextButton" type="button" aria-label="次のページ">&#8250;</button>
            <div class="content-scroll-controls" id="contentScrollControls" hidden>
              <button class="icon-button compact" id="scrollTopButton" type="button" aria-label="内容の先頭へ" title="内容の先頭へ">&#8613;</button>
              <button class="icon-button compact" id="scrollUpButton" type="button" aria-label="内容を上へ" title="内容を上へ">&#8593;</button>
              <span id="contentScrollStatus">0%</span>
              <button class="icon-button compact" id="scrollDownButton" type="button" aria-label="内容を下へ" title="内容を下へ">&#8595;</button>
            </div>
            <button class="control-button strong" id="openOverlayButton" type="button">OBS表示</button>
            <button class="control-button" id="copyOverlayButton" type="button">URLコピー</button>
          </div>
          <div class="interaction-controls">
            <div class="pointer-controls">
              <label class="toggle-line">
                <input id="pointerToggle" type="checkbox">
                <span>ポインター</span>
              </label>
              <div class="pointer-mode-switch" role="group" aria-label="ポインターの種類">
                <button class="mode-button" type="button" data-pointer-mode="cursor" aria-pressed="true">矢印</button>
                <button class="mode-button" type="button" data-pointer-mode="laser" aria-pressed="false">レーザー</button>
                <button class="mode-button" type="button" data-pointer-mode="spotlight" aria-pressed="false">スポット</button>
              </div>
            </div>
            <div class="callout-controls">
              <label class="sr-only" for="calloutTone">メッセージの種類</label>
              <select id="calloutTone" aria-label="メッセージの種類">
                <option value="question">質問</option>
                <option value="note">注目</option>
                <option value="answer">回答</option>
              </select>
              <label class="sr-only" for="calloutInput">配信メッセージ</label>
              <input id="calloutInput" type="text" maxlength="220" placeholder="配信画面へ短いメッセージ" autocomplete="off">
              <button class="control-button strong" id="showCalloutButton" type="button">表示</button>
              <button class="icon-button compact" id="clearCalloutButton" type="button" aria-label="メッセージを消す" title="メッセージを消す">&times;</button>
            </div>
          </div>
          <div class="drawing-controls">
            <label class="toggle-line">
              <input id="drawingToggle" type="checkbox">
              <span>描画</span>
            </label>
            <div class="drawing-tool-switch" role="group" aria-label="描画ツール">
              <button class="mode-button" type="button" data-drawing-tool="pen" aria-pressed="true">ペン</button>
              <button class="mode-button" type="button" data-drawing-tool="marker" aria-pressed="false">マーカー</button>
              <button class="mode-button" type="button" data-drawing-tool="eraser" aria-pressed="false">消しゴム</button>
            </div>
            <div class="color-swatches" role="group" aria-label="描画色">
              <button class="color-swatch" type="button" data-drawing-color="#f1b84c" style="--swatch: #f1b84c" aria-label="黄色" title="黄色"></button>
              <button class="color-swatch" type="button" data-drawing-color="#ee687c" style="--swatch: #ee687c" aria-label="赤" title="赤"></button>
              <button class="color-swatch" type="button" data-drawing-color="#52d3aa" style="--swatch: #52d3aa" aria-label="緑" title="緑"></button>
              <button class="color-swatch" type="button" data-drawing-color="#8fb6ff" style="--swatch: #8fb6ff" aria-label="青" title="青"></button>
              <button class="color-swatch" type="button" data-drawing-color="#f7f4ea" style="--swatch: #f7f4ea" aria-label="白" title="白"></button>
            </div>
            <label class="drawing-size-control">
              <span>太さ</span>
              <input id="drawingSizeInput" type="range" min="4" max="64" step="1">
              <output id="drawingSizeValue"></output>
            </label>
            <button class="icon-button compact" id="undoDrawingButton" type="button" aria-label="描画を一つ戻す" title="描画を一つ戻す">&#8630;</button>
            <button class="control-button" id="clearDrawingButton" type="button">ページ消去</button>
          </div>
        </div>
        <div class="preview-frame">
          <div class="obs-stage" id="stage"></div>
        </div>
      </section>
      <div class="toast" id="toast" role="status" aria-live="polite"></div>
    </main>
  `;
}

function wireControls() {
  if (sourceInput) {
    sourceInput.addEventListener("input", () => {
      const current = getActiveDocument(state);
      const title = current.titleLocked
        ? current.title
        : deriveDocumentTitle(sourceInput.value, current.fileName);
      updateActiveDocument({ source: sourceInput.value, title });
    });
  }

  if (documentTitleInput) {
    documentTitleInput.addEventListener("input", () => {
      updateActiveDocument({ title: documentTitleInput.value, titleLocked: true }, { syncTitle: false });
    });
  }

  fileInput?.addEventListener("change", async () => {
    await importFiles(fileInput.files);
    fileInput.value = "";
  });

  documentSearch?.addEventListener("input", () => {
    libraryQuery = documentSearch.value.trim().toLocaleLowerCase("ja");
    renderDocumentList();
  });

  documentList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-document-id]");
    if (button) activateDocument(button.dataset.documentId);
  });

  document.querySelector("#newDocumentButton")?.addEventListener("click", () => {
    addDocument(createDocument({ title: "新しい配信ノート", titleLocked: false }));
    sourceInput?.focus();
  });

  document.querySelector("#pasteButton")?.addEventListener("click", addClipboardDocument);
  document.querySelector("#duplicateButton")?.addEventListener("click", duplicateActiveDocument);
  document.querySelector("#deleteButton")?.addEventListener("click", deleteActiveDocument);
  document.querySelector("#sampleButton")?.addEventListener("click", () => {
    addDocument(createDocument({ source: sampleSource, title: deriveDocumentTitle(sampleSource), fileName: "サンプル.md" }));
  });

  autoToggle?.addEventListener("change", () => commitState({ autoAdvance: autoToggle.checked }));
  speedInput?.addEventListener("input", () => {
    if (speedValue) speedValue.textContent = `${speedInput.value}秒`;
    commitState({ seconds: clamp(Number(speedInput.value), 6, 40) });
  });
  densityInput?.addEventListener("change", () => commitState({ density: densityInput.value, slideIndex: 0 }));
  textSizeInput?.addEventListener("change", () => commitState({ textSize: textSizeInput.value, slideIndex: 0 }));
  tickerToggle?.addEventListener("change", () => commitState({ showTicker: tickerToggle.checked }));
  obsQualityStatus?.addEventListener("click", copyObsQualitySettings);
  pointerToggle?.addEventListener("change", () => {
    queueInteractionPatch({
      pointer: {
        enabled: pointerToggle.checked,
        visible: pointerToggle.checked ? interaction.pointer.visible : false
      },
      drawing: {
        enabled: pointerToggle.checked ? false : interaction.drawing.enabled
      }
    }, true);
  });

  document.querySelectorAll("[data-pointer-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      queueInteractionPatch({
        pointer: {
          enabled: true,
          mode: button.dataset.pointerMode
        },
        drawing: {
          enabled: false
        }
      }, true);
    });
  });

  drawingToggle?.addEventListener("change", () => {
    setDrawingEnabled(drawingToggle.checked);
  });

  document.querySelectorAll("[data-drawing-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      selectDrawingTool(button.dataset.drawingTool);
    });
  });

  document.querySelectorAll("[data-drawing-color]").forEach((button) => {
    button.addEventListener("click", () => {
      queueInteractionPatch({
        drawing: {
          enabled: true,
          color: button.dataset.drawingColor,
          tool: interaction.drawing.tool === "eraser" ? "pen" : interaction.drawing.tool
        },
        pointer: {
          enabled: false,
          visible: false
        }
      }, true);
    });
  });

  drawingSizeInput?.addEventListener("input", () => {
    queueInteractionPatch({
      drawing: {
        size: Number(drawingSizeInput.value)
      }
    });
  });

  document.querySelector("#undoDrawingButton")?.addEventListener("click", undoCurrentPageDrawing);
  document.querySelector("#clearDrawingButton")?.addEventListener("click", clearCurrentPageDrawing);

  document.querySelector("#showCalloutButton")?.addEventListener("click", showCallout);
  document.querySelector("#clearCalloutButton")?.addEventListener("click", () => {
    queueInteractionPatch({ callout: { visible: false } }, true);
  });
  calloutInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      showCallout();
    }
  });
  calloutTone?.addEventListener("change", () => {
    queueInteractionPatch({ callout: { tone: calloutTone.value } }, true);
  });

  outputToggleButton?.addEventListener("click", () => commitState({ outputHidden: !state.outputHidden }));
  document.querySelector("#openOverlayButton")?.addEventListener("click", () => {
    window.open(overlayUrl(), "stream-notes-overlay");
  });
  document.querySelector("#copyOverlayButton")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(overlayUrl());
      setButtonFlash("#copyOverlayButton", "コピー済");
    } catch {
      showToast("URLをコピーできませんでした", true);
    }
  });

  prevButton?.addEventListener("click", () => moveSlide(-1, true));
  nextButton?.addEventListener("click", () => moveSlide(1, true));
  slideRange?.addEventListener("input", () => goToSlide(Number(slideRange.value) - 1, false));
  slideRange?.addEventListener("change", () => goToSlide(Number(slideRange.value) - 1, true));
  slideNumberInput?.addEventListener("change", commitSlideNumber);
  slideNumberInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commitSlideNumber();
    slideNumberInput.select();
  });
  document.querySelector("#scrollTopButton")?.addEventListener("click", () => scrollContentToTop(true));
  document.querySelector("#scrollUpButton")?.addEventListener("click", () => scrollContentBy(-0.72, true));
  document.querySelector("#scrollDownButton")?.addEventListener("click", () => scrollContentBy(0.72, true));

  const dropZone = document.querySelector("#dropZone");
  dropZone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  });
  dropZone?.addEventListener("dragleave", (event) => {
    if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove("is-dragging");
  });
  dropZone?.addEventListener("drop", async (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
    await importFiles(event.dataTransfer?.files);
  });
}

function wireSharedEvents() {
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || isEditingTarget(event.target)) return;
    if (event.key === "ArrowLeft") moveSlide(-1, true);
    if (event.key === "ArrowRight") moveSlide(1, true);
    if (event.key.toLocaleLowerCase() === "p") {
      const pointerEnabled = !interaction.pointer.enabled;
      queueInteractionPatch({
        pointer: {
          enabled: pointerEnabled,
          visible: false
        },
        drawing: {
          enabled: pointerEnabled ? false : interaction.drawing.enabled
        }
      }, true);
    }
    if (event.key === "Escape") {
      activeDrawingPointerId = null;
      activeStrokeId = "";
      queueInteractionPatch({
        pointer: { visible: false },
        callout: { visible: false },
        drawing: { enabled: false }
      }, true);
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY && event.newValue) {
      receiveState(JSON.parse(event.newValue));
    }
  });

  channel?.addEventListener("message", (event) => {
    if (event.data?.type === "state") receiveState(event.data.state);
  });

  window.addEventListener("beforeunload", () => {
    window.clearInterval(autoTimer);
    window.clearInterval(pollTimer);
    window.clearTimeout(saveTimer);
    window.cancelAnimationFrame(interactionFrame);
    window.cancelAnimationFrame(interactionRenderFrame);
    window.clearInterval(outputStatusTimer);
    persistLocally(state);
    interactionEvents?.close();
    stageResizeObserver?.disconnect();
    window.removeEventListener("resize", fitStageToHost);
    channel?.close();
  });
}

function startOutputStatus() {
  if (isOverlayView) {
    const report = () => {
      queueInteractionPatch({
        output: {
          width: window.innerWidth,
          height: window.innerHeight,
          dpr: window.devicePixelRatio || 1,
          updatedAt: Date.now()
        }
      }, true);
    };
    report();
    window.addEventListener("resize", report);
    outputStatusTimer = window.setInterval(report, 5_000);
    return;
  }

  outputStatusTimer = window.setInterval(updateObsQualityStatus, 5_000);
}

async function copyObsQualitySettings() {
  const instructions = [
    "OBSブラウザソースの高画質設定",
    "・同じ表示URLのブラウザソースは1つだけ表示",
    "・プロパティ: 幅 1920 / 高さ 1080 / FPS 60",
    "・右クリック → 変換 → 変換をリセット",
    "・右クリック → ブラウザのキャッシュを更新",
    "・出力縮小フィルタ: Lanczos"
  ].join("\n");

  try {
    await navigator.clipboard.writeText(instructions);
    showToast("OBS高画質設定の手順をコピーしました");
  } catch {
    showToast("OBS高画質設定の手順をコピーできませんでした", true);
  }
}

function wireStageSizing() {
  if (!stage) return;
  window.addEventListener("resize", fitStageToHost);
  if ("ResizeObserver" in window) {
    stageResizeObserver = new ResizeObserver(fitStageToHost);
    stageResizeObserver.observe(stage.parentElement);
  }
  window.requestAnimationFrame(fitStageToHost);
}

function fitStageToHost() {
  if (!stage?.parentElement) return;
  const host = stage.parentElement;
  const style = window.getComputedStyle(host);
  const width = host.clientWidth
    - parseFloat(style.paddingLeft || 0)
    - parseFloat(style.paddingRight || 0);
  const height = host.clientHeight
    - parseFloat(style.paddingTop || 0)
    - parseFloat(style.paddingBottom || 0);
  const fit = calculateStageFit(width, height);
  const nativeResolution = isOverlayView && isNativeStageSize(width, height);
  stage.style.setProperty("--stage-scale", String(fit.scale));
  stage.classList.toggle("is-native-resolution", nativeResolution);
  stage.dataset.logicalSize = `${STAGE_WIDTH}x${STAGE_HEIGHT}`;
  stage.dataset.renderMode = nativeResolution ? "pixel-native" : "scaled";
}

function wireStageInteraction() {
  if (!stage) return;

  stage.addEventListener("pointermove", (event) => {
    if (interaction.drawing.enabled) {
      event.preventDefault();
      const points = getStagePoints(event);
      const latest = points.at(-1);
      if (!latest) return;

      if (activeDrawingPointerId === event.pointerId && activeStrokeId) {
        appendDrawingPoints(points);
      } else {
        queueInteractionPatch({
          pointer: {
            visible: true,
            x: latest.x,
            y: latest.y
          }
        });
      }
      return;
    }

    if (!interaction.pointer.enabled) return;
    const point = getStagePoint(event);
    queueInteractionPatch({
      pointer: {
        visible: true,
        x: point.x,
        y: point.y
      }
    });
  });

  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;

    if (interaction.drawing.enabled) {
      event.preventDefault();
      activeDrawingPointerId = event.pointerId;
      activeStrokeId = `${interactionClientId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      stage.setPointerCapture?.(event.pointerId);
      beginDrawingStroke(getStagePoint(event));
      return;
    }

    if (!interaction.pointer.enabled) return;
    event.preventDefault();
    const point = getStagePoint(event);
    queueInteractionPatch({
      pointer: {
        visible: true,
        x: point.x,
        y: point.y,
        clickId: Date.now()
      }
    }, true);
  });

  stage.addEventListener("pointerup", finishDrawingStroke);
  stage.addEventListener("pointercancel", finishDrawingStroke);
  stage.addEventListener("lostpointercapture", finishDrawingStroke);

  stage.addEventListener("pointerleave", () => {
    if (activeDrawingPointerId !== null || !interaction.pointer.visible) return;
    if (!interaction.pointer.enabled && !interaction.drawing.enabled) return;
    queueInteractionPatch({ pointer: { visible: false } }, true);
  });
}

function wireContentScroll() {
  if (!stage) return;
  stage.addEventListener("wheel", (event) => {
    const content = stage.querySelector(".slide-content");
    if (!content) return;
    const maxX = Math.max(0, content.scrollWidth - content.clientWidth);
    const maxY = Math.max(0, content.scrollHeight - content.clientHeight);
    if (maxX <= 1 && maxY <= 1) return;

    event.preventDefault();
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 28
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? content.clientHeight
        : 1;
    const horizontal = event.shiftKey || maxY <= 1 || Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const deltaX = horizontal ? (event.deltaX || event.deltaY) * unit : event.deltaX * unit;
    const deltaY = horizontal ? 0 : event.deltaY * unit;
    setCurrentPageScroll(
      maxX > 0 ? (content.scrollLeft + deltaX) / maxX : 0,
      maxY > 0 ? (content.scrollTop + deltaY) / maxY : 0
    );
  }, { passive: false });
}

function getStagePoint(event) {
  const bounds = stage.getBoundingClientRect();
  const coalesced = typeof event.getCoalescedEvents === "function"
    ? event.getCoalescedEvents()
    : [];
  const latest = coalesced.at(-1) || event;
  return normalizeStagePoint(latest.clientX, latest.clientY, bounds);
}

function getStagePoints(event) {
  const bounds = stage.getBoundingClientRect();
  const coalesced = typeof event.getCoalescedEvents === "function"
    ? event.getCoalescedEvents()
    : [];
  const samples = coalesced.length ? coalesced : [event];
  return samples.map((sample) => normalizeStagePoint(sample.clientX, sample.clientY, bounds));
}

function setDrawingEnabled(enabled) {
  activeDrawingPointerId = null;
  activeStrokeId = "";
  queueInteractionPatch({
    drawing: { enabled },
    pointer: {
      enabled: enabled ? false : interaction.pointer.enabled,
      visible: false
    }
  }, true);
}

function selectDrawingTool(tool) {
  if (!Object.hasOwn(DRAWING_TOOL_SIZES, tool)) return;
  let size = interaction.drawing.size;
  if (tool === "pen" && size > 20) size = DRAWING_TOOL_SIZES.pen;
  if (tool === "marker" && size < 20) size = DRAWING_TOOL_SIZES.marker;
  if (tool === "eraser" && size < 28) size = DRAWING_TOOL_SIZES.eraser;

  queueInteractionPatch({
    drawing: {
      enabled: true,
      tool,
      size
    },
    pointer: {
      enabled: false,
      visible: false
    }
  }, true);
}

function beginDrawingStroke(point) {
  const stroke = {
    id: activeStrokeId,
    pageKey: currentPageKey(),
    tool: interaction.drawing.tool,
    color: interaction.drawing.color,
    size: interaction.drawing.size,
    points: [point]
  };

  queueInteractionPatch({
    drawing: {
      strokes: [...interaction.drawing.strokes, stroke]
    },
    pointer: {
      visible: true,
      x: point.x,
      y: point.y
    }
  }, true);
}

function appendDrawingPoints(points, immediate = false) {
  if (!activeStrokeId || !points.length) return;
  const strokeIndex = interaction.drawing.strokes.findIndex((stroke) => stroke.id === activeStrokeId);
  if (strokeIndex < 0) return;

  const stroke = interaction.drawing.strokes[strokeIndex];
  const nextPoints = [...stroke.points];
  for (const point of points) {
    const previous = nextPoints.at(-1);
    if (!previous || drawingPointDistance(previous, point) >= 1.5) {
      nextPoints.push(point);
    }
  }

  const latest = nextPoints.at(-1);
  if (nextPoints.length === stroke.points.length || !latest) return;
  const strokes = interaction.drawing.strokes.slice();
  strokes[strokeIndex] = { ...stroke, points: nextPoints };
  queueInteractionPatch({
    drawing: { strokes },
    pointer: {
      visible: true,
      x: latest.x,
      y: latest.y
    }
  }, immediate);
}

function finishDrawingStroke(event) {
  if (activeDrawingPointerId !== event.pointerId || !activeStrokeId) return;
  appendDrawingPoints(getStagePoints(event), true);
  if (stage.hasPointerCapture?.(event.pointerId)) {
    stage.releasePointerCapture(event.pointerId);
  }
  activeDrawingPointerId = null;
  activeStrokeId = "";
}

function drawingPointDistance(first, second) {
  return Math.hypot(
    (second.x - first.x) * STAGE_WIDTH,
    (second.y - first.y) * STAGE_HEIGHT
  );
}

function currentPageKey() {
  const current = getActiveDocument(state);
  return `${current.id}:${slideIndex}`;
}

function undoCurrentPageDrawing() {
  const pageKey = currentPageKey();
  const strokes = interaction.drawing.strokes.slice();
  let index = strokes.length - 1;
  while (index >= 0 && strokes[index].pageKey !== pageKey) index -= 1;
  if (index < 0) {
    showToast("このページに戻せる描画はありません", true);
    return;
  }
  strokes.splice(index, 1);
  queueInteractionPatch({ drawing: { strokes } }, true);
}

function clearCurrentPageDrawing() {
  const pageKey = currentPageKey();
  const strokes = interaction.drawing.strokes.filter((stroke) => stroke.pageKey !== pageKey);
  if (strokes.length === interaction.drawing.strokes.length) {
    showToast("このページに描画はありません", true);
    return;
  }
  queueInteractionPatch({ drawing: { strokes } }, true);
}

function showCallout() {
  const text = calloutInput?.value.trim() || "";
  if (!text) {
    showToast("表示するメッセージを入力してください", true);
    calloutInput?.focus();
    return;
  }

  queueInteractionPatch({
    callout: {
      visible: true,
      text,
      tone: calloutTone?.value || interaction.callout.tone
    }
  }, true);
}

function startInteractionSync() {
  loadInteractionState().then((next) => {
    if (next) receiveInteractionState(next);
  });

  if (!("EventSource" in window)) return;
  interactionEvents = new EventSource("./api/interaction/events?format=patch");
  interactionEvents.addEventListener("message", (event) => {
    try {
      receiveInteractionMessage(JSON.parse(event.data));
    } catch {
      // A later event or the initial fetch will restore the interaction state.
    }
  });
}

async function loadInteractionState() {
  try {
    const response = await fetch("./api/interaction", { cache: "no-store" });
    if (!response.ok) return null;
    return sanitizeInteractionState(await response.json());
  } catch {
    return null;
  }
}

function queueInteractionPatch(patch, immediate = false) {
  interaction = mergeInteractionState(interaction, patch, interaction.revision);
  pendingInteractionPatch = mergeInteractionPatch(pendingInteractionPatch, patch);
  scheduleInteractionRender(interactionRenderFlagsForPatch(patch), immediate);

  if (immediate) {
    window.cancelAnimationFrame(interactionFrame);
    interactionFrame = 0;
    flushInteractionPatch();
  } else {
    scheduleInteractionFlush();
  }
}

function scheduleInteractionFlush() {
  if (interactionFrame) return;
  interactionFrame = window.requestAnimationFrame(() => {
    interactionFrame = 0;
    flushInteractionPatch();
  });
}

function flushInteractionPatch() {
  if (interactionInFlight >= MAX_INTERACTION_IN_FLIGHT) return;
  const patch = pendingInteractionPatch;
  pendingInteractionPatch = {};
  if (!Object.keys(patch).length) return;

  interactionInFlight += 1;
  inFlightInteractionPatch = patch;
  interactionSequence += 1;
  fetch("./api/interaction", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...patch,
      clientId: interactionClientId,
      sequence: interactionSequence
    })
  })
    .then(async (response) => {
      if (!response.ok) throw new Error("interaction update failed");
      receiveInteractionMessage(await response.json());
    })
    .catch(() => {
      if (!isOverlayView) showToast("OBSとの操作同期が途切れました", true);
    })
    .finally(() => {
      interactionInFlight = Math.max(0, interactionInFlight - 1);
      inFlightInteractionPatch = {};
      if (Object.keys(pendingInteractionPatch).length) {
        scheduleInteractionFlush();
      }
    });
}

function receiveInteractionMessage(message) {
  if (message?.type === "snapshot") {
    receiveInteractionState(message.state);
    return;
  }
  if (message?.type === "patch") {
    receiveInteractionPatch(message.patch, message.revision);
    return;
  }
  receiveInteractionState(message);
}

function receiveInteractionState(nextState) {
  const next = sanitizeInteractionState(nextState);
  if (next.revision < interaction.revision) return;
  const optimisticPatch = currentOptimisticInteractionPatch();
  interaction = Object.keys(optimisticPatch).length
    ? mergeInteractionState(next, optimisticPatch, next.revision)
    : next;
  scheduleInteractionRender({ canvas: true, scroll: true, controls: true });
}

function receiveInteractionPatch(patch, revision) {
  const nextRevision = Number(revision || 0);
  if (!patch || typeof patch !== "object" || nextRevision <= interaction.revision) return;

  let next = mergeInteractionState(interaction, patch, nextRevision);
  const optimisticPatch = currentOptimisticInteractionPatch();
  if (Object.keys(optimisticPatch).length) {
    next = mergeInteractionState(next, optimisticPatch, nextRevision);
  }
  interaction = next;
  scheduleInteractionRender(interactionRenderFlagsForPatch(patch));
}

function currentOptimisticInteractionPatch() {
  return mergeInteractionPatch(inFlightInteractionPatch, pendingInteractionPatch);
}

function createInteractionRenderFlags() {
  return { requested: false, canvas: false, scroll: false, controls: false };
}

function interactionRenderFlagsForPatch(patch = {}) {
  const pointerKeys = Object.keys(patch.pointer || {});
  return {
    canvas: Object.hasOwn(patch, "drawing"),
    scroll: Object.hasOwn(patch, "scroll"),
    controls: Boolean(
      patch.callout
      || patch.drawing
      || patch.output
      || pointerKeys.some((key) => key === "enabled" || key === "mode")
    )
  };
}

function scheduleInteractionRender(flags = {}, immediate = false) {
  pendingInteractionRender.requested = true;
  pendingInteractionRender.canvas ||= Boolean(flags.canvas);
  pendingInteractionRender.scroll ||= Boolean(flags.scroll);
  pendingInteractionRender.controls ||= Boolean(flags.controls);

  if (immediate) {
    window.cancelAnimationFrame(interactionRenderFrame);
    interactionRenderFrame = 0;
    flushInteractionRender();
    return;
  }
  if (interactionRenderFrame) return;
  interactionRenderFrame = window.requestAnimationFrame(() => {
    interactionRenderFrame = 0;
    flushInteractionRender();
  });
}

function flushInteractionRender() {
  const flags = pendingInteractionRender;
  pendingInteractionRender = createInteractionRenderFlags();
  if (!flags.requested) return;
  renderInteraction({ redrawCanvas: flags.canvas, applyScroll: flags.scroll });
  if (flags.controls) syncInteractionControls();
}

function mergeInteractionPatch(current, patch) {
  return {
    ...current,
    ...patch,
    ...(current.pointer || patch.pointer ? {
      pointer: { ...(current.pointer || {}), ...(patch.pointer || {}) }
    } : {}),
    ...(current.callout || patch.callout ? {
      callout: { ...(current.callout || {}), ...(patch.callout || {}) }
    } : {}),
    ...(current.drawing || patch.drawing ? {
      drawing: { ...(current.drawing || {}), ...(patch.drawing || {}) }
    } : {}),
    ...(current.scroll || patch.scroll ? {
      scroll: { ...(current.scroll || {}), ...(patch.scroll || {}) }
    } : {}),
    ...(current.output || patch.output ? {
      output: { ...(current.output || {}), ...(patch.output || {}) }
    } : {})
  };
}

async function importFiles(fileList) {
  const files = [...(fileList || [])].filter(isSupportedTextFile);
  if (!files.length) {
    showToast("md または txt ファイルを選択してください", true);
    return;
  }

  try {
    const imported = [];
    for (const file of files) {
      const source = await file.text();
      imported.push(createDocument({
        source,
        fileName: file.name,
        title: deriveDocumentTitle(source, file.name),
        titleLocked: false
      }));
    }
    addDocuments(imported);
    showToast(`${imported.length}件の文書を追加しました`);
  } catch {
    showToast("ファイルを読み込めませんでした", true);
  }
}

async function addClipboardDocument() {
  try {
    const source = await navigator.clipboard.readText();
    if (!source.trim()) {
      showToast("クリップボードに文章がありません", true);
      return;
    }
    addDocument(createDocument({
      source,
      fileName: "クリップボード",
      title: deriveDocumentTitle(source),
      titleLocked: false
    }));
    showToast("クリップボードから文書を追加しました");
  } catch {
    showToast("クリップボードを読み取れませんでした", true);
  }
}

function addDocument(document) {
  addDocuments([document]);
}

function addDocuments(documents) {
  if (!documents.length) return;
  commitState({
    documents: [...documents, ...state.documents],
    activeDocumentId: documents[0].id,
    slideIndex: 0
  });
  sourceInput?.focus();
}

function duplicateActiveDocument() {
  const current = getActiveDocument(state);
  const copy = createDocument({
    source: current.source,
    fileName: current.fileName,
    title: `${displayDocumentTitle(current)} のコピー`,
    titleLocked: true
  });
  addDocument(copy);
  showToast("文書を複製しました");
}

function deleteActiveDocument() {
  const current = getActiveDocument(state);
  if (!window.confirm(`「${displayDocumentTitle(current)}」を削除しますか？`)) return;

  const remaining = state.documents.filter((document) => document.id !== current.id);
  const documents = remaining.length ? remaining : [createDocument({ title: "新しい配信ノート" })];
  commitState({
    documents,
    activeDocumentId: documents[0].id,
    slideIndex: 0
  });
  showToast("文書を削除しました");
}

function activateDocument(documentId) {
  if (!state.documents.some((document) => document.id === documentId) || documentId === state.activeDocumentId) return;
  commitState({ activeDocumentId: documentId, slideIndex: 0 });
}

function updateActiveDocument(patch, options = {}) {
  const revision = nextRevision();
  const documents = state.documents.map((document) => document.id === state.activeDocumentId
    ? { ...document, ...patch, updatedAt: revision }
    : document);

  state = {
    ...state,
    documents,
    slideIndex: patch.source !== undefined ? 0 : state.slideIndex,
    updatedAt: revision
  };

  if (patch.source !== undefined) slideIndex = 0;
  if (options.syncTitle !== false && documentTitleInput) {
    documentTitleInput.value = displayDocumentTitle(getActiveDocument(state));
  }
  if (saveStatus) saveStatus.textContent = "保存中";
  renderDocumentList();
  renderEditorMeta();
  renderStage();
  schedulePublish();
}

function commitState(patch) {
  window.clearTimeout(saveTimer);
  const revision = nextRevision();
  const activeChanged = patch.activeDocumentId && patch.activeDocumentId !== state.activeDocumentId;
  state = sanitizeState({ ...state, ...patch, updatedAt: revision }, sampleSource);
  if (activeChanged || patch.slideIndex === 0) slideIndex = 0;
  if (patch.slideIndex !== undefined) slideIndex = Number(patch.slideIndex || 0);
  publishState();
  renderAll();
  restartAutoTimer();
}

function schedulePublish() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => publishState(), SAVE_DELAY);
}

function publishState() {
  window.clearTimeout(saveTimer);
  saveTimer = 0;
  state = sanitizeState(state, sampleSource);
  const snapshot = JSON.parse(JSON.stringify(state));
  const revision = snapshot.updatedAt;

  persistLocally(snapshot);
  channel?.postMessage({ type: "state", state: snapshot });

  persistQueue = persistQueue
    .catch(() => {})
    .then(async () => {
      const response = await fetch("./api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot)
      });
      if (!response.ok) throw new Error("save failed");
      if (saveStatus && state.updatedAt === revision) saveStatus.textContent = "保存済";
    })
    .catch(() => {
      if (saveStatus && state.updatedAt === revision) saveStatus.textContent = "保存失敗";
    });
}

function receiveState(nextState) {
  const next = sanitizeState(nextState, sampleSource);
  if (next.updatedAt < state.updatedAt) return;
  const current = getActiveDocument(state);
  const incoming = getActiveDocument(next);
  const sourceChanged = current.id !== incoming.id || current.source !== incoming.source;
  state = next;
  slideIndex = sourceChanged ? Number(next.slideIndex || 0) : Number(next.slideIndex ?? slideIndex);
  renderAll();
  restartAutoTimer();
}

async function syncFromServer(initial = false) {
  const next = await loadServerState();
  if (!next) {
    if (initial && !isOverlayView) publishState();
    return;
  }

  if (next.updatedAt > state.updatedAt) {
    receiveState(next);
  } else if (initial && !isOverlayView) {
    if (next.updatedAt < state.updatedAt) publishState();
  }
}

function renderAll() {
  syncControlValues();
  renderDocumentList();
  renderEditorMeta();
  renderStage();
}

function syncControlValues() {
  const current = getActiveDocument(state);
  if (sourceInput && sourceInput.value !== current.source) sourceInput.value = current.source;
  if (documentTitleInput && documentTitleInput.value !== displayDocumentTitle(current)) {
    documentTitleInput.value = displayDocumentTitle(current);
  }
  if (autoToggle) autoToggle.checked = state.autoAdvance;
  if (speedInput) speedInput.value = String(state.seconds);
  if (speedValue) speedValue.textContent = `${state.seconds}秒`;
  if (densityInput) densityInput.value = state.density;
  if (textSizeInput) textSizeInput.value = state.textSize;
  if (tickerToggle) tickerToggle.checked = state.showTicker;
  if (outputToggleButton) {
    outputToggleButton.textContent = state.outputHidden ? "画面を表示" : "画面を隠す";
    outputToggleButton.classList.toggle("is-hidden", state.outputHidden);
  }
  syncInteractionControls();
}

function syncInteractionControls() {
  if (pointerToggle) pointerToggle.checked = interaction.pointer.enabled;
  if (drawingToggle) drawingToggle.checked = interaction.drawing.enabled;
  if (drawingSizeInput) drawingSizeInput.value = String(interaction.drawing.size);
  if (drawingSizeValue) drawingSizeValue.value = `${Math.round(interaction.drawing.size)}px`;
  document.querySelectorAll("[data-pointer-mode]").forEach((button) => {
    const active = button.dataset.pointerMode === interaction.pointer.mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-drawing-tool]").forEach((button) => {
    const active = button.dataset.drawingTool === interaction.drawing.tool;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-drawing-color]").forEach((button) => {
    const active = button.dataset.drawingColor === interaction.drawing.color;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (calloutTone) calloutTone.value = interaction.callout.tone;
  if (calloutInput && document.activeElement !== calloutInput && interaction.callout.text) {
    calloutInput.value = interaction.callout.text;
  }
  const showButton = document.querySelector("#showCalloutButton");
  if (showButton) showButton.textContent = interaction.callout.visible ? "更新" : "表示";
  updateObsQualityStatus();
}

function updateObsQualityStatus() {
  if (!obsQualityStatus) return;
  const output = interaction.output;
  const connected = output.width > 0
    && output.height > 0
    && Date.now() - output.updatedAt < 15_000;
  const lowResolution = connected && (output.width < 1920 || output.height < 1080);

  obsQualityStatus.classList.toggle("is-connected", connected && !lowResolution);
  obsQualityStatus.classList.toggle("is-warning", lowResolution);
  obsQualityStatus.textContent = !connected
    ? "OBS未接続"
    : lowResolution
      ? `OBS ${output.width}×${output.height} 低画質`
      : `OBS ${output.width}×${output.height}`;
  obsQualityStatus.title = lowResolution
    ? "クリックしてOBS高画質設定の手順をコピー"
    : "クリックしてOBS高画質設定の手順をコピー";
}

function renderDocumentList() {
  if (!documentList) return;
  const filtered = state.documents.filter((document) => {
    if (!libraryQuery) return true;
    return `${displayDocumentTitle(document)} ${document.fileName}`.toLocaleLowerCase("ja").includes(libraryQuery);
  });

  documentList.innerHTML = filtered.map((document) => {
    const active = document.id === state.activeDocumentId;
    const meta = document.fileName || "手入力";
    return `
      <button class="document-item${active ? " is-active" : ""}" type="button" data-document-id="${escapeHtml(document.id)}" aria-pressed="${active}">
        <span class="document-title">${escapeHtml(displayDocumentTitle(document))}</span>
        <span class="document-meta">${escapeHtml(meta)} ・ ${formatShortDate(document.updatedAt)}</span>
      </button>
    `;
  }).join("") || `<p class="empty-library">該当する文書はありません</p>`;

  if (documentCount) documentCount.textContent = String(state.documents.length);
}

function renderEditorMeta() {
  if (isOverlayView) return;
  const current = getActiveDocument(state);
  const length = current.source.length;
  const spokenLength = current.source.replace(/\s/g, "").length;
  const minutes = spokenLength ? Math.max(1, Math.ceil(spokenLength / 300)) : 0;
  if (fileName) fileName.textContent = current.fileName || "手入力";
  if (characterCount) characterCount.textContent = `${length.toLocaleString("ja-JP")}文字`;
  if (speakingTime) speakingTime.textContent = `約${minutes}分`;
  if (updatedTime) updatedTime.textContent = formatLongDate(current.updatedAt);
}

function renderStage() {
  if (!stage) return;
  stage.classList.remove("text-normal", "text-large", "text-xlarge");
  stage.classList.add(`text-${state.textSize}`);
  stage.classList.toggle("is-output-hidden", state.outputHidden);
  if (state.outputHidden) {
    if (contentScrollControls) contentScrollControls.hidden = true;
    stage.classList.add("ticker-hidden");
    stage.classList.remove("interaction-enabled");
    stage.innerHTML = `<div class="safe-screen" aria-label="配信画面は非表示です"></div>`;
    syncSlideNavigation(1, true);
    return;
  }

  const current = getActiveDocument(state);
  const report = parseMarkdownReport(current.source);
  const slides = splitIntoSlides(report, { maxWeight: getSlideMaxWeight() });
  const safeSlides = slides.length ? slides : [{ title: "配信ノート", part: 1, totalParts: 1, blocks: [] }];

  if (lastDocumentId !== current.id || lastSource !== current.source) {
    slideIndex = Number(state.slideIndex || 0);
    lastDocumentId = current.id;
    lastSource = current.source;
  }

  slideIndex = wrap(slideIndex, safeSlides.length);
  const slide = safeSlides[slideIndex];
  syncSlideNavigation(safeSlides.length);
  const metrics = collectMetrics(report).slice(0, 9);
  const slideHasDiagram = slide.blocks.some((block) => block.type === "diagram");
  const visibleMetrics = slideHasDiagram ? [] : metrics;
  const highlights = report.highlights.length
    ? report.highlights
    : current.source.trim()
      ? safeSlides.map((item) => item.title).filter(Boolean).slice(0, 8)
      : [];
  const tickerItems = expandTickerItems(highlights);
  const tickerVisible = state.showTicker && tickerItems.length > 0;
  const title = displayDocumentTitle(current) || report.title;
  const tickerDelay = -(Date.now() % TICKER_DURATION_MS);

  stage.classList.toggle("ticker-hidden", !tickerVisible);
  stage.innerHTML = `
    <div class="stage-backdrop"></div>
    <header class="stage-header">
      <div class="title-block">
        <p class="stage-kicker">LIVE STREAM NOTES</p>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(report.target || "ON AIR DOCUMENT")}</p>
      </div>
      <div class="clock-block">
        <span>${String(slideIndex + 1).padStart(2, "0")}</span>
        <small>/ ${String(safeSlides.length).padStart(2, "0")}</small>
      </div>
    </header>

    <section class="stage-grid${visibleMetrics.length ? "" : " single-column"}${slideHasDiagram ? " diagram-slide" : ""}">
      <article class="main-board">
        <div class="section-label">${escapeHtml(slide.totalParts > 1 ? `${slide.title} ${slide.part}/${slide.totalParts}` : slide.title)}</div>
        <div class="slide-content">
          ${slide.blocks.map(renderBlock).join("") || `<p class="empty-copy">STANDBY</p>`}
        </div>
        <div class="content-scroll-indicator" aria-hidden="true"><span></span></div>
      </article>
      ${visibleMetrics.length ? `
        <aside class="side-board">
          <div class="pulse-title">KEY DATA</div>
          <div class="pulse-list">${visibleMetrics.map(renderPulseMetric).join("")}</div>
        </aside>
      ` : ""}
    </section>

    ${tickerVisible ? `
      <footer class="ticker-strip">
        <div class="ticker-track" style="--ticker-delay: ${tickerDelay}ms">
          <div class="ticker-group">${renderTickerItems(tickerItems)}</div>
          <div class="ticker-group" aria-hidden="true">${renderTickerItems(tickerItems)}</div>
        </div>
      </footer>
    ` : ""}
    <div class="interaction-layer" aria-live="polite">
      <canvas class="drawing-canvas" width="${STAGE_WIDTH}" height="${STAGE_HEIGHT}" aria-hidden="true"></canvas>
      <div class="brush-cursor" aria-hidden="true"></div>
      <div class="broadcast-pointer" aria-hidden="true">
        <span class="pointer-glyph"></span>
      </div>
      <div class="broadcast-callout">
        <span class="callout-label"></span>
        <strong class="callout-text"></strong>
      </div>
    </div>
  `;

  renderMath(stage);
  window.requestAnimationFrame(() => fitDiagramBlocks(stage));
  renderInteraction({ redrawCanvas: true, applyScroll: true });
}

function renderInteraction({ redrawCanvas = false, applyScroll = false } = {}) {
  if (!stage) return;
  const canvas = stage.querySelector(".drawing-canvas");
  const brushCursor = stage.querySelector(".brush-cursor");
  const pointer = stage.querySelector(".broadcast-pointer");
  const callout = stage.querySelector(".broadcast-callout");
  const pointerVisible = !state.outputHidden && interaction.pointer.enabled && interaction.pointer.visible;
  const drawingVisible = !state.outputHidden && interaction.drawing.enabled && interaction.pointer.visible;

  stage.classList.toggle(
    "interaction-enabled",
    !state.outputHidden && (interaction.pointer.enabled || interaction.drawing.enabled)
  );
  stage.style.setProperty("--pointer-x", `${interaction.pointer.x * 100}%`);
  stage.style.setProperty("--pointer-y", `${interaction.pointer.y * 100}%`);
  stage.style.setProperty("--pointer-px", `${interaction.pointer.x * STAGE_WIDTH}px`);
  stage.style.setProperty("--pointer-py", `${interaction.pointer.y * STAGE_HEIGHT}px`);
  stage.style.setProperty("--brush-size", `${drawingCursorSize()}px`);
  stage.style.setProperty("--brush-color", interaction.drawing.color);

  if (canvas && redrawCanvas) renderDrawingCanvas(canvas);
  if (applyScroll) applyContentScroll();
  if (brushCursor) {
    brushCursor.className = [
      "brush-cursor",
      `tool-${interaction.drawing.tool}`,
      drawingVisible ? "is-visible" : ""
    ].filter(Boolean).join(" ");
  }

  if (pointer) {
    pointer.className = `broadcast-pointer mode-${interaction.pointer.mode}${pointerVisible ? " is-visible" : ""}`;
    const clickId = String(interaction.pointer.clickId || 0);
    if (clickId !== "0" && pointer.dataset.clickId !== clickId) {
      pointer.dataset.clickId = clickId;
      pointer.querySelector(".click-pulse")?.remove();
      const pulse = document.createElement("span");
      pulse.className = "click-pulse";
      pointer.append(pulse);
      pulse.addEventListener("animationend", () => pulse.remove(), { once: true });
    }
  }

  if (callout) {
    const calloutVisible = !state.outputHidden && interaction.callout.visible && interaction.callout.text;
    const horizontal = interaction.pointer.x > 0.62 ? "anchor-left" : "anchor-right";
    const vertical = interaction.pointer.y > 0.62 ? "anchor-up" : "anchor-down";
    callout.className = [
      "broadcast-callout",
      `tone-${interaction.callout.tone}`,
      pointerVisible ? horizontal : "is-docked",
      pointerVisible ? vertical : "",
      calloutVisible ? "is-visible" : ""
    ].filter(Boolean).join(" ");
    callout.querySelector(".callout-label").textContent = calloutToneLabel(interaction.callout.tone);
    callout.querySelector(".callout-text").textContent = interaction.callout.text;
  }
}

function renderDrawingCanvas(canvas) {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);

  const pageKey = currentPageKey();
  for (const stroke of interaction.drawing.strokes) {
    if (stroke.pageKey !== pageKey || !stroke.points.length) continue;
    drawStroke(context, stroke);
  }
}

function drawStroke(context, stroke) {
  const points = stroke.points.map((point) => ({
    x: point.x * STAGE_WIDTH,
    y: point.y * STAGE_HEIGHT
  }));
  const first = points[0];
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = stroke.tool === "eraser" ? Math.max(stroke.size * 1.35, 18) : stroke.size;
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.globalAlpha = stroke.tool === "marker" ? 0.34 : 1;
  context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";

  if (points.length === 1) {
    context.beginPath();
    context.arc(first.x, first.y, context.lineWidth / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }

  context.beginPath();
  context.moveTo(first.x, first.y);
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    context.quadraticCurveTo(
      point.x,
      point.y,
      (point.x + next.x) / 2,
      (point.y + next.y) / 2
    );
  }
  const last = points.at(-1);
  context.lineTo(last.x, last.y);
  context.stroke();
  context.restore();
}

function drawingCursorSize() {
  const size = interaction.drawing.size;
  return interaction.drawing.tool === "eraser" ? Math.max(size * 1.35, 18) : size;
}

function currentPageScroll() {
  return interaction.scroll.positions.find((position) => position.pageKey === currentPageKey())
    || { pageKey: currentPageKey(), x: 0, y: 0 };
}

function setCurrentPageScroll(x, y, immediate = false) {
  const pageKey = currentPageKey();
  const positions = interaction.scroll.positions
    .filter((position) => position.pageKey !== pageKey);
  positions.push({
    pageKey,
    x: clamp(Number(x) || 0, 0, 1),
    y: clamp(Number(y) || 0, 0, 1)
  });
  queueInteractionPatch({ scroll: { positions } }, immediate);
}

function scrollContentBy(pageFraction, immediate = false) {
  const content = stage?.querySelector(".slide-content");
  if (!content) return;
  const maxY = Math.max(0, content.scrollHeight - content.clientHeight);
  if (maxY <= 1) return;
  setCurrentPageScroll(currentPageScroll().x, (content.scrollTop + content.clientHeight * pageFraction) / maxY, immediate);
}

function scrollContentToTop(immediate = false) {
  setCurrentPageScroll(0, 0, immediate);
}

function applyContentScroll() {
  const content = stage?.querySelector(".slide-content");
  const board = stage?.querySelector(".main-board");
  if (!content || !board) return;

  const maxX = Math.max(0, content.scrollWidth - content.clientWidth);
  const maxY = Math.max(0, content.scrollHeight - content.clientHeight);
  const position = currentPageScroll();
  content.scrollLeft = Math.round(position.x * maxX);
  content.scrollTop = Math.round(position.y * maxY);

  const scrollable = maxX > 1 || maxY > 1;
  const verticalScrollable = maxY > 1;
  const progress = maxY > 0 ? position.y : position.x;
  board.classList.toggle("is-scrollable", scrollable);
  board.style.setProperty("--scroll-progress-position", `${progress * 100}%`);
  if (contentScrollControls) contentScrollControls.hidden = !scrollable;
  if (contentScrollStatus) contentScrollStatus.textContent = `${Math.round(progress * 100)}%`;

  const topButton = document.querySelector("#scrollTopButton");
  const upButton = document.querySelector("#scrollUpButton");
  const downButton = document.querySelector("#scrollDownButton");
  if (topButton) topButton.disabled = !scrollable || progress <= 0.001;
  if (upButton) upButton.disabled = !verticalScrollable || position.y <= 0.001;
  if (downButton) downButton.disabled = !verticalScrollable || position.y >= 0.999;
}

function calloutToneLabel(tone) {
  if (tone === "answer") return "ANSWER";
  if (tone === "note") return "FOCUS";
  return "QUESTION";
}

function renderBlock(block) {
  if (block.type === "subheading") {
    return `<h3 class="block-heading">${escapeHtml(block.text)}</h3>`;
  }
  if (block.type === "paragraph") {
    return `<p class="report-copy">${formatInline(block.text)}</p>`;
  }
  if (block.type === "list") {
    const tag = block.ordered ? "ol" : "ul";
    return `<${tag} class="report-list">${block.items.map((item) => `<li>${formatInline(item)}</li>`).join("")}</${tag}>`;
  }
  if (block.type === "chart") {
    const max = Math.max(...block.metrics.map((metric) => Math.abs(metric.value)), 1);
    return `<div class="chart-block">${block.metrics.map((metric) => renderBar(metric, max)).join("")}</div>`;
  }
  if (block.type === "diagram") {
    return `
      <pre class="diagram-block" data-rows="${block.rows}" data-columns="${block.columns}"><code>${escapeHtml(block.text)}</code></pre>
    `;
  }
  if (block.type === "table") return renderTable(block);
  return "";
}

function renderBar(metric, max) {
  const width = Math.max(8, Math.min(100, Math.abs(metric.value) / max * 100));
  return `
    <div class="bar-row ${metric.sentiment}" style="--bar-width: ${width}%">
      <span class="bar-label">${escapeHtml(metric.label)}</span>
      <span class="bar-track"><i></i></span>
      <span class="bar-value">${escapeHtml(formatMetricValue(metric))}</span>
    </div>
  `;
}

function renderTable(table) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${table.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
        <tbody>${table.rows.map((row) => `<tr>${row.map(renderTableCell).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderTableCell(cell) {
  const metric = extractNumber(cell);
  const className = metric?.signed ? ` class="metric-cell ${metric.value >= 0 ? "positive" : "negative"}"` : "";
  return `<td${className}>${formatInline(cell)}</td>`;
}

function renderPulseMetric(metric) {
  return `
    <div class="pulse-item ${metric.sentiment}">
      <span>${escapeHtml(metric.label)}</span>
      <strong>${escapeHtml(formatMetricValue(metric))}</strong>
    </div>
  `;
}

function moveSlide(delta, broadcast = false) {
  if (state.outputHidden) return;
  const current = getActiveDocument(state);
  const slides = splitIntoSlides(parseMarkdownReport(current.source), {
    maxWeight: getSlideMaxWeight()
  });
  setSlideIndex(wrap(slideIndex + delta, Math.max(slides.length, 1)), broadcast);
}

function goToSlide(requestedIndex, broadcast = true) {
  if (state.outputHidden) return;
  const current = getActiveDocument(state);
  const slides = splitIntoSlides(parseMarkdownReport(current.source), {
    maxWeight: getSlideMaxWeight()
  });
  const total = Math.max(slides.length, 1);
  const target = clamp(Math.trunc(Number(requestedIndex)), 0, total - 1);
  setSlideIndex(target, broadcast);
}

function setSlideIndex(nextIndex, broadcast) {
  slideIndex = nextIndex;
  if (broadcast) {
    const revision = nextRevision();
    state = { ...state, slideIndex, updatedAt: revision };
    publishState();
  }
  renderStage();
}

function commitSlideNumber() {
  if (!slideNumberInput) return;
  goToSlide(Number(slideNumberInput.value) - 1, true);
}

function syncSlideNavigation(total, hidden = false) {
  const safeTotal = Math.max(1, Number(total) || 1);
  const currentPage = clamp(slideIndex + 1, 1, safeTotal);
  const disabled = hidden || safeTotal <= 1;

  if (slideRange) {
    slideRange.max = String(safeTotal);
    slideRange.value = String(currentPage);
    slideRange.disabled = disabled;
    slideRange.setAttribute("aria-valuetext", `${currentPage} / ${safeTotal}`);
  }
  if (slideNumberInput) {
    slideNumberInput.max = String(safeTotal);
    slideNumberInput.value = String(currentPage);
    slideNumberInput.disabled = disabled;
  }
  if (slideStatus) slideStatus.textContent = hidden ? "非表示" : `/ ${safeTotal}`;
  if (prevButton) prevButton.disabled = disabled;
  if (nextButton) nextButton.disabled = disabled;
}

function getSlideMaxWeight() {
  const baseWeight = state.density === "compact" ? 11 : 8.5;
  if (state.textSize === "xlarge") return baseWeight * 0.66;
  if (state.textSize === "large") return baseWeight * 0.78;
  return baseWeight;
}

function restartAutoTimer() {
  window.clearInterval(autoTimer);
  if (!state.autoAdvance || state.outputHidden) return;
  autoTimer = window.setInterval(() => moveSlide(1, false), clamp(state.seconds, 6, 40) * 1000);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY) || "null";
    return sanitizeState(JSON.parse(raw) || {}, sampleSource);
  } catch {
    return sanitizeState({}, sampleSource);
  }
}

async function loadServerState() {
  try {
    const response = await fetch("./api/state", { cache: "no-store" });
    if (!response.ok) return null;
    const value = await response.json();
    if (!Array.isArray(value?.documents) && typeof value?.source !== "string") return null;
    return sanitizeState(value, sampleSource);
  } catch {
    return null;
  }
}

function persistLocally(nextState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  } catch {
    // The server remains the primary store when browser storage is full.
  }
}

function formatInline(value) {
  return mapOutsideMath(value, (text) => escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>"),
  { protectedTransform: escapeHtml });
}

function renderMath(root) {
  try {
    renderMathInElement(root, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false },
        { left: "$", right: "$", display: false }
      ],
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
      preProcess: normalizeLatexForDisplay,
      throwOnError: false,
      strict: "ignore",
      trust: false
    });
    window.requestAnimationFrame(() => fitDisplayMath(root));
  } catch (error) {
    console.warn("Math rendering failed", error);
  }
}

function fitDisplayMath(root) {
  for (const display of root.querySelectorAll(".katex-display")) {
    const math = display.querySelector(":scope > .katex");
    if (!math) continue;
    math.style.fontSize = "";
    const availableWidth = display.clientWidth;
    const naturalWidth = math.scrollWidth;
    if (availableWidth > 0 && naturalWidth > availableWidth) {
      math.style.fontSize = `${Math.max(0.58, availableWidth / naturalWidth)}em`;
    }
  }
}

function fitDiagramBlocks(root) {
  const diagrams = [...root.querySelectorAll(".diagram-block")];
  for (const diagram of diagrams) diagram.style.fontSize = "";
  applyContentScroll();
}

function extractNumber(value = "") {
  const match = String(value).match(/([+-]?\s*\d[\d,]*(?:\.\d+)?)\s*(％|%|円|ドル|件|人|台|倍|年|月|日|時間|分|秒|GB|TB|MW|GW|℃|°C|ポイント|pt)?/i);
  if (!match) return null;
  const number = Number(match[1].replace(/\s+/g, "").replace(/,/g, ""));
  if (!Number.isFinite(number)) return null;
  return { value: number, unit: match[2] || "", signed: /^[+-]/.test(match[1].trim()) };
}

function formatMetricValue(metric) {
  const prefix = metric.signed && metric.value > 0 ? "+" : "";
  return `${prefix}${formatNumber(metric.value)}${metric.unit}`;
}

function displayDocumentTitle(document) {
  return String(document?.title || "").trim() || deriveDocumentTitle(document?.source, document?.fileName);
}

function expandTickerItems(items) {
  const clean = [...new Set(items.map((item) => String(item).trim()).filter(Boolean))];
  if (!clean.length) return [];
  const expanded = [];
  while (expanded.length < 8) expanded.push(...clean);
  return expanded.slice(0, Math.max(8, clean.length));
}

function renderTickerItems(items) {
  return items.map((item) => `<span>${escapeHtml(item)}</span>`).join("");
}

function overlayUrl() {
  return `${window.location.origin}${window.location.pathname}?view=overlay`;
}

function isSupportedTextFile(file) {
  return Boolean(file) && (file.type.startsWith("text/") || /\.(?:md|markdown|txt)$/i.test(file.name));
}

function isEditingTarget(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable;
}

function setButtonFlash(selector, text) {
  const button = document.querySelector(selector);
  if (!button) return;
  const previous = button.textContent;
  button.textContent = text;
  window.setTimeout(() => { button.textContent = previous; }, 1200);
}

function showToast(message, isError = false) {
  if (!toast) return;
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function formatShortDate(value) {
  if (!Number(value)) return "未保存";
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(new Date(value));
}

function formatLongDate(value) {
  if (!Number(value)) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatNumber(value) {
  return Number(value).toLocaleString("ja-JP", {
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2
  });
}

function nextRevision() {
  return Math.max(Date.now(), Number(state.updatedAt || 0) + 1);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function wrap(value, length) {
  if (!length) return 0;
  return ((value % length) + length) % length;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
