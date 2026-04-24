import type { FullModel } from "@/services/xml/model";
import type {
  Conflict,
  MergePlan,
  MissingColumnPlan,
  MissingTablePlan,
} from "./types";

export function computePlan(source: FullModel, target: FullModel): MergePlan {
  const tablesMissing: MissingTablePlan[] = [];
  const columnsMissing: MissingColumnPlan[] = [];
  const conflicts: Conflict[] = [];

  for (const srcEnt of source.entities) {
    const upper = srcEnt.name.toUpperCase();
    const tgtEnt = target.entitiesByUpper.get(upper);

    if (!tgtEnt) {
      tablesMissing.push({
        name: srcEnt.name,
        columnCount: srcEnt.columns.length,
        pk: [...srcEnt.pkNames],
        columns: srcEnt.columns.map((c) => ({
          name: c.name,
          physicalDataType: c.physicalDataType,
          nullable: c.nullable,
          domainName: c.domainName,
          isPk: c.isPk,
        })),
      });
      // Domain availability warnings.
      for (const c of srcEnt.columns) {
        if (c.domainName && !target.domainNameToId.has(c.domainName.toUpperCase())) {
          conflicts.push({
            kind: "missing_domain",
            table: srcEnt.name,
            column: c.name,
            domainName: c.domainName,
          });
        }
      }
      continue;
    }

    if (srcEnt.name !== tgtEnt.name) {
      conflicts.push({
        kind: "table_case_mismatch",
        sourceName: srcEnt.name,
        targetName: tgtEnt.name,
      });
    }

    const tgtColsByUpper = new Map(tgtEnt.columns.map((c) => [c.name.toUpperCase(), c]));

    for (const srcCol of srcEnt.columns) {
      const ukey = srcCol.name.toUpperCase();
      const tgtCol = tgtColsByUpper.get(ukey);
      if (!tgtCol) {
        columnsMissing.push({ table: tgtEnt.name, column: srcCol });
        if (srcCol.domainName && !target.domainNameToId.has(srcCol.domainName.toUpperCase())) {
          conflicts.push({
            kind: "missing_domain",
            table: tgtEnt.name,
            column: srcCol.name,
            domainName: srcCol.domainName,
          });
        }
        continue;
      }
      const diffs: Record<string, { source: string | null; target: string | null }> = {};
      if ((srcCol.physicalDataType ?? "") !== (tgtCol.physicalDataType ?? "")) {
        diffs.physical_data_type = { source: srcCol.physicalDataType, target: tgtCol.physicalDataType };
      }
      if ((srcCol.nullable ?? "") !== (tgtCol.nullable ?? "")) {
        diffs.nullable = { source: srcCol.nullable, target: tgtCol.nullable };
      }
      if ((srcCol.domainName ?? "") !== (tgtCol.domainName ?? "")) {
        diffs.domain_name = { source: srcCol.domainName, target: tgtCol.domainName };
      }
      if (srcCol.isPk !== tgtCol.isPk) {
        diffs.pk_membership = { source: String(srcCol.isPk), target: String(tgtCol.isPk) };
      }
      if (Object.keys(diffs).length) {
        conflicts.push({ kind: "column_diff", table: tgtEnt.name, column: tgtCol.name, diffs });
      }
    }
  }

  return { tablesMissing, columnsMissing, conflicts };
}
