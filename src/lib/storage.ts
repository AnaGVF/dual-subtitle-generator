const DB_NAME = "dual_subtitle_studio_db";
const DB_VERSION = 1;
const STORE_NAME = "media_store";
const VIDEO_KEY = "current_video";

interface StoredVideoRecord {
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not supported in this environment."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveVideoToStorage(file: File): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const record: StoredVideoRecord = {
        blob: file,
        name: file.name,
        type: file.type || "video/mp4",
        lastModified: file.lastModified || Date.now()
      };
      const req = store.put(record, VIDEO_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("Failed to save video to storage:", err);
  }
}

export async function loadVideoFromStorage(): Promise<File | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(VIDEO_KEY);
      req.onsuccess = () => {
        const result = req.result;
        if (!result) {
          resolve(null);
          return;
        }

        if (result instanceof File) {
          resolve(result);
          return;
        }

        if (result.blob instanceof Blob) {
          const file = new File([result.blob], result.name || "video.mp4", {
            type: result.type || "video/mp4",
            lastModified: result.lastModified || Date.now()
          });
          resolve(file);
          return;
        }

        if (result instanceof Blob) {
          const file = new File([result], "video.mp4", {
            type: result.type || "video/mp4"
          });
          resolve(file);
          return;
        }

        resolve(null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("Failed to load video from storage:", err);
    return null;
  }
}

export async function clearVideoFromStorage(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(VIDEO_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("Failed to clear video from storage:", err);
  }
}
