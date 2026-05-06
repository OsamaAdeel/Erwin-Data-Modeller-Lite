// Shared IndexedDB handle for the folder feature. Two object stores live
// here side-by-side so a single upgrade transaction handles both:
//
//   - recentFolders: FileSystemDirectoryHandle records (existing)
//   - recentFiles:   {folderId, fileName, lastUsedAt} records (new)
//
// Splitting them across two DBs would have been simpler but mixes
// related session state across two transactional scopes; one DB keeps
// the upgrade story trivial.

const DB_NAME = "erwin-lite";
const DB_VERSION = 2;

export const STORE_FOLDERS = "recentFolders";
export const STORE_FILES = "recentFiles";

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Idempotent — both stores are created if absent. Safe whether the
      // user is on a fresh install (creates both) or upgrading from v1
      // (folders already exists, files is new).
      if (!db.objectStoreNames.contains(STORE_FOLDERS)) {
        db.createObjectStore(STORE_FOLDERS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

export function tx(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode
): IDBObjectStore {
  return db.transaction(storeName, mode).objectStore(storeName);
}
