import { useCallback, useMemo, useState } from "react";
import { parseFile, XmlParseError } from "@/services/xml/parser";
import { collectFullModel, type FullModel } from "@/services/xml/model";
import { collectRelationships, type Relationship } from "@/services/xml/relationships";
import { computeLayout, type LayoutResult } from "./layout";

export interface ErdData {
  filename: string;
  variant: string;
  model: FullModel;
  relationships: Relationship[];
  layout: LayoutResult;
}

export function useErd() {
  const [data, setData] = useState<ErdData | null>(null);
  const [error, setError] = useState<string | undefined>();

  const loadFile = useCallback(async (file: File) => {
    setError(undefined);
    try {
      const parsed = await parseFile(file);
      if (parsed.variant !== "erwin-dm-v9") {
        setError("ERD view requires an erwin-dm-v9 file.");
        setData(null);
        return;
      }
      const model = collectFullModel(parsed.doc);
      const relationships = collectRelationships(parsed.doc);
      const layout = computeLayout(model.entities, relationships);
      setData({
        filename: file.name,
        variant: parsed.variant,
        model,
        relationships,
        layout,
      });
    } catch (err) {
      const msg = err instanceof XmlParseError ? err.message : err instanceof Error ? err.message : String(err);
      setError(msg);
      setData(null);
    }
  }, []);

  const reset = useCallback(() => {
    setData(null);
    setError(undefined);
  }, []);

  // Convenience accessors for the panel.
  const stats = useMemo(() => {
    if (!data) return null;
    return {
      entities: data.model.entities.length,
      relationships: data.relationships.length,
      domains: data.model.domainIdToName.size,
    };
  }, [data]);

  return { data, error, stats, loadFile, reset };
}
