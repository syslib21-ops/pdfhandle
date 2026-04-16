import { PDFDocument } from "pdf-lib";

const SPLIT_PLACEHOLDER =
  "경계를 입력하고 「구간 미리보기」를 누르면 여기에 표시됩니다.";
const MERGE_PLACEHOLDER =
  "「순서 · 페이지 미리보기」를 누르면 여기에 표시됩니다.";

/** @param {string} text */
function parseBoundaries(text) {
  return text
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n));
}

/**
 * @param {number} totalPages
 * @param {number[]} rawBounds
 * @returns {[number, number][]}
 */
function computeRanges(totalPages, rawBounds) {
  if (totalPages < 1) return [];

  const bounds = [
    ...new Set(
      rawBounds.filter((n) => Number.isInteger(n) && n >= 2 && n <= totalPages),
    ),
  ].sort((a, b) => a - b);

  const ranges = [];
  let cur = 1;

  for (const b of bounds) {
    if (b <= cur) continue;
    if (cur > totalPages) break;
    const end = Math.min(b - 1, totalPages);
    ranges.push([cur, end]);
    cur = b;
  }
  if (cur <= totalPages) {
    ranges.push([cur, totalPages]);
  }
  return ranges;
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @param {number[]} boundaries
 */
async function splitPdfToParts(arrayBuffer, boundaries) {
  const src = await PDFDocument.load(arrayBuffer);
  const total = src.getPageCount();
  const ranges = computeRanges(total, boundaries);

  const parts = [];
  for (let i = 0; i < ranges.length; i++) {
    const [from, to] = ranges[i];
    const indices = [];
    for (let p = from; p <= to; p++) indices.push(p - 1);
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, indices);
    copied.forEach((page) => out.addPage(page));
    const bytes = await out.save();
    const idx = String(i + 1).padStart(2, "0");
    const name = `part-${idx}_p${from}-${to}.pdf`;
    parts.push({ name, bytes, from, to });
  }
  return { totalPages: total, parts };
}

/** @param {string} filename */
function sanitizePdfFileName(filename) {
  const t = filename.trim() || "merged.pdf";
  const base = t.replace(/[/\\?%*:|"<>]/g, "_");
  return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}

/**
 * @param {File[]} files in order
 */
async function mergePdfs(files) {
  const merged = await PDFDocument.create();
  const meta = [];

  for (const file of files) {
    const buf = await file.arrayBuffer();
    const doc = await PDFDocument.load(buf);
    const n = doc.getPageCount();
    const idx = [...Array(n).keys()];
    const copied = await merged.copyPages(doc, idx);
    copied.forEach((p) => merged.addPage(p));
    meta.push({ name: file.name, pages: n });
  }

  const bytes = await merged.save();
  return { bytes, meta };
}

/** @param {FileSystemDirectoryHandle} dir @param {string} name @param {Uint8Array} data */
async function writeFileToDir(dir, name, data) {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

function supportsFolderPicker() {
  return typeof window.showDirectoryPicker === "function";
}

// --- Split UI ---
const pdfInput = document.getElementById("pdf");
const boundsInput = document.getElementById("bounds");
const btnPreview = document.getElementById("btnPreview");
const btnFolder = document.getElementById("btnFolder");

const statusEl = document.getElementById("status");
const previewEl = document.getElementById("preview");

function setStatus(msg, kind) {
  if (!msg) {
    statusEl.hidden = true;
    statusEl.textContent = "";
    statusEl.className = "status";
    return;
  }
  statusEl.hidden = false;
  statusEl.textContent = msg;
  statusEl.className = `status ${kind === "err" ? "err" : "info"}`;
}

function updateSplitButtons() {
  const hasPdf = pdfInput.files && pdfInput.files.length > 0;
  const hasBounds = boundsInput.value.trim().length > 0;
  btnPreview.disabled = !hasPdf || !hasBounds;
  btnFolder.disabled = !hasPdf || !hasBounds;
}

pdfInput.addEventListener("change", () => {
  const zone = pdfInput.closest(".upload-zone");
  const title = zone?.querySelector(".upload-zone__title");
  const hint = zone?.querySelector(".upload-zone__hint");
  const f = pdfInput.files?.[0];
  if (title) title.textContent = f ? f.name : "PDF를 선택하세요";
  if (hint) {
    hint.textContent = f
      ? "선택됨 · 다른 파일로 바꾸려면 이 영역을 다시 누르세요"
      : "분할할 파일 한 개 · PDF 형식";
  }
  previewEl.textContent = SPLIT_PLACEHOLDER;
  previewEl.classList.add("preview--placeholder");
  updateSplitButtons();
});

boundsInput.addEventListener("input", updateSplitButtons);

btnPreview.addEventListener("click", async () => {
  const file = pdfInput.files?.[0];
  if (!file) return;
  const bounds = parseBoundaries(boundsInput.value);
  setStatus("미리보기 계산 중…", "info");

  try {
    const buf = await file.arrayBuffer();
    const src = await PDFDocument.load(buf);
    const total = src.getPageCount();
    const ranges = computeRanges(total, bounds);
    const lines = ranges.map(
      ([a, b], i) => `${i + 1}. ${a}–${b}페이지 (${b - a + 1}쪽)`,
    );
    previewEl.textContent = [
      `총 ${total}페이지`,
      `구간 ${ranges.length}개:`,
      ...lines,
    ].join("\n");
    previewEl.classList.remove("preview--placeholder");
    setStatus("", "");
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    setStatus(`미리보기 실패: ${err}`, "err");
  }
});

async function runSplit() {
  const file = pdfInput.files?.[0];
  if (!file) throw new Error("PDF를 선택하세요.");
  const bounds = parseBoundaries(boundsInput.value);
  const buf = await file.arrayBuffer();
  return splitPdfToParts(buf, bounds);
}

btnFolder.addEventListener("click", async () => {
  if (!supportsFolderPicker()) {
    setStatus(
      "이 브라우저에서는 폴더 선택을 지원하지 않습니다. Chrome 또는 Edge 최신 버전을 사용해 주세요.",
      "err",
    );
    return;
  }
  setStatus("PDF 나누는 중…", "info");
  try {
    const result = await runSplit();
    if (result.parts.length === 0) {
      setStatus("저장할 구간이 없습니다. 경계 페이지를 확인하세요.", "err");
      return;
    }
    const dir = await window.showDirectoryPicker();
    for (const p of result.parts) {
      await writeFileToDir(dir, p.name, p.bytes);
    }
    setStatus(`${result.parts.length}개 파일을 선택한 폴더에 저장했습니다.`, "info");
  } catch (e) {
    if (e && typeof e === "object" && "name" in e && e.name === "AbortError") {
      setStatus("폴더 선택이 취소되었습니다.", "info");
      return;
    }
    const err = e instanceof Error ? e.message : String(e);
    setStatus(`저장 실패: ${err}`, "err");
  }
});

// --- Merge UI: ordered file list ---
/** @type {File[]} */
let mergeFiles = [];
/** @type {number[]} page counts per file index, empty until preview */
let mergePageCounts = [];

const mergeInput = document.getElementById("mergePdfs");
const mergeFileName = document.getElementById("mergeFileName");
const mergeListWrap = document.getElementById("mergeListWrap");
const mergeList = document.getElementById("mergeList");
const mergeListCount = document.getElementById("mergeListCount");
const btnMergeClear = document.getElementById("btnMergeClear");
const btnMergePreview = document.getElementById("btnMergePreview");
const btnMergeFolder = document.getElementById("btnMergeFolder");
const mergePreviewEl = document.getElementById("mergePreview");

mergeList.addEventListener("dragover", (e) => e.preventDefault());

function invalidateMergePreview() {
  mergePageCounts = [];
  mergePreviewEl.textContent = MERGE_PLACEHOLDER;
  mergePreviewEl.classList.add("preview--placeholder");
}

function refreshMergePreviewIfComplete() {
  if (
    mergePageCounts.length !== mergeFiles.length ||
    mergeFiles.length === 0
  ) {
    mergePreviewEl.textContent = MERGE_PLACEHOLDER;
    mergePreviewEl.classList.add("preview--placeholder");
    return;
  }
  let sum = 0;
  const lines = mergeFiles.map((f, i) => {
    const pageN = mergePageCounts[i];
    sum += pageN;
    return `${i + 1}. ${f.name} — ${pageN}페이지`;
  });
  mergePreviewEl.textContent = [
    "병합 순서 (카드 왼쪽 → 오른쪽, 줄 바꿈 후에도 같은 순서):",
    ...lines,
    `—`,
    `합계 ${sum}페이지`,
  ].join("\n");
  mergePreviewEl.classList.remove("preview--placeholder");
}

/**
 * @param {number} from
 * @param {number} to
 */
function moveMergeIndex(from, to) {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= mergeFiles.length ||
    to >= mergeFiles.length
  ) {
    return;
  }
  const syncCounts =
    mergePageCounts.length === mergeFiles.length && mergeFiles.length > 0;
  const [item] = mergeFiles.splice(from, 1);
  mergeFiles.splice(to, 0, item);
  if (syncCounts) {
    const [c] = mergePageCounts.splice(from, 1);
    mergePageCounts.splice(to, 0, c);
    refreshMergePreviewIfComplete();
  } else {
    invalidateMergePreview();
  }
  renderMergeList();
}

function renderMergeList() {
  mergeList.replaceChildren();
  const n = mergeFiles.length;
  mergeListWrap.hidden = n === 0;
  btnMergeClear.disabled = n === 0;
  mergeListCount.textContent = n ? `병합할 파일 ${n}개` : "";

  let dragSource = /** @type {number | null} */ (null);

  mergeFiles.forEach((file, i) => {
    const pages =
      mergePageCounts.length === mergeFiles.length ? mergePageCounts[i] : null;

    const li = document.createElement("li");
    li.className = "merge-card";
    li.dataset.index = String(i);
    li.dataset.theme = String(i % 4);

    const surface = document.createElement("div");
    surface.className = "merge-card-surface";
    surface.draggable = true;
    surface.title = "드래그하여 순서 변경";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "merge-card-remove";
    remove.textContent = "×";
    remove.draggable = false;
    remove.title = "목록에서 제거";
    remove.setAttribute("aria-label", "목록에서 제거");
    remove.addEventListener("click", (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      const sync =
        mergePageCounts.length === mergeFiles.length && mergeFiles.length > 0;
      mergeFiles.splice(i, 1);
      if (sync) mergePageCounts.splice(i, 1);
      if (mergeFiles.length === 0) invalidateMergePreview();
      else if (sync) refreshMergePreviewIfComplete();
      else invalidateMergePreview();
      renderMergeList();
    });

    const art = document.createElement("div");
    art.className = "merge-card-art";

    const order = document.createElement("span");
    order.className = "merge-card-order";
    order.textContent = String(i + 1);

    const doc = document.createElement("div");
    doc.className = "merge-card-doc";
    for (let k = 0; k < 3; k++) {
      const line = document.createElement("div");
      line.className = "merge-card-doc-line";
      doc.appendChild(line);
    }

    art.append(order, doc);

    const caption = document.createElement("div");
    caption.className = "merge-card-caption";

    const name = document.createElement("div");
    name.className = "merge-card-name";
    name.textContent = file.name;
    name.title = file.name;

    const meta = document.createElement("div");
    meta.className = "merge-card-meta";
    meta.textContent =
      pages != null ? `${pages}페이지 · ${formatBytes(file.size)}` : formatBytes(file.size);

    caption.append(name, meta);
    surface.append(art, caption);
    li.append(surface, remove);

    surface.addEventListener("dragstart", (e) => {
      dragSource = i;
      li.classList.add("is-dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(i));
      }
    });

    surface.addEventListener("dragend", () => {
      li.classList.remove("is-dragging");
      mergeList.querySelectorAll(".merge-card").forEach((el) => {
        el.classList.remove("drag-over");
      });
      dragSource = null;
    });

    surface.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      mergeList.querySelectorAll(".merge-card").forEach((el) => {
        el.classList.toggle("drag-over", el === li);
      });
    });

    surface.addEventListener("dragleave", (e) => {
      if (e.target === surface) li.classList.remove("drag-over");
    });

    surface.addEventListener("drop", (e) => {
      e.preventDefault();
      const from =
        dragSource != null
          ? dragSource
          : Number.parseInt(e.dataTransfer?.getData("text/plain") || "", 10);
      li.classList.remove("drag-over");
      if (Number.isNaN(from)) return;
      moveMergeIndex(from, i);
    });

    mergeList.appendChild(li);
  });

  updateMergeButtons();
}

/** @param {number} bytes */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function updateMergeButtons() {
  const ok = mergeFiles.length > 0;
  btnMergePreview.disabled = !ok;
  btnMergeFolder.disabled = !ok;
}

mergeInput.addEventListener("change", () => {
  const add = mergeInput.files ? Array.from(mergeInput.files) : [];
  mergeInput.value = "";
  if (add.length === 0) return;
  mergeFiles.push(...add);
  invalidateMergePreview();
  renderMergeList();
});

btnMergeClear.addEventListener("click", () => {
  mergeFiles = [];
  invalidateMergePreview();
  renderMergeList();
});

btnMergePreview.addEventListener("click", async () => {
  if (mergeFiles.length === 0) return;
  setStatus("페이지 수 확인 중…", "info");
  try {
    const counts = [];
    for (let i = 0; i < mergeFiles.length; i++) {
      const f = mergeFiles[i];
      const doc = await PDFDocument.load(await f.arrayBuffer());
      counts.push(doc.getPageCount());
    }
    mergePageCounts = counts;
    refreshMergePreviewIfComplete();
    renderMergeList();
    setStatus("", "");
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    setStatus(`미리보기 실패: ${err}`, "err");
  }
});

btnMergeFolder.addEventListener("click", async () => {
  if (!supportsFolderPicker()) {
    setStatus(
      "이 브라우저에서는 폴더 선택을 지원하지 않습니다. Chrome 또는 Edge 최신 버전을 사용해 주세요.",
      "err",
    );
    return;
  }
  if (mergeFiles.length === 0) return;
  const name = sanitizePdfFileName(mergeFileName.value);
  setStatus("병합 중…", "info");
  try {
    const { bytes } = await mergePdfs(mergeFiles);
    const dir = await window.showDirectoryPicker();
    await writeFileToDir(dir, name, bytes);
    setStatus(`「${name}」을(를) 선택한 폴더에 저장했습니다.`, "info");
  } catch (e) {
    if (e && typeof e === "object" && "name" in e && e.name === "AbortError") {
      setStatus("폴더 선택이 취소되었습니다.", "info");
      return;
    }
    const err = e instanceof Error ? e.message : String(e);
    setStatus(`저장 실패: ${err}`, "err");
  }
});

const THEME_KEY = "pdf-tool-theme";

function applyTheme(theme) {
  const t = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* ignore */
  }
  document.querySelectorAll(".theme-switch__btn").forEach((btn) => {
    const el = /** @type {HTMLElement} */ (btn);
    const pick = el.dataset.themePick;
    const active = pick === t;
    el.classList.toggle("is-active", active);
    el.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function initTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") {
      applyTheme(stored);
      return;
    }
  } catch {
    /* ignore */
  }
  const prefersDark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(prefersDark ? "dark" : "light");
}

document.querySelectorAll(".theme-switch__btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const pick = /** @type {HTMLElement} */ (btn).dataset.themePick;
    if (pick === "light" || pick === "dark") applyTheme(pick);
  });
});

initTheme();

updateSplitButtons();
invalidateMergePreview();
renderMergeList();
