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

// 1. SAVE TO HISTORY (AUTO UNLOCKED UNTUK ADSENSE REVIEW)
async function addToHistory(toolName, fileName, fileBlob) {
    const db = await openDB();
    const transaction = db.transaction("history", "readwrite");
    const store = transaction.objectStore("history");

    const historyItem = {
        tool: toolName,
        name: fileName,
        data: fileBlob,
        date: new Date().toLocaleString('en-US'),
        // UBAH SEMENTARA KE TRUE AGAR LANGSUNG BISA DIDOWNLOAD TANPA GO.HTML
        isUnlocked: true 
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

// 2. UNLOCK HISTORY (Fungsi tetap dibiarkan agar tidak error, tapi tidak dipakai sementara)
async function unlockHistoryItem(id) {
    const db = await openDB();
    const transaction = db.transaction("history", "readwrite");
    const store = transaction.objectStore("history");
    const request = store.get(parseInt(id));

    request.onsuccess = () => {
        const item = request.result;
        if (item) {
            item.isUnlocked = true;
            store.put(item); 
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
        <div class="flex items-center justify-between p-3 ${item.isUnlocked ? 'bg-[#0f172a]' : 'bg-rose-900/20 border-rose-500/30'} border border-slate-800 rounded-xl mb-2 transition hover:shadow-sm">
            <div class="flex items-center gap-3 overflow-hidden">
                <div class="${item.isUnlocked ? 'bg-blue-500/10 text-blue-400' : 'bg-rose-500/10 text-rose-400'} p-2 rounded-lg text-[10px] font-bold">
                    ${item.isUnlocked ? 'FILE' : 'LOCK'}
                </div>
                <div class="flex flex-col overflow-hidden">
                    <span class="text-xs font-bold ${item.isUnlocked ? 'text-slate-200' : 'text-rose-400'} truncate">${item.name}</span>
                    <span class="text-[9px] text-slate-500 uppercase tracking-widest mt-0.5">${item.date}</span>
                </div>
            </div>
            
            ${item.isUnlocked ?
            // JIKA TERBUKA: Bisa langsung diunduh
            `<button onclick="downloadFromHistory(${item.id})" class="bg-slate-800 border border-slate-700 text-slate-300 p-2 rounded-lg hover:bg-slate-700 hover:text-white transition shadow-sm" title="Download">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                </button>`
            :
            // IF LOCKED: Send back to go.html (TIDAK AKAN MUNCUL SEMENTARA WAKTU KARENA AUTO UNLOCK)
            `<button onclick="window.location.href='../go.html?id=${item.id}'" class="bg-rose-600 text-white px-3 py-1.5 rounded-lg hover:bg-rose-500 transition shadow-sm text-[10px] font-bold uppercase tracking-widest">
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
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } else {
        alert("This file is still locked. Please complete security validation.");
    }
}

// --- MAGIC REDIRECT FUNCTION (DIMODIFIKASI UNTUK BYPASS GO.HTML) ---
// Fungsi ini menggantikan logika redirect menjadi direct download seketika
async function processRedirect(toolName, fileName, fileBlob) {
    // 1. Bersihkan Nama File agar Windows tidak bingung
    let cleanName = fileName.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_");

    if (typeof addToHistory === 'function') {
        // 2. Simpan ke History (Sudah Auto-Unlocked berkat update di atas)
        await addToHistory(toolName, cleanName, fileBlob);
        
        // 3. --- REDIRECT GO.HTML DIMATIKAN ---
        // await downloadFromHistory(historyId);

        // 4. --- GANTI MENJADI DIRECT DOWNLOAD ---
        // Browser akan langsung mengunduh file tanpa berpindah halaman
        const url = URL.createObjectURL(fileBlob);
        const link = document.createElement('a');
        link.href = url; 
        link.download = cleanName; 
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 1000);

    } else {
        const url = URL.createObjectURL(fileBlob);
        const link = document.createElement('a');
        link.href = url; link.download = cleanName; link.click();
    }
}