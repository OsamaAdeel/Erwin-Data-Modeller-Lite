import { useMemo } from "react";
import Button from "@/components/atoms/Button";
import Badge from "@/components/atoms/Badge";
import Select, { type SelectOption } from "@/components/atoms/Select";
import { formatFileSize } from "@/services/folder/folderScan";
import type {
  FolderFileMeta,
  PreferredFolderState,
  RecentFileMeta,
  RecentFolderMeta,
} from "@/features/addTable/useAddTable";
import styles from "./FolderPicker.module.scss";

export interface FolderPickerProps {
  state: PreferredFolderState;
  onPick: () => void;
  onRefresh: () => void;
  onSelectFile: (id: string) => void;
  onClear: () => void;
  /** Re-open a folder previously persisted to IDB. */
  onUseRecent?: (id: string) => void;
  /** Drop a recent folder from IDB. */
  onForgetRecent?: (id: string) => void;
  /** Re-open a specific file under a remembered folder. Resolves the
   *  folder handle, re-permissions if needed, and dispatches loadFile. */
  onUseRecentFile?: (id: string) => void;
  /** Drop a single recent-file entry. */
  onForgetRecentFile?: (id: string) => void;
  /** Optional override label for the empty/start state. */
  emptyHint?: string;
}

export default function FolderPicker({
  state,
  onPick,
  onRefresh,
  onSelectFile,
  onClear,
  onUseRecent,
  onForgetRecent,
  onUseRecentFile,
  onForgetRecentFile,
  emptyHint = "Pick a folder to auto-load the latest .xml file from it.",
}: FolderPickerProps) {
  const {
    name,
    files,
    selectedFileId,
    refreshable,
    loading,
    error,
    recents,
    recentFiles,
  } = state;
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
        {recents.length > 0 && onUseRecent && (
          <RecentFoldersList
            recents={recents}
            disabled={loading}
            onUse={onUseRecent}
            onForget={onForgetRecent}
          />
        )}
        {recentFiles.length > 0 && onUseRecentFile && (
          <RecentFilesList
            recents={recentFiles}
            disabled={loading}
            onUse={onUseRecentFile}
            onForget={onForgetRecentFile}
          />
        )}
        {error && <div className={styles.error} role="alert">{error}</div>}
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.headerRow}>
        <div className={styles.headerLeft}>
          <div className={styles.label}>Preferred folder</div>
          <div className={styles.folderName} title={name}>
            <FolderGlyph className={styles.folderIcon} />
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

      {error && <div className={styles.error} role="alert">{error}</div>}

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

// Small Lucide-style folder glyph used inline next to the folder name.
function FolderGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
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

interface RecentFoldersListProps {
  recents: RecentFolderMeta[];
  disabled: boolean;
  onUse: (id: string) => void;
  onForget?: (id: string) => void;
}

function RecentFoldersList({ recents, disabled, onUse, onForget }: RecentFoldersListProps) {
  return (
    <div className={styles.recentsWrap}>
      <div className={styles.recentsLabel}>Recent folders</div>
      <ul className={styles.recentsList}>
        {recents.map((r) => (
          <li key={r.id} className={styles.recentRow}>
            <button
              type="button"
              className={styles.recentName}
              onClick={() => onUse(r.id)}
              disabled={disabled}
              title={`Re-open ${r.name} (you'll be asked to grant read permission)`}
            >
              <FolderGlyph className={styles.recentIcon} />
              <span className={styles.recentNameText}>{r.name}</span>
              <span className={styles.recentTime}>{formatRelative(r.lastUsedAt)}</span>
            </button>
            {onForget && (
              <button
                type="button"
                className={styles.recentForget}
                onClick={() => onForget(r.id)}
                disabled={disabled}
                aria-label={`Forget ${r.name}`}
                title="Remove from recent list"
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface RecentFilesListProps {
  recents: RecentFileMeta[];
  disabled: boolean;
  onUse: (id: string) => void;
  onForget?: (id: string) => void;
}

function RecentFilesList({ recents, disabled, onUse, onForget }: RecentFilesListProps) {
  return (
    <div className={styles.recentsWrap}>
      <div className={styles.recentsLabel}>Recent files</div>
      <ul className={styles.recentsList}>
        {recents.map((r) => {
          const subtitle = r.folderName
            ? `${r.folderName} · ${formatRelative(r.lastUsedAt)}`
            : formatRelative(r.lastUsedAt);
          return (
            <li key={r.id} className={styles.recentRow}>
              <button
                type="button"
                className={styles.recentName}
                onClick={() => onUse(r.id)}
                disabled={disabled}
                title={`Re-open ${r.fileName} from ${r.folderName ?? "this folder"} (you'll be asked to grant read permission)`}
              >
                <FileGlyph className={styles.recentIcon} />
                <span className={styles.recentNameText}>{r.fileName}</span>
                <span className={styles.recentTime}>{subtitle}</span>
              </button>
              {onForget && (
                <button
                  type="button"
                  className={styles.recentForget}
                  onClick={() => onForget(r.id)}
                  disabled={disabled}
                  aria-label={`Forget ${r.fileName}`}
                  title="Remove from recent list"
                >
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FileGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  const min = 60 * 1000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return "just now";
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
