/**
 * Cola local: hallazgos + foto pendientes de subir (sin señal en recinto).
 */
(function () {
  "use strict";

  const DB_NAME = "entrega-captura-v2";
  const DB_VER = 2;
  const STORE = "pendingFindings";

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (db.objectStoreNames.contains("localPhotos")) db.deleteObjectStore("localPhotos");
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
          os.createIndex("unitRef", "unitRef", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function allRows() {
    return openDb().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }

  async function listPending(unitRef) {
    return (await allRows())
      .filter((r) => r.unitRef === unitRef)
      .sort((a, b) => (a.capturedAt || "").localeCompare(b.capturedAt || ""));
  }

  async function addPending(entry) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, "readwrite");
      const r = t.objectStore(STORE).add(entry);
      r.onsuccess = () => resolve({ ...entry, id: r.result });
      t.onerror = () => reject(t.error);
    });
  }

  async function removePending(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, "readwrite");
      t.objectStore(STORE).delete(id);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  async function countPending(unitRef) {
    return (await listPending(unitRef)).length;
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1] || "");
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  function base64ToBlob(b64, mime) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime || "image/jpeg" });
  }

  window.EntregaCapturaQueue = {
    listPending,
    addPending,
    removePending,
    countPending,
    blobToBase64,
    base64ToBlob,
  };
})();
