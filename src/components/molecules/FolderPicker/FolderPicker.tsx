import { useMemo } from "react";
import Button from "@/components/atoms/Button";
import Badge from "@/components/atoms/Badge";
import Select, { type SelectOption } from "@/components/atoms/Select";
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
          <FolderArtwork className={styles.artwork} />
          <div className={styles.emptyText}>
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
  // Map folder files to Select options. The newest file (index 0) gets a
  // ★ marker so it's spottable in the popover; the timestamp goes into
  // the option's right-aligned hint so labels stay readable.
  const options: SelectOption[] = files.map((f, i) => ({
    value: f.id,
    label: `${i === 0 ? "★ " : ""}${f.name}`,
    hint: formatTimestamp(f.lastModified),
  }));
  return (
    <label className={styles.dropdownWrap}>
      <span className={styles.dropdownLabel}>Override:</span>
      <Select
        options={options}
        value={selectedId ?? ""}
        disabled={disabled}
        onChange={(v) => onSelect(v)}
        aria-label="Override the auto-selected file"
      />
    </label>
  );
}

// Decorative open-folder + document SVG used in the empty state. Stroke
// uses currentColor so it picks up the surrounding text colour and tone
// changes between light/dark themes automatically.
function FolderArtwork({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="56"
      height="44"
      viewBox="0 0 56 44"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* Back folder body */}
      <path d="M4 10 a3 3 0 0 1 3 -3 h12 l4 4 h26 a3 3 0 0 1 3 3 v22 a3 3 0 0 1 -3 3 h-44 a3 3 0 0 1 -3 -3 z" />
      {/* Sheet of paper peeking out */}
      <rect x="14" y="16" width="20" height="14" rx="1.4" fill="var(--color-surface)" />
      <line x1="18" y1="20" x2="30" y2="20" />
      <line x1="18" y1="24" x2="28" y2="24" />
      {/* Front fold to suggest depth */}
      <path d="M4 14 h48 l-3 22 h-42 z" fill="var(--color-primary-soft)" stroke="currentColor" />
    </svg>
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
