// IndexedDB-backed list of recently loaded files within recent folders.
// Files themselves can't be persisted (the File object is gone the
// moment the tab closes); we persist only the {folderId, fileName}
// pair and re-resolve the file from the folder handle on click.
//
// The folderId points at a recentFolders entry. If that folder is
// forgotten or its permission is revoked, the file recent is dropped
// silently on the next listing.

import { openDb, STORE_FILES, tx as txStore } from "./db";

const STORE = STORE_FILES;
// Capped at 5 — the recents row sits in the empty-state under the
// folder list; more pills than that turn it into a wall of buttons.
const MAX_ENTRIES = 5;

export interface RecentFileRecord {
  /** Composite id "folderId::fileName" — keeps duplicates from sneaking in
   *  when the same file is loaded twice from the same folder. */
  id: string;
  folderId: string;
  fileName: string;
  lastUsedAt: number;
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return txStore(db, STORE, mode);
}

function makeId(folderId: string, fileName: string): string {
  return `${folderId}::${fileName}`;
}

export async function listRecentFiles(): Promise<RecentFileRecord[]> {
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
      const records = (req.result as RecentFileRecord[]) ?? [];
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
 * Save (or bump) a recent-file entry. Composite key (folderId, fileName)
 * dedupes — re-loading the same file just refreshes lastUsedAt. Trims
 * the store to MAX_ENTRIES, evicting the oldest first.
 */
export async function saveRecentFile(
  folderId: string,
  fileName: string
): Promise<RecentFileRecord> {
  const record: RecentFileRecord = {
    id: makeId(folderId, fileName),
    folderId,
    fileName,
    lastUsedAt: Date.now(),
  };

  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const store = tx(db, "readwrite");
    const putReq = store.put(record);
    putReq.onerror = () => reject(putReq.error);
    putReq.onsuccess = () => resolve();
  });

  // Eviction pass.
  const updated = await listRecentFiles();
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

export async function removeRecentFile(id: string): Promise<void> {
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

/**
 * Drop every recent-file entry whose folderId matches. Called when a
 * recent FOLDER is forgotten so we don't leave dangling file pointers
 * to a folder the user explicitly removed.
 */
export async function removeRecentFilesByFolder(folderId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const all = await listRecentFiles();
  const targets = all.filter((r) => r.folderId === folderId);
  if (targets.length === 0) return;
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const store = tx(db, "readwrite");
    let pending = targets.length;
    for (const r of targets) {
      const req = store.delete(r.id);
      req.onsuccess = req.onerror = () => {
        if (--pending === 0) resolve();
      };
    }
  });
  db.close();
}

export async function getRecentFile(id: string): Promise<RecentFileRecord | null> {
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
      resolve((req.result as RecentFileRecord) ?? null);
      db.close();
    };
    req.onerror = () => {
      resolve(null);
      db.close();
    };
  });
}
