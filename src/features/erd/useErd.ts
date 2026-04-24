import { useCallback, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/store";
import {
  loadFile as loadFileThunk,
  reset as resetAction,
} from "./erdSlice";
export type { ErdData } from "./erdSlice";

export function useErd() {
  const dispatch = useAppDispatch();
  const data = useAppSelector((s) => s.erd.data);
  const error = useAppSelector((s) => s.erd.error);
  const loading = useAppSelector((s) => s.erd.loading);

  const stats = useMemo(() => {
    if (!data) return null;
    return {
      entities: data.model.entities.length,
      relationships: data.relationships.length,
      domains: data.model.domainIdToName.size,
    };
  }, [data]);

  const loadFile = useCallback(
    (file: File) => {
      void dispatch(loadFileThunk(file));
    },
    [dispatch]
  );

  const reset = useCallback(() => {
    dispatch(resetAction());
  }, [dispatch]);

  return { data, error, loading, stats, loadFile, reset };
}
