import { useState } from "react";
import { COMMON, ERD } from "@/CONSTANTS";
import Button from "@/components/atoms/Button";
import Card from "@/components/atoms/Card";
import FileDrop from "@/components/molecules/FileDrop";
import StatTile from "@/components/molecules/StatTile";
import EmptyState from "@/components/molecules/EmptyState";
import { useErd } from "@/features/erd/useErd";
import ErdEntity from "./ErdEntity";
import ErdEdge from "./ErdEdge";
import ErdViewport from "./ErdViewport";
import styles from "./ErdPanel.module.scss";

export default function ErdPanel() {
  const t = ERD.sections;
  const erd = useErd();
  const [hovered, setHovered] = useState<string | null>(null);

  const highlightedEdgeIds = new Set<string>();
  if (hovered && erd.data) {
    for (const e of erd.data.layout.edges) {
      if (e.sourceId === hovered || e.targetId === hovered) highlightedEdgeIds.add(e.id);
    }
  }

  return (
    <div className={styles.wrap}>
      <Card step={1} title={t.load.heading} subtitle={t.load.subhint}>
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
        <Card step={2} title={t.view.heading} subtitle={t.view.subhint}>
          <div className={styles.tileGrid}>
            <StatTile label={t.view.tilesEntities} value={erd.stats.entities} />
            <StatTile label={t.view.tilesRelationships} value={erd.stats.relationships} />
            <StatTile label={t.view.tilesDomains} value={erd.stats.domains} />
          </div>

          {erd.stats.entities === 0 ? (
            <EmptyState
              title={t.view.noEntitiesTitle}
              description={t.view.noEntitiesDesc}
            />
          ) : (
            <ErdViewport
              contentWidth={erd.data.layout.width}
              contentHeight={erd.data.layout.height}
            >
              {/* draw edges first so they sit behind entity cards */}
              {erd.data.layout.edges.map((e) => (
                <ErdEdge key={e.id} edge={e} highlighted={highlightedEdgeIds.has(e.id)} />
              ))}
              {erd.data.model.entities.map((ent) => {
                const pos = erd.data!.layout.nodes.get(ent.id);
                if (!pos) return null;
                return (
                  <ErdEntity
                    key={ent.id}
                    entity={ent}
                    position={pos}
                    highlighted={hovered === ent.id}
                    onMouseEnter={() => setHovered(ent.id)}
                    onMouseLeave={() => setHovered(null)}
                  />
                );
              })}
            </ErdViewport>
          )}

          <div className={styles.legend}>
            <span>{t.view.legendDrag}</span>
            <span>·</span>
            <span>{t.view.legendZoom}</span>
            <span>·</span>
            <span>{t.view.legendHover}</span>
          </div>
        </Card>
      )}
    </div>
  );
}
