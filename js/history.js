const dbName = "MarkToolsHistory";

// Buka/Buat Database
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

// --- FUNGSI BARU: RILIS SEMUA HISTORY YANG TERKUNCI ---
async function autoUnlockOldHistory() {
    const db = await openDB();
    const transaction = db.transaction("history", "readwrite");
    const store = transaction.objectStore("history");
    const request = store.openCursor();

    request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
            const data = cursor.value;
            // Jika ditemukan item yang masih terkunci (false), ubah jadi true
            if (data.isUnlocked === false) {
                data.isUnlocked = true;
                cursor.update(data);
            }
            cursor.continue();
        }
    };
}

// 1. SIMPAN KE HISTORI (LANGSUNG UNLOCKED SEKARANG)
async function addToHistory(toolName, fileName, fileBlob) {
    const db = await openDB();
    const transaction = db.transaction("history", "readwrite");
    const store = transaction.objectStore("history");

    const historyItem = {
        tool: toolName,
        name: fileName,
        data: fileBlob,
        date: new Date().toLocaleString('en-US'),
        isUnlocked: true // Langsung terbuka mulai sekarang
    };

    return new Promise((resolve) => {
        const request = store.add(historyItem);
        request.onsuccess = (e) => {
            renderHistoryUI(toolName);
            resolve(e.target.result);
        };
    });
}

// 2. AMBIL SEMUA DATA HISTORI PER TOOL (DENGAN PROTEKSI)
async function getHistoryByTool(toolName) {
    // Jalankan auto-unlock setiap kali memuat history
    await autoUnlockOldHistory();
    
    const db = await openDB();
    return new Promise((resolve) => {
        const transaction = db.transaction("history", "readonly");
        const store = transaction.objectStore("history");
        const request = store.getAll();
        request.onsuccess = () => {
            const all = request.result;
            resolve(all.filter(item => item.tool === toolName).reverse());
        };
    });
}

// 3. RENDER UI HISTORI (DIBERSIHKAN DARI LOGIKA LOCK)
async function renderHistoryUI(toolName) {
    const historyArea = document.getElementById('historyList');
    if (!historyArea) return;

    const data = await getHistoryByTool(toolName);
    
    if (data.length === 0) {
        historyArea.innerHTML = `<p class="text-slate-400 text-[10px] text-center py-4 italic uppercase tracking-widest">No history yet</p>`;
        return;
    }

    historyArea.innerHTML = data.map(item => `
        <div class="flex items-center justify-between p-3 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl mb-2 transition hover:shadow-md">
            <div class="flex items-center gap-3 overflow-hidden">
                <div class="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 p-2 rounded-lg text-[10px] font-black">
                    FILE
                </div>
                <div class="flex flex-col overflow-hidden">
                    <span class="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">${item.name}</span>
                    <span class="text-[9px] text-slate-400 uppercase font-medium">${item.date}</span>
                </div>
            </div>
            
            <button onclick="downloadFromHistory(${item.id})" class="bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-200 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-600 transition shadow-sm">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            </button>
        </div>
    `).join('');
}

// 4. LOGIKA DOWNLOAD LANGSUNG
async function downloadFromHistory(id) {
    const db = await openDB();
    const transaction = db.transaction("history", "readonly");
    const store = transaction.objectStore("history");
    const request = store.get(parseInt(id));

    request.onsuccess = () => {
        const item = request.result;
        if (item) {
            const url = URL.createObjectURL(item.data);
            const link = document.createElement('a');
            link.href = url;
            link.download = item.name;
            link.click();
            URL.revokeObjectURL(url);
        }
    };
}

// --- NEW: DIRECT DOWNLOAD REDIRECT REPLACEMENT ---
async function processDirectDownload(toolName, fileName, fileBlob) {
    try {
        // Simpan ke History (Otomatis Unlocked)
        await addToHistory(toolName, fileName, fileBlob);

        // Langsung Download
        const url = window.URL.createObjectURL(fileBlob);
        const link = document.body.appendChild(document.createElement('a'));
        link.href = url;
        link.download = fileName;
        link.click();
        
        setTimeout(() => {
            link.remove();
            window.URL.revokeObjectURL(url);
        }, 500);

    } catch (e) {
        console.error(e);
        // Fallback
        const url = URL.createObjectURL(fileBlob);
        const a = document.createElement('a');
        a.href = url; a.download = fileName; a.click();
    }
}