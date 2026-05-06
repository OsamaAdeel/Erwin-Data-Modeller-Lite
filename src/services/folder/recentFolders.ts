// IndexedDB-backed list of recently picked directory handles. The
// FileSystemDirectoryHandle objects survive structured-clone and can
// therefore be persisted across reloads — the user still has to grant
// read permission on each session, but the OS-level dialog is one
// click instead of re-navigating to the folder.
//
// Single object store keyed by uuid. Handles are stored alongside a
// display name and a lastUsedAt timestamp so the UI can render a
// "Recent folders" list ordered by recency. Capped at MAX_ENTRIES —
// entries past the cap are evicted oldest-first on save.

import { openDb, STORE_FOLDERS, tx as txStore } from "./db";

const STORE = STORE_FOLDERS;
const MAX_ENTRIES = 6;

export interface RecentFolderRecord {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  lastUsedAt: number;
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return txStore(db, STORE, mode);
}

export async function listRecentFolders(): Promise<RecentFolderRecord[]> {
  if (typeof indexedDB === "undefined") return [];
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return [];
  }
  return new Promise((resolve) => {
    const req = tx(db, "readonly").getAll();
    req.onsuccess = () => {
      const records = (req.result as RecentFolderRecord[]) ?? [];
      records.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
      resolve(records);
      db.close();
    };
    req.onerror = () => {
      resolve([]);
      db.close();
    };
  });
}

/**
 * Save a folder handle, deduping against any existing entry that points
 * to the same directory. Updates the timestamp + name on dedupe so the
 * existing id is preserved (callers can keep stable references).
 *
 * Trims the store to MAX_ENTRIES, evicting the oldest first.
 */
export async function saveRecentFolder(
  name: string,
  handle: FileSystemDirectoryHandle
): Promise<RecentFolderRecord> {
  const existing = await listRecentFolders();
  let dupeId: string | null = null;
  for (const r of existing) {
    try {
      if (await r.handle.isSameEntry(handle)) {
        dupeId = r.id;
        break;
      }
    } catch {
      // isSameEntry can throw across origin sandboxes — treat as not-same.
    }
  }
  const record: RecentFolderRecord = {
    id: dupeId ?? crypto.randomUUID(),
    name,
    handle,
    lastUsedAt: Date.now(),
  };

  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const store = tx(db, "readwrite");
    const putReq = store.put(record);
    putReq.onerror = () => reject(putReq.error);
    putReq.onsuccess = () => resolve();
  });

  // Eviction pass — don't block the caller on overflow trimming.
  const updated = await listRecentFolders();
  if (updated.length > MAX_ENTRIES) {
    const overflow = updated.slice(MAX_ENTRIES);
    const db2 = await openDb();
    await new Promise<void>((resolve) => {
      const store = tx(db2, "readwrite");
      let pending = overflow.length;
      if (pending === 0) return resolve();
      for (const r of overflow) {
        const req = store.delete(r.id);
        req.onsuccess = req.onerror = () => {
          if (--pending === 0) resolve();
        };
      }
    });
    db2.close();
  }

  db.close();
  return record;
}

export async function removeRecentFolder(id: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return;
  }
  await new Promise<void>((resolve) => {
    const store = tx(db, "readwrite");
    const req = store.delete(id);
    req.onsuccess = req.onerror = () => resolve();
  });
  db.close();
}

export async function getRecentFolder(id: string): Promise<RecentFolderRecord | null> {
  if (typeof indexedDB === "undefined") return null;
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return null;
  }
  return new Promise((resolve) => {
    const req = tx(db, "readonly").get(id);
    req.onsuccess = () => {
      resolve((req.result as RecentFolderRecord) ?? null);
      db.close();
    };
    req.onerror = () => {
      resolve(null);
      db.close();
    };
  });
}
