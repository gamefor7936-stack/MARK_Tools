const dbName = "MarkToolsHistory";

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains("history")) {
                db.createObjectStore("history", { keyPath: "id", autoIncrement: true });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// 1. SAVE TO HISTORY (LANGSUNG AUTO DOWNLOAD)
async function addToHistory(toolName, fileName, fileBlob) {
    const db = await openDB();
    const transaction = db.transaction("history", "readwrite");
    const store = transaction.objectStore("history");

    const historyItem = {
        tool: toolName,
        name: fileName,
        data: fileBlob,
        date: new Date().toLocaleString('en-US'),
        isUnlocked: true // Selalu True
    };

    // PAKSA BROWSER UNTUK DOWNLOAD FILE SAAT INI JUGA (Tanpa harus nunggu HTML)
    const url = URL.createObjectURL(fileBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    return new Promise((resolve, reject) => {
        const request = store.add(historyItem);
        request.onsuccess = (e) => {
            renderHistoryUI(toolName);
            resolve(e.target.result);
        };
        request.onerror = (e) => reject(e.target.error);
    });
}

// 2. GET DATA BY ID & ALL DATA
async function getFileById(id) {
    const db = await openDB();
    return new Promise((resolve) => {
        const transaction = db.transaction("history", "readonly");
        const store = transaction.objectStore("history");
        const request = store.get(parseInt(id));
        request.onsuccess = () => resolve(request.result);
    });
}

async function getHistoryByTool(toolName) {
    const db = await openDB();
    return new Promise((resolve) => {
        const transaction = db.transaction("history", "readonly");
        const store = transaction.objectStore("history");
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result.filter(item => item.tool === toolName).reverse());
    });
}

// 3. RENDER HISTORY (GOD MODE: MENGABAIKAN FILE LAMA YANG TERKUNCI)
async function renderHistoryUI(toolName) {
    const historyArea = document.getElementById('historyList');
    if (!historyArea) return;

    const data = await getHistoryByTool(toolName);
    if (data.length === 0) {
        historyArea.innerHTML = `<p class="text-slate-400 text-xs text-center py-4 italic">No history found.</p>`;
        return;
    }

    // Apapun status isUnlocked di database lama, KITA ANGGAP SEMUANYA TERBUKA (FILE)
    historyArea.innerHTML = data.map(item => `
        <div class="flex items-center justify-between p-3 bg-[#0f172a] border border-slate-800 rounded-xl mb-2 transition hover:shadow-sm">
            <div class="flex items-center gap-3 overflow-hidden">
                <div class="bg-emerald-500/10 text-emerald-400 p-2 rounded-lg text-[10px] font-bold">
                    FILE
                </div>
                <div class="flex flex-col overflow-hidden">
                    <span class="text-xs font-bold text-slate-200 truncate">${item.name}</span>
                    <span class="text-[9px] text-slate-500 uppercase tracking-widest mt-0.5">${item.date}</span>
                </div>
            </div>
            
            <button onclick="downloadFromHistory(${item.id})" class="bg-slate-800 border border-slate-700 text-slate-300 p-2 rounded-lg hover:bg-slate-700 hover:text-white transition shadow-sm" title="Download">
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            </button>
        </div>
    `).join('');
}

// 4. DOWNLOAD FROM HISTORY (GOD MODE: Langsung sedot data tanpa cek lock)
async function downloadFromHistory(id) {
    const item = await getFileById(id);
    if (item) {
        const url = URL.createObjectURL(item.data);
        const link = document.createElement('a');
        link.href = url;
        link.download = item.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}

// 5. PROCESS REDIRECT BYPASS (Menggagalkan perintah dari tools yang pakai fungsi ini)
async function processRedirect(toolName, fileName, fileBlob) {
    let cleanName = fileName.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_");
    // addToHistory sekarang otomatis mendownload, jadi tidak perlu script tambahan
    await addToHistory(toolName, cleanName, fileBlob);
}