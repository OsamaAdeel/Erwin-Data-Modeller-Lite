// Ref store for artifacts that can't safely live in Redux state.
//
// XMLDocument instances are mutated in place by the emitter
// (addEntityClassic / addEntityDMv9). Immer's auto-freeze would break that
// on the second generate call, so the Document is kept here and the slice
// only tracks a parseId.
//
// Folder pickers also produce non-serializable values: File objects and
// FileSystemDirectoryHandles. We park them here keyed by stable ids that
// the slice can hold.

const docs = new Map<string, XMLDocument>();
const folderFiles = new Map<string, File>();
const folderHandles = new Map<string, FileSystemDirectoryHandle>();

// --- Parsed XML documents -------------------------------------------------

export function makeParseId(): string {
  return crypto.randomUUID();
}

export function setParsedDoc(id: string, doc: XMLDocument): void {
  docs.set(id, doc);
}

export function getParsedDoc(id: string): XMLDocument | undefined {
  return docs.get(id);
}

export function deleteParsedDoc(id: string): void {
  docs.delete(id);
}

// --- Folder file refs -----------------------------------------------------

export function setFolderFile(id: string, file: File): void {
  folderFiles.set(id, file);
}

export function getFolderFile(id: string): File | undefined {
  return folderFiles.get(id);
}

export function clearFolderFiles(): void {
  folderFiles.clear();
}

// --- Folder directory handles --------------------------------------------
// Single-slot store keyed by a constant. The "preferred folder" feature
// only tracks one folder at a time per session.

const PREFERRED_FOLDER_KEY = "preferred";

export function setPreferredFolderHandle(handle: FileSystemDirectoryHandle): void {
  folderHandles.set(PREFERRED_FOLDER_KEY, handle);
}

export function getPreferredFolderHandle(): FileSystemDirectoryHandle | undefined {
  return folderHandles.get(PREFERRED_FOLDER_KEY);
}

export function clearPreferredFolderHandle(): void {
  folderHandles.delete(PREFERRED_FOLDER_KEY);
}
