import { useCallback, useMemo, useState } from "react";
import {
  MAX_COLUMNS_PER_TABLE,
} from "@/services/ddl/oracleParser";
import {
  XmlParseError,
  parseFile,
} from "@/services/xml/parser";
import {
  EmitterError,
  addEntityClassic,
  addEntityDMv9,
} from "@/services/xml/emitter";
import { outputFilename, serializeDoc } from "@/services/xml/serialize";
import type { DataType, NewColumnSpec, ParsedDoc } from "@/services/xml/types";
import { downloadBlob } from "@/utils/download";
import { validate, type ValidationResult } from "./validation";

export interface SuccessInfo {
  tableName: string;
  filename: string;
}

function makeColumn(): NewColumnSpec {
  return {
    id: crypto.randomUUID(),
    name: "",
    type: "VARCHAR2",
    size: "",
    scale: "",
    nullable: true,
    pk: false,
  };
}

export function useAddTable() {
  const [parsed, setParsed] = useState<ParsedDoc | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [tableName, setTableName] = useState("");
  const [columns, setColumns] = useState<NewColumnSpec[]>([makeColumn()]);
  const [success, setSuccess] = useState<SuccessInfo | undefined>();

  // ---------- file load ----------
  const loadFile = useCallback(async (file: File) => {
    setLoadError(undefined);
    setSuccess(undefined);
    try {
      const next = await parseFile(file);
      setParsed(next);
      resetForm();
    } catch (err) {
      if (err instanceof XmlParseError) setLoadError(err.message);
      else setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // ---------- form mutations ----------
  function resetForm() {
    setTableName("");
    setColumns([makeColumn()]);
    setSuccess(undefined);
  }

  const addColumn = useCallback(() => {
    setColumns((prev) =>
      prev.length >= MAX_COLUMNS_PER_TABLE ? prev : [...prev, makeColumn()]
    );
  }, []);

  const removeColumn = useCallback((id: string) => {
    setColumns((prev) => (prev.length <= 1 ? prev : prev.filter((c) => c.id !== id)));
  }, []);

  const updateColumn = useCallback(
    (id: string, patch: Partial<NewColumnSpec>) => {
      setColumns((prev) =>
        prev.map((c) => {
          if (c.id !== id) return c;
          const next = { ...c, ...patch };
          // PK columns are NOT NULL by definition; clear nullable.
          if (patch.pk === true) next.nullable = false;
          // Reset size/scale when type changes — old values may be invalid.
          if (patch.type && patch.type !== c.type) {
            next.size = "";
            next.scale = "";
          }
          return next;
        })
      );
    },
    []
  );

  const setColumnType = useCallback(
    (id: string, type: DataType) => updateColumn(id, { type }),
    [updateColumn]
  );

  // ---------- validation ----------
  const validation: ValidationResult = useMemo(
    () =>
      validate({
        tableName,
        columns,
        entityDict: parsed?.entityDict ?? new Map(),
      }),
    [tableName, columns, parsed]
  );

  // ---------- generate ----------
  const generate = useCallback(() => {
    if (!parsed) return;
    if (!validation.canSubmit) return;
    const trimmedName = tableName.trim();
    const trimmedCols = columns.map((c) => ({ ...c, name: c.name.trim() }));

    try {
      if (parsed.variant === "erwin-dm-v9") {
        addEntityDMv9(parsed.doc, trimmedName, trimmedCols, parsed.domainMap);
      } else {
        addEntityClassic(parsed.doc, trimmedName, trimmedCols);
      }
    } catch (err) {
      if (err instanceof EmitterError) {
        setLoadError(err.message);
        return;
      }
      throw err;
    }

    // Update entity dict + filename roll-forward.
    const nextDict = new Map(parsed.entityDict);
    nextDict.set(trimmedName.toUpperCase(), trimmedName);
    const nextName = outputFilename(parsed.fileName);

    const xml = serializeDoc(parsed.doc);
    downloadBlob(xml, nextName, "application/xml");

    setParsed({
      ...parsed,
      fileName: nextName,
      entityDict: nextDict,
    });
    setSuccess({ tableName: trimmedName, filename: nextName });
  }, [parsed, validation, tableName, columns]);

  return {
    // state
    parsed,
    loadError,
    tableName,
    columns,
    success,
    validation,
    // actions
    loadFile,
    setTableName,
    addColumn,
    removeColumn,
    updateColumn,
    setColumnType,
    generate,
    resetForm,
  };
}
