import { useEffect, useMemo, useRef, useState } from "react";
import { COMMON, ERD } from "@/CONSTANTS";
import Button from "@/components/atoms/Button";
import Card from "@/components/atoms/Card";
import Input from "@/components/atoms/Input";
import FileDrop from "@/components/molecules/FileDrop";
import StatTile from "@/components/molecules/StatTile";
import EmptyState from "@/components/molecules/EmptyState";
import { useErd } from "@/features/erd/useErd";
import ErdEntity from "./ErdEntity";
import ErdEdge from "./ErdEdge";
import ErdViewport from "./ErdViewport";
import styles from "./ErdPanel.module.scss";

// Tiny standalone debounce. Inline rather than a shared hook because it's
// the only call site in the project right now — promote later if reused.
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export default function ErdPanel() {
  const t = ERD.sections;
  const erd = useErd();
  const [hovered, setHovered] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const inspectedEntity = useMemo(
    () =>
      inspectedId && erd.data
        ? erd.data.model.entities.find((e) => e.id === inspectedId) ?? null
        : null,
    [inspectedId, erd.data]
  );

  // Debounce the search 100 ms before recomputing the match set. Invisible
  // on small models (matched within 100 ms feels instant); on a 500-entity
  // model this stops the per-keystroke filter from feeling sluggish.
  const debouncedSearch = useDebouncedValue(search, 100);

  // Build the matched-id set on every render — O(N) over entities. Empty
  // search short-circuits to an empty set so dim/match logic is a no-op.
  const matchedIds = useMemo<Set<string>>(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q || !erd.data) return new Set();
    const out = new Set<string>();
    for (const ent of erd.data.model.entities) {
      if (ent.name.toLowerCase().includes(q)) out.add(ent.id);
    }
    return out;
  }, [debouncedSearch, erd.data]);

  const totalEntities = erd.data?.model.entities.length ?? 0;
  const isSearching = search.trim().length > 0;

  const highlightedEdgeIds = new Set<string>();
  if (hovered && erd.data) {
    for (const e of erd.data.layout.edges) {
      if (e.sourceId === hovered || e.targetId === hovered) highlightedEdgeIds.add(e.id);
    }
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape" && search) {
      e.preventDefault();
      setSearch("");
    }
  }

  // Esc closes the inspector when it's open. Single global listener — the
  // inspector panel itself is not focused, so we can't rely on a local
  // keydown handler.
  useEffect(() => {
    if (!inspectedId) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setInspectedId(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inspectedId]);

  function clearSearch() {
    setSearch("");
    searchInputRef.current?.focus();
  }

  return (
    <div className={styles.wrap}>
      <Card
        step={1}
        stepState={erd.data ? "complete" : "active"}
        title={t.load.heading}
        subtitle={t.load.subhint}
      >
        {!erd.data && (
          <p className={styles.explainer}>{t.load.explainer}</p>
        )}
        <FileDrop
          hint={t.load.dropHint}
          subhint={t.load.dropSubhint}
          loadedName={erd.data?.filename}
          loadedMeta={erd.stats ? `${erd.stats.entities} entities · ${erd.stats.relationships} relationships` : undefined}
          error={erd.error}
          loading={erd.loading}
          loadingHint="Building diagram…"
          onFile={(f) => void erd.loadFile(f)}
        />
        {erd.data && (
          <div className={styles.actionsRow}>
            <Button variant="ghost" size="sm" onClick={erd.reset}>
              {COMMON.buttons.reset}
            </Button>
          </div>
        )}
      </Card>

      {erd.data && erd.stats && (
        <Card step={2} stepState="active" title={t.view.heading} subtitle={t.view.subhint}>
          <div className={styles.tileGrid}>
            <StatTile
              label={t.view.tilesEntities}
              value={erd.stats.entities}
              hint="An entity is one logical table — each becomes a card in the diagram."
            />
            <StatTile
              label={t.view.tilesRelationships}
              value={erd.stats.relationships}
              hint="A parent–child link between two entities (e.g. CUSTOMER → ORDER)."
            />
            <StatTile
              label={t.view.tilesDomains}
              value={erd.stats.domains}
              hint="A reusable column type (e.g. AMOUNT, DATE) defined in the model and referenced by attributes."
            />
          </div>

          {erd.stats.entities > 0 && (
            <div className={styles.searchRow}>
              <div className={styles.searchInputWrap}>
                <Input
                  ref={searchInputRef}
                  type="search"
                  placeholder="Search entities…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  spellCheck={false}
                  autoComplete="off"
                  aria-label="Search entities"
                />
                {isSearching && (
                  <button
                    type="button"
                    className={styles.searchClear}
                    onClick={clearSearch}
                    aria-label="Clear search"
                    title="Clear search (Esc)"
                  >
                    ×
                  </button>
                )}
              </div>
              {isSearching && (
                <span
                  className={styles.searchCounter}
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {matchedIds.size} of {totalEntities}
                </span>
              )}
            </div>
          )}

          {erd.stats.entities === 0 ? (
            <EmptyState
              title={t.view.noEntitiesTitle}
              description={t.view.noEntitiesDesc}
            />
          ) : (
            <ErdViewport
              contentWidth={erd.data.layout.width}
              contentHeight={erd.data.layout.height}
              minimapEntities={Array.from(erd.data.layout.nodes.values())}
              minimapMatchedIds={isSearching ? matchedIds : undefined}
            >
              {/* draw edges first so they sit behind entity cards */}
              {erd.data.layout.edges.map((e) => {
                // An edge is dimmed only when BOTH endpoints are non-matches.
                // Edges touching a match stay full-opacity to preserve context.
                const edgeDimmed =
                  isSearching &&
                  !matchedIds.has(e.sourceId) &&
                  !matchedIds.has(e.targetId);
                return (
                  <ErdEdge
                    key={e.id}
                    edge={e}
                    highlighted={highlightedEdgeIds.has(e.id)}
                    isDimmed={edgeDimmed}
                  />
                );
              })}
              {erd.data.model.entities.map((ent) => {
                const pos = erd.data!.layout.nodes.get(ent.id);
                if (!pos) return null;
                const isMatched = isSearching && matchedIds.has(ent.id);
                const isDimmed = isSearching && !matchedIds.has(ent.id);
                return (
                  <ErdEntity
                    key={ent.id}
                    entity={ent}
                    position={pos}
                    highlighted={hovered === ent.id}
                    isMatched={isMatched}
                    isDimmed={isDimmed}
                    onMouseEnter={() => setHovered(ent.id)}
                    onMouseLeave={() => setHovered(null)}
                    onActivate={() => setInspectedId(ent.id)}
                  />
                );
              })}
            </ErdViewport>
          )}

          {inspectedEntity && (
            <div className={styles.inspector} role="region" aria-label={`Columns of ${inspectedEntity.name}`}>
              <div className={styles.inspectorHead}>
                <div className={styles.inspectorTitleWrap}>
                  <span className={styles.inspectorEyebrow}>Entity</span>
                  <span className={styles.inspectorTitle}>{inspectedEntity.name}</span>
                  <span className={styles.inspectorCount}>
                    {inspectedEntity.columns.length} column{inspectedEntity.columns.length === 1 ? "" : "s"}
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.inspectorClose}
                  onClick={() => setInspectedId(null)}
                  aria-label="Close inspector"
                  title="Close (Esc)"
                >
                  ×
                </button>
              </div>
              {inspectedEntity.columns.length === 0 ? (
                <p className={styles.inspectorEmpty}>This entity has no columns.</p>
              ) : (
                <ul className={styles.inspectorList}>
                  {inspectedEntity.columns.map((c) => {
                    const notNull = c.nullable && c.nullable.toLowerCase() === "false";
                    return (
                      <li key={c.id} className={styles.inspectorRow}>
                        <span className={styles.inspectorRowName}>
                          {c.isPk && <span className={styles.inspectorPk} title="Primary key">🔑</span>}
                          {c.name}
                        </span>
                        <span className={styles.inspectorRowType}>
                          {c.physicalDataType || c.domainName || "—"}
                        </span>
                        <span className={styles.inspectorRowFlags}>
                          {c.isPk && <span className={styles.inspectorFlagPk}>PK</span>}
                          {notNull && <span className={styles.inspectorFlagReq}>NOT NULL</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          <div className={styles.legend}>
            <span>{t.view.legendDrag}</span>
            <span>·</span>
            <span>{t.view.legendZoom}</span>
            <span>·</span>
            <span>{t.view.legendHover}</span>
            <span>·</span>
            <span>Click an entity to see all columns</span>
            <span>·</span>
            <span>Tab into the canvas to use +/− to zoom, 0 to fit, arrows to pan</span>
          </div>
        </Card>
      )}
    </div>
  );
}
