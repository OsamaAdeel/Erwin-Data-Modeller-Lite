// Folder picker abstractions.
//
// We try the modern File System Access API first (Chrome/Edge/Opera) — it
// gives us a directory handle we can re-iterate to refresh later without
// re-prompting. Where unavailable (Firefox/Safari) we fall back to an
// <input type="file" webkitdirectory> which works everywhere but only
// gives us a one-shot snapshot of files.

export interface FolderFileEntry {
  id: string;            // stable id (uuid) for keyed lookups in Redux
  name: string;
  lastModified: number;  // epoch ms — Date.parse compatible
  size: number;          // bytes
  file: File;            // raw File handle for downstream parsing
}

export interface FolderScanResult {
  folderName: string;
  files: FolderFileEntry[];
  // Present iff the File System Access API was used; lets the caller refresh.
  handle?: FileSystemDirectoryHandle;
}

// Browsers without showDirectoryPicker can't refresh without re-prompting.
export const FOLDER_PICKER_SUPPORTED =
  typeof window !== "undefined" &&
  typeof (window as unknown as { showDirectoryPicker?: unknown })
    .showDirectoryPicker === "function";

interface ShowDirectoryPickerWindow {
  showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
}

export class FolderPickError extends Error {}

/**
 * Open the OS picker, scan the chosen directory once, and return the listing.
 * Returns null if the user cancels.
 *
 * The FS Access API path is preferred when available because the returned
 * `handle` lets us refresh without re-prompting; otherwise we fall back to
 * a hidden <input webkitdirectory>.
 */
export async function pickDirectory(): Promise<FolderScanResult | null> {
  if (FOLDER_PICKER_SUPPORTED) {
    try {
      const handle = await (window as unknown as ShowDirectoryPickerWindow).showDirectoryPicker();
      const files = await readDirectory(handle);
      return { folderName: handle.name, files, handle };
    } catch (err) {
      // AbortError = user cancelled. Anything else is a real failure.
      if (err instanceof DOMException && err.name === "AbortError") return null;
      throw new FolderPickError(
        err instanceof Error ? err.message : "Failed to open directory picker"
      );
    }
  }
  return pickViaInput();
}

/**
 * Re-read a directory handle. Used by the Refresh button.
 * Throws if read permission has been revoked and can't be regained.
 */
export async function rescanHandle(
  handle: FileSystemDirectoryHandle
): Promise<FolderFileEntry[]> {
  // queryPermission/requestPermission are part of the FS Access spec but
  // not yet in lib.dom — cast to access them.
  type Permissioned = FileSystemDirectoryHandle & {
    queryPermission?: (opts: { mode: "read" }) => Promise<PermissionState>;
    requestPermission?: (opts: { mode: "read" }) => Promise<PermissionState>;
  };
  const h = handle as Permissioned;
  if (h.queryPermission) {
    const state = await h.queryPermission({ mode: "read" });
    if (state !== "granted" && h.requestPermission) {
      const next = await h.requestPermission({ mode: "read" });
      if (next !== "granted") {
        throw new FolderPickError("Permission to read this folder was denied.");
      }
    }
  }
  return readDirectory(handle);
}

async function readDirectory(
  handle: FileSystemDirectoryHandle
): Promise<FolderFileEntry[]> {
  // .values() is async-iterable in the spec but not yet typed in lib.dom.
  type Iterable = FileSystemDirectoryHandle & {
    values(): AsyncIterable<FileSystemHandle>;
  };
  const out: FolderFileEntry[] = [];
  for await (const entry of (handle as Iterable).values()) {
    if (entry.kind !== "file") continue;
    const file = await (entry as FileSystemFileHandle).getFile();
    out.push({
      id: crypto.randomUUID(),
      name: file.name,
      lastModified: file.lastModified,
      size: file.size,
      file,
    });
  }
  return out;
}

function pickViaInput(): Promise<FolderScanResult | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    // Both attributes are needed for cross-browser directory selection.
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.multiple = true;
    input.style.display = "none";

    let settled = false;
    const settle = (value: FolderScanResult | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };

    input.onchange = () => {
      const list = Array.from(input.files ?? []);
      if (list.length === 0) return settle(null);
      settle({
        folderName: inferFolderName(list[0]),
        files: list.map((f) => ({
          id: crypto.randomUUID(),
          name: f.name,
          lastModified: f.lastModified,
          size: f.size,
          file: f,
        })),
      });
    };
    // No reliable cancel signal across browsers; fall back to focus loss heuristic.
    window.addEventListener(
      "focus",
      () => {
        // Give the change handler a tick to fire first.
        setTimeout(() => settle(null), 300);
      },
      { once: true }
    );

    document.body.appendChild(input);
    input.click();
  });
}

function inferFolderName(f: File): string {
  // webkitRelativePath looks like "MyFolder/sub/file.xml"; the first
  // segment is the picked directory's display name.
  const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
  if (path && path.includes("/")) return path.split("/")[0];
  return "Selected folder";
}

/** Keep only files whose name ends in .xml (case-insensitive). */
export function filterXml(entries: FolderFileEntry[]): FolderFileEntry[] {
  return entries.filter((e) => e.name.toLowerCase().endsWith(".xml"));
}

/**
 * Sort files newest-first by lastModified, with filename desc as tiebreaker
 * (so MODEL_V12.xml beats MODEL_V11.xml when their mtimes match).
 */
export function sortLatest(entries: FolderFileEntry[]): FolderFileEntry[] {
  return [...entries].sort((a, b) => {
    if (b.lastModified !== a.lastModified) return b.lastModified - a.lastModified;
    return b.name.localeCompare(a.name, undefined, { numeric: true });
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
