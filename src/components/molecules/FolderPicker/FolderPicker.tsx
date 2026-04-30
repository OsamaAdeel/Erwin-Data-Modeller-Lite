import { useMemo } from "react";
import Button from "@/components/atoms/Button";
import Badge from "@/components/atoms/Badge";
import { formatFileSize } from "@/services/folder/folderScan";
import type {
  FolderFileMeta,
  PreferredFolderState,
} from "@/features/addTable/useAddTable";
import styles from "./FolderPicker.module.scss";

export interface FolderPickerProps {
  state: PreferredFolderState;
  onPick: () => void;
  onRefresh: () => void;
  onSelectFile: (id: string) => void;
  onClear: () => void;
  /** Optional override label for the empty/start state. */
  emptyHint?: string;
}

export default function FolderPicker({
  state,
  onPick,
  onRefresh,
  onSelectFile,
  onClear,
  emptyHint = "Pick a folder to auto-load the latest .xml file from it.",
}: FolderPickerProps) {
  const { name, files, selectedFileId, refreshable, loading, error } = state;
  const selected = useMemo(
    () => files.find((f) => f.id === selectedFileId) ?? null,
    [files, selectedFileId]
  );

  // Empty state — folder not yet picked.
  if (!name) {
    return (
      <div className={styles.wrap}>
        <div className={styles.emptyHead}>
          <div>
            <div className={styles.label}>Preferred folder</div>
            <div className={styles.hint}>{emptyHint}</div>
          </div>
          <Button onClick={onPick} disabled={loading} variant="outline">
            {loading ? "Opening…" : "Set preferred folder"}
          </Button>
        </div>
        {error && <div className={styles.error}>{error}</div>}
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.headerRow}>
        <div className={styles.headerLeft}>
          <div className={styles.label}>Preferred folder</div>
          <div className={styles.folderName} title={name}>
            <span className={styles.folderIcon} aria-hidden>📁</span>
            {name}
          </div>
        </div>
        <div className={styles.headerActions}>
          {refreshable && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={loading}
              title="Re-scan the folder for newer files"
            >
              {loading ? "Scanning…" : "Refresh"}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onPick} disabled={loading}>
            Change
          </Button>
          <Button variant="ghost" size="sm" onClick={onClear} disabled={loading}>
            Clear
          </Button>
        </div>
      </div>

      {loading && (
        <div className={styles.loadingBar}>
          <span className={styles.spinner} aria-hidden />
          <span>Scanning folder…</span>
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}

      {!loading && files.length === 0 && (
        <div className={styles.emptyList}>
          No <code>.xml</code> files found in this folder.
        </div>
      )}

      {selected && (
        <div className={styles.selectedRow}>
          <Badge tone="success">Auto-selected (Latest)</Badge>
          <div className={styles.selectedMeta}>
            <span className={styles.selectedName} title={selected.name}>
              {selected.name}
            </span>
            <span className={styles.dot}>·</span>
            <span title={new Date(selected.lastModified).toString()}>
              {formatTimestamp(selected.lastModified)}
            </span>
            <span className={styles.dot}>·</span>
            <span>{formatFileSize(selected.size)}</span>
          </div>
        </div>
      )}

      {files.length > 0 && (
        <FilePicker
          files={files}
          selectedId={selectedFileId}
          onSelect={onSelectFile}
          disabled={loading}
        />
      )}
    </div>
  );
}

interface FilePickerProps {
  files: FolderFileMeta[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled: boolean;
}

function FilePicker({ files, selectedId, onSelect, disabled }: FilePickerProps) {
  return (
    <label className={styles.dropdownWrap}>
      <span className={styles.dropdownLabel}>Override:</span>
      <select
        className={styles.dropdown}
        value={selectedId ?? ""}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value) onSelect(e.target.value);
        }}
      >
        {files.map((f, i) => (
          <option key={f.id} value={f.id}>
            {i === 0 ? "★ " : ""}
            {f.name} — {formatTimestamp(f.lastModified)}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  // Compact, locale-aware (e.g. 4/30/2026, 5:42 PM)
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
