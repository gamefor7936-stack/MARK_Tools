const dbName = "MarkToolsHistory";

// Open/Create Database
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

// 1. SAVE TO HISTORY (LOCKED STATE)
async function addToHistory(toolName, fileName, fileBlob) {
    const db = await openDB();
    const transaction = db.transaction("history", "readwrite");
    const store = transaction.objectStore("history");

    const historyItem = {
        tool: toolName,
        name: fileName,
        data: fileBlob,
        date: new Date().toLocaleString('en-US'),
        isUnlocked: false // DEFAULT: LOCKED (Must go through ad first)
    };

    return new Promise((resolve, reject) => {
        const request = store.add(historyItem);
        request.onsuccess = (e) => {
            renderHistoryUI(toolName);
            resolve(e.target.result); // Return ID to tool page
        };
        request.onerror = (e) => {
            console.error("IndexedDB Add Error:", e.target.error);
            reject(e.target.error);
        };
    });
}

// 2. UNLOCK HISTORY (Called by go.html when time expires)
async function unlockHistoryItem(id) {
    const db = await openDB();
    const transaction = db.transaction("history", "readwrite");
    const store = transaction.objectStore("history");
    const request = store.get(parseInt(id));

    request.onsuccess = () => {
        const item = request.result;
        if (item) {
            item.isUnlocked = true;
            store.put(item); // Update status di database
        }
    };
}

// 3. GET DATA BY ID
async function getFileById(id) {
    const db = await openDB();
    return new Promise((resolve) => {
        const transaction = db.transaction("history", "readonly");
        const store = transaction.objectStore("history");
        const request = store.get(parseInt(id));
        request.onsuccess = () => resolve(request.result);
    });
}

// 4. GET ALL HISTORY DATA PER TOOL
async function getHistoryByTool(toolName) {
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

// 5. RENDER HISTORY DISPLAY BELOW TOOLS
async function renderHistoryUI(toolName) {
    const historyArea = document.getElementById('historyList');
    if (!historyArea) return;

    const data = await getHistoryByTool(toolName);

    if (data.length === 0) {
        historyArea.innerHTML = `<p class="text-slate-400 text-xs text-center py-4 italic">No history found.</p>`;
        return;
    }

    historyArea.innerHTML = data.map(item => `
        <div class="flex items-center justify-between p-3 ${item.isUnlocked ? 'bg-slate-50' : 'bg-rose-50/50 border-rose-200'} border border-slate-200 rounded-xl mb-2 transition hover:shadow-sm">
            <div class="flex items-center gap-3 overflow-hidden">
                <div class="${item.isUnlocked ? 'bg-blue-100 text-blue-600' : 'bg-rose-100 text-rose-600'} p-2 rounded-lg text-[10px] font-bold">
                    ${item.isUnlocked ? 'FILE' : 'LOCK'}
                </div>
                <div class="flex flex-col overflow-hidden">
                    <span class="text-xs font-bold ${item.isUnlocked ? 'text-slate-700' : 'text-rose-700'} truncate">${item.name}</span>
                    <span class="text-[9px] text-slate-400 uppercase">${item.date}</span>
                </div>
            </div>
            
            ${item.isUnlocked ?
            // JIKA TERBUKA: Bisa langsung diunduh
            `<button onclick="downloadFromHistory(${item.id})" class="bg-white border border-slate-300 text-slate-600 p-2 rounded-lg hover:bg-slate-100 transition shadow-sm" title="Download">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                </button>`
            :
            // IF LOCKED: Send back to go.html
            `<button onclick="window.location.href='../go.html?id=${item.id}'" class="bg-rose-500 text-white px-3 py-1.5 rounded-lg hover:bg-rose-600 transition shadow-sm text-[10px] font-bold uppercase tracking-widest">
                    Resume
                </button>`
        }
        </div>
    `).join('');
}

// 6. EXECUTE DOWNLOAD (Pure from History)
async function downloadFromHistory(id) {
    const item = await getFileById(id);
    if (item && item.isUnlocked) {
        const url = URL.createObjectURL(item.data);
        const link = document.createElement('a');
        link.href = url;
        link.download = item.name;
        link.click();
        URL.revokeObjectURL(url);
    } else {
        alert("This file is still locked. Please complete security validation.");
    }
}

// --- MAGIC REDIRECT FUNCTION ---
// This function replaces all complicated logic in each file
async function processRedirect(toolName, fileName, fileBlob) {
    // 1. Bersihkan Nama File agar Windows tidak bingung
    // Menghapus karakter yang dilarang Windows: \ / : * ? " < > |
    let cleanName = fileName.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_");

    if (typeof addToHistory === 'function') {
        // 2. Pastikan fileBlob adalah Blob dengan type yang jelas
        const historyId = await addToHistory(toolName, cleanName, fileBlob);
        window.location.href = `../go.html?id=${historyId}`;
    } else {
        const url = URL.createObjectURL(fileBlob);
        const link = document.createElement('a');
        link.href = url; link.download = cleanName; link.click();
    }
}