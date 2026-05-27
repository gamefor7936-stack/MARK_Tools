let pages = [];
let currentIndex = -1;
let activeHandle = null;
/** Skip live preview while loadEditor() writes header controls (avoids feedback loops). */
let syncingHeaderFromPage = false;
let livePreviewDebounceTimer = null;
let livePreviewGeneration = 0;
const LIVE_PREVIEW_DEBOUNCE_MS = 70;

window.onload = () => {
    if (typeof renderHistoryUI === 'function') renderHistoryUI('Doc Scanner');
    resetSystem();
    initDragLogic();
    window.addEventListener('resize', () => {
        if (currentIndex === -1) return;
        const cropLayer = document.getElementById('cropLayer');
        if (!cropLayer || cropLayer.classList.contains('hidden')) return;
        drawOverlay();
    });
};

function resetSystem() {
    pages = [];
    currentIndex = -1;
    document.getElementById('imageInput').value = "";
    updateUI();
}

// ─────────────────────────────────────────────────────────────────
// UPLOAD
// ─────────────────────────────────────────────────────────────────

async function handleBulkUpload(input) {
    const files = Array.from(input.files);
    if (!files.length) return;

    const loading = document.getElementById('procLoading');
    loading.classList.remove('hidden');

    // Index of first new page (existing pages are not reprocessed)
    const firstNewIndex = pages.length;

    for (let file of files) {
        const img = await loadImage(file);
        pages.push({
            original:   img,
            processed:  null,
            processedW: 0,
            processedH: 0,
            corners:    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
            filter:     'bw',
            strength:   50
        });
    }

    // Process only newly added pages
    for (let i = firstNewIndex; i < pages.length; i++) {
        await processPage(i);
    }

    // Focus the first newly added page
    currentIndex = firstNewIndex;

    // Reset input so the same file can be selected again
    document.getElementById('imageInput').value = "";

    loading.classList.add('hidden');
    updateUI();
}

// ─────────────────────────────────────────────────────────────────
// OPENCV CORE
// ─────────────────────────────────────────────────────────────────

async function processPage(index) {
    const page     = pages[index];
    const filter   = page.filter;
    const strength = page.strength;

    return new Promise((resolve, reject) => {
        setTimeout(async () => {
            try {
                const offscreen = document.createElement('canvas');
                const src       = cv.imread(page.original);
                let dst         = new cv.Mat();

                const coords = page.corners.flatMap(c => [
                    c.x * page.original.width,
                    c.y * page.original.height
                ]);

                // coords layout: [x0,y0, x1,y1, x2,y2, x3,y3]
                //                  TL        TR        BR        BL
                let pts1 = cv.matFromArray(4, 1, cv.CV_32FC2, coords);

                const wTop    = Math.hypot(coords[2] - coords[0], coords[3] - coords[1]);
                const wBottom = Math.hypot(coords[4] - coords[6], coords[5] - coords[7]);
                const hLeft   = Math.hypot(coords[6] - coords[0], coords[7] - coords[1]);
                const hRight  = Math.hypot(coords[4] - coords[2], coords[5] - coords[3]);
                const outW    = Math.round(Math.max(wTop, wBottom));
                const outH    = Math.round(Math.max(hLeft, hRight));

                let pts2 = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outW, 0, outW, outH, 0, outH]);
                let M    = cv.getPerspectiveTransform(pts1, pts2);
                cv.warpPerspective(src, dst, M, new cv.Size(outW, outH));

                if (filter === 'bw') {
                    cv.cvtColor(dst, dst, cv.COLOR_RGBA2GRAY);
                    const blockSize = 11 + 2 * Math.floor(strength / 10);
                    const C         = Math.max(2, Math.floor(30 - strength * 0.28));
                    cv.adaptiveThreshold(dst, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, blockSize, C);
                } else if (filter === 'magic') {
                    dst.convertTo(dst, -1, 1.25, 10);
                }

                cv.imshow(offscreen, dst);
                page.processed  = offscreen.toDataURL('image/jpeg', 0.9);
                page.processedW = outW;
                page.processedH = outH;

                src.delete(); dst.delete(); M.delete(); pts1.delete(); pts2.delete();
                resolve();
            } catch (err) {
                console.error(err);
                reject(err);
            }
        }, 50);
    });
}

// ─────────────────────────────────────────────────────────────────
// UI — loadEditor picks the view:
//   • Page has processed output → result mode
//   • Otherwise → crop mode
// ─────────────────────────────────────────────────────────────────

function updateUI() {
    renderPageList();
    loadEditor();
}

function loadEditor() {
    if (currentIndex === -1) {
        document.getElementById('scannerContainer').classList.add('hidden');
        return;
    }
    document.getElementById('scannerContainer').classList.remove('hidden');

    const page = pages[currentIndex];

    syncingHeaderFromPage = true;
    try {
        document.getElementById('filterMode').value   = page.filter;
        document.getElementById('scanStrength').value = page.strength;
    } finally {
        syncingHeaderFromPage = false;
    }

    if (page.processed) {
        document.getElementById('resultPreview').src = page.processed;
        switchMode('result');
    } else {
        drawOriginalToCanvas();
        setTimeout(() => drawOverlay(), 50);
        switchMode('crop');
    }
}

/**
 * Debounced live preview: re-runs OpenCV like Apply whenever Strength (or Filter) changes.
 * Only runs after the page has been processed at least once (e.g. after upload or Apply).
 */
function scheduleLivePreview() {
    if (syncingHeaderFromPage || currentIndex === -1) return;
    const page = pages[currentIndex];
    if (!page.processed) return;

    clearTimeout(livePreviewDebounceTimer);
    livePreviewDebounceTimer = setTimeout(() => {
        livePreviewDebounceTimer = null;
        void runLivePreviewProcess();
    }, LIVE_PREVIEW_DEBOUNCE_MS);
}

async function runLivePreviewProcess() {
    if (typeof cv === 'undefined') return;
    if (currentIndex === -1) return;
    const page = pages[currentIndex];
    if (!page.processed) return;

    const gen = ++livePreviewGeneration;
    try {
        page.filter   = document.getElementById('filterMode').value;
        page.strength = parseInt(document.getElementById('scanStrength').value) || 50;

        await processPage(currentIndex);
        if (gen !== livePreviewGeneration) return;

        document.getElementById('resultPreview').src = page.processed;
        switchMode('result');
        renderPageList();
    } catch (err) {
        console.error(err);
    }
}

// ─────────────────────────────────────────────────────────────────
// CANVAS ORIGINAL
// ─────────────────────────────────────────────────────────────────

function drawOriginalToCanvas() {
    if (currentIndex === -1) return;
    const page   = pages[currentIndex];
    const canvas = document.getElementById('srcCanvas');
    const ctx    = canvas.getContext('2d');
    canvas.style.filter = 'none';
    canvas.width  = page.original.width;
    canvas.height = page.original.height;
    ctx.drawImage(page.original, 0, 0);
}

// ─────────────────────────────────────────────────────────────────
// OVERLAY & DRAG
// ─────────────────────────────────────────────────────────────────

function getCanvasRect() {
    return document.getElementById('srcCanvas').getBoundingClientRect();
}

function drawOverlay() {
    if (currentIndex === -1) return;
    const page      = pages[currentIndex];
    const poly      = document.getElementById('cropLines');
    const maskPoly  = document.getElementById('cropMaskPolygon');
    const svg       = document.getElementById('svgGuide');
    const c         = page.corners;

    const canvasRect    = getCanvasRect();
    const container     = document.getElementById('cropLayer');
    const containerRect = container.getBoundingClientRect();

    svg.setAttribute('viewBox', `0 0 ${containerRect.width} ${containerRect.height}`);
    svg.setAttribute('preserveAspectRatio', 'none');

    let pointsStr = "";
    for (let i = 0; i < 4; i++) {
        const h             = document.getElementById('h' + i);
        const xInCanvas     = c[i].x * canvasRect.width;
        const yInCanvas     = c[i].y * canvasRect.height;
        const canvasOffsetX = canvasRect.left - containerRect.left;
        const canvasOffsetY = canvasRect.top  - containerRect.top;
        const xInContainer  = canvasOffsetX + xInCanvas;
        const yInContainer  = canvasOffsetY + yInCanvas;

        h.style.left  = xInContainer + "px";
        h.style.top   = yInContainer + "px";
        pointsStr    += `${xInContainer},${yInContainer} `;
    }

    poly.setAttribute('points', pointsStr.trim());
    if (maskPoly) maskPoly.setAttribute('points', pointsStr.trim());
}

function initDragLogic() {
    for (let i = 0; i < 4; i++) {
        const h = document.getElementById('h' + i);
        if (!h) continue;
        h.addEventListener('mousedown', (e) => { e.preventDefault(); activeHandle = i; });
        h.addEventListener('touchstart', (e) => { e.preventDefault(); activeHandle = i; }, { passive: false });
    }
    document.addEventListener('mouseup',   () => activeHandle = null);
    document.addEventListener('touchend',  () => activeHandle = null);
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('touchmove', onDragMove, { passive: false });
}

function onDragMove(e) {
    if (activeHandle === null || currentIndex === -1) return;
    e.preventDefault();

    const clientX    = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY    = e.touches ? e.touches[0].clientY : e.clientY;
    const canvasRect = getCanvasRect();
    const page       = pages[currentIndex];

    let origX = (clientX - canvasRect.left) / canvasRect.width;
    let origY = (clientY - canvasRect.top)  / canvasRect.height;
    origX = Math.max(0, Math.min(1, origX));
    origY = Math.max(0, Math.min(1, origY));

    page.corners[activeHandle] = { x: origX, y: origY };
    drawOverlay();
}

// ─────────────────────────────────────────────────────────────────
// APPLY & SWITCH MODE
// ─────────────────────────────────────────────────────────────────

// Apply — used after the user finishes cropping
async function processPreview() {
    if (typeof cv === 'undefined') return alert("OpenCV is still loading. Please wait a moment.");
    if (currentIndex === -1)       return alert("Select a page first.");

    const page    = pages[currentIndex];
    const loading = document.getElementById('procLoading');
    loading.classList.remove('hidden');

    try {
        // Read latest filter & strength from the UI
        page.filter   = document.getElementById('filterMode').value;
        page.strength = parseInt(document.getElementById('scanStrength').value) || 50;

        await processPage(currentIndex);
        document.getElementById('resultPreview').src = page.processed;
        switchMode('result');
        renderPageList();
    } catch (err) {
        console.error(err);
        alert("Could not process the image.");
    } finally {
        loading.classList.add('hidden');
    }
}

function switchMode(mode) {
    const cropLayer   = document.getElementById('cropLayer');
    const resultLayer = document.getElementById('resultLayer');
    const btnApply    = document.getElementById('btnApply');
    const btnReCrop   = document.getElementById('btnReCrop');

    if (mode === 'result') {
        cropLayer.classList.add('hidden');
        resultLayer.classList.remove('hidden');
        btnApply.classList.add('hidden');
        btnReCrop.classList.remove('hidden');
    } else {
        // Crop mode — original on canvas, handles active
        cropLayer.classList.remove('hidden');
        resultLayer.classList.add('hidden');
        btnApply.classList.remove('hidden');
        btnReCrop.classList.add('hidden');
        drawOriginalToCanvas();
        setTimeout(() => drawOverlay(), 50);
    }
}

// ─────────────────────────────────────────────────────────────────
// PDF EXPORT
// ─────────────────────────────────────────────────────────────────

async function generateFinalPDF() {
    if (pages.length === 0) return;
    const btn = document.getElementById('dlBtn2');
    if (!btn) return;
    btn.disabled = true;
    btn.innerText = "PROCESSING...";

    const { jsPDF } = window.jspdf;
    const { width: pageWidth, height: pageHeight } = getPaperSize();
    const doc = new jsPDF({
        orientation: pageWidth > pageHeight ? 'l' : 'p',
        unit: 'mm',
        format: [pageWidth, pageHeight]
    });

    const margin  = 10;
    const maxW    = pageWidth  - 2 * margin;
    const maxH    = pageHeight - 2 * margin;
    const fitMode = document.getElementById('fitMode').value;

    for (let i = 0; i < pages.length; i++) {
        if (i > 0) doc.addPage([pageWidth, pageHeight]);

        const page = pages[i];
        if (!page.processed) await processPage(i);

        const imgW = page.processedW;
        const imgH = page.processedH;

        let finalW, finalH, x, y;

        if (fitMode === 'stretch') {
            finalW = maxW;
            finalH = maxH;
            x = margin;
            y = margin;
        } else {
            const scale = Math.min(maxW / imgW, maxH / imgH, 1.0);
            finalW = imgW * scale;
            finalH = imgH * scale;
            x = (pageWidth  - finalW) / 2;
            y = (pageHeight - finalH) / 2;
        }

        doc.addImage(page.processed, 'JPEG', x, y, finalW, finalH);
    }

    const blob = doc.output('blob');
    const fileName = "MARK_Scan_" + Date.now() + ".pdf";

    // Save to History & redirect to go.html with ID
    if (typeof addToHistory === 'function') {
        const historyId = await addToHistory('Doc Scanner', fileName, blob);
        await downloadFromHistory(historyId);
    } else {
        saveFile(URL.createObjectURL(blob), fileName);
    }
}

// ─────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────

function toggleCustomSize() {
    const val = document.getElementById('paperSize').value;
    document.getElementById('customSizeInputs').style.display = val === 'custom' ? 'flex' : 'none';
}

function getPaperSize() {
    const value = document.getElementById('paperSize').value;
    if (value === 'custom') {
        return {
            width:  parseFloat(document.getElementById('customWidth').value)  || 210,
            height: parseFloat(document.getElementById('customHeight').value) || 297
        };
    }
    return {
        a4:     { width: 210, height: 297 },
        letter: { width: 216, height: 279 },
        legal:  { width: 216, height: 356 }
    }[value];
}

function renderPageList() {
    const list = document.getElementById('pageList');
    if (!list) return;
    list.innerHTML = pages.map((p, i) => `
        <div onclick="switchPage(${i})" class="relative group cursor-pointer border-2 ${i === currentIndex ? 'border-indigo-500' : 'border-transparent'} rounded-lg overflow-hidden">
            <img src="${p.processed || p.original.src}" class="w-full h-24 object-cover ${p.processed ? '' : 'opacity-50'}">
            <div class="absolute inset-0 flex items-center justify-center text-[10px] font-black text-white drop-shadow">${i + 1}</div>
        </div>
    `).join('');
}

function switchPage(i) {
    // Persist filter & strength to the current page before switching
    if (currentIndex !== -1) {
        pages[currentIndex].filter   = document.getElementById('filterMode').value;
        pages[currentIndex].strength = parseInt(document.getElementById('scanStrength').value) || 50;
    }
    currentIndex = i;
    updateUI();
}

function loadImage(file) {
    return new Promise(res => {
        const r = new FileReader();
        r.onload = e => {
            const img = new Image();
            img.onload = () => res(img);
            img.src = e.target.result;
        };
        r.readAsDataURL(file);
    });
}