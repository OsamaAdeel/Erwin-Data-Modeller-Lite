// Apply staged additions from source into a fresh parse of target.
// Hard rules:
//   - Never modify existing target columns / PKs.
//   - Never copy source GUIDs; mint fresh ones.
//   - Resolve domains by NAME against target's library; on miss, fall back
//     by datatype, then '<default>', then leave Parent_Domain_Ref unset.
//   - Duplicate-table collision throws DuplicateTableError so the caller
//     can abort cleanly.

import { NS } from "@/services/xml/namespaces";
import { collectFullModel, type FullModel, type ModelColumn, type ModelEntity } from "@/services/xml/model";
import { parseText } from "@/services/xml/parser";
import { outputFilename, serializeDoc } from "@/services/xml/serialize";
import type { MergeReport } from "./types";

export class MergeExecuteError extends Error {}
export class DuplicateTableError extends MergeExecuteError {}

function newGuid(): string {
  return `{${crypto.randomUUID().toUpperCase()}}+00000000`;
}

function emxEl(
  doc: Document,
  name: string,
  text?: string | null,
  attrs?: Record<string, string>
): Element {
  const el = doc.createElementNS(NS.emx, "EMX:" + name);
  if (text != null) el.textContent = text;
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function resolveTargetDomain(
  target: FullModel,
  domainName: string | null,
  physType: string | null
): { name: string | null; id: string | null; note: string } {
  if (domainName) {
    const id = target.domainNameToId.get(domainName.toUpperCase());
    if (id) return { name: domainName, id, note: `domain '${domainName}' matched by name` };
  }

  let fallback: string | null = null;
  if (physType) {
    const pt = physType.toUpperCase();
    if (pt.startsWith("NUMBER") || ["INTEGER", "BIGINT", "DECIMAL", "NUMERIC"].includes(pt)) fallback = "AMOUNT";
    else if (pt.startsWith("VARCHAR") || pt.startsWith("CHAR") || pt.startsWith("NVARCHAR")) fallback = "CODE_ALPHANUMERIC_LONG";
    else if (pt.startsWith("DATE") || pt.startsWith("TIMESTAMP")) fallback = "DATE";
  }
  if (fallback) {
    const id = target.domainNameToId.get(fallback);
    if (id) {
      return { name: fallback, id,
        note: `domain '${domainName ?? "?"}' not in target — fell back to '${fallback}' by datatype '${physType}'` };
    }
  }
  const def = target.domainNameToId.get("<DEFAULT>");
  if (def) {
    return { name: "<default>", id: def,
      note: `domain '${domainName ?? "?"}' not in target and no type fallback matched — used '<default>'` };
  }
  return { name: null, id: null,
    note: `domain '${domainName ?? "?"}' not in target and no fallback found — Parent_Domain_Ref left unset` };
}

function findDMv9Container(doc: Document): Element | null {
  const udp =
    doc.getElementsByTagNameNS(NS.dm, "UDP_Definition_Groups")[0] ||
    doc.getElementsByTagName("UDP_Definition_Groups")[0];
  if (udp) {
    const eg =
      udp.getElementsByTagNameNS(NS.dm, "Entity_Groups")[0] ||
      udp.getElementsByTagName("Entity_Groups")[0];
    if (eg) return eg;
  }
  const first = doc.getElementsByTagNameNS(NS.emx, "Entity")[0];
  return first ? (first.parentNode as Element | null) : null;
}

function findEntityByName(doc: Document, nameUpper: string): Element | null {
  const ents = doc.getElementsByTagNameNS(NS.emx, "Entity");
  for (const e of Array.from(ents)) {
    if ((e.getAttribute("name") ?? "").toUpperCase() === nameUpper) return e;
  }
  return null;
}

function findEntityProps(entity: Element): Element | null {
  return (
    entity.getElementsByTagNameNS(NS.emx, "EntityProps")[0] ??
    entity.getElementsByTagNameNS(NS.emx, "Entity_Properties")[0] ??
    null
  );
}

function appendOrderRef(
  doc: Document,
  props: Element,
  arrayTag: string,
  refTag: string,
  refValue: string,
  createIfMissing: boolean
): boolean {
  let arr = props.getElementsByTagNameNS(NS.emx, arrayTag)[0];
  if (!arr) {
    if (!createIfMissing) return false;
    arr = doc.createElementNS(NS.emx, "EMX:" + arrayTag);
    props.appendChild(arr);
  }
  const ref = doc.createElementNS(NS.emx, "EMX:" + refTag);
  ref.setAttribute("index", String(arr.children.length));
  ref.textContent = refValue;
  arr.appendChild(ref);
  return true;
}

function appendNewEntity(
  doc: Document,
  srcEnt: ModelEntity,
  target: FullModel,
  warnings: string[],
  actions: string[]
): void {
  // If target has no entities at all we have no template — fall back to
  // building a minimal one. (This is an edge case: an empty target model.)
  const container = findDMv9Container(doc);
  if (!container) {
    throw new MergeExecuteError(
      "Could not locate the entity container in target — cannot add entities."
    );
  }

  const newId = newGuid();
  const entity = doc.createElementNS(NS.emx, "EMX:Entity");
  entity.setAttribute("id", newId);
  entity.setAttribute("name", srcEnt.name);

  const props = doc.createElementNS(NS.emx, "EMX:EntityProps");
  props.appendChild(emxEl(doc, "Name", srcEnt.name));
  props.appendChild(emxEl(doc, "Long_Id", newId));
  props.appendChild(emxEl(doc, "Type", "1"));
  props.appendChild(emxEl(doc, "Physical_Name", srcEnt.name, { Derived: "Y" }));
  props.appendChild(
    emxEl(doc, "Dependent_Objects_Ref_Array", null, { ReadOnly: "Y", Derived: "Y" })
  );
  props.appendChild(emxEl(doc, "Do_Not_Generate", "false", { Derived: "Y" }));

  // Order arrays — fill with column refs after columns are minted.
  const attrOrder = doc.createElementNS(NS.emx, "EMX:Attributes_Order_Ref_Array");
  const physOrder = doc.createElementNS(NS.emx, "EMX:Physical_Columns_Order_Ref_Array");
  props.appendChild(attrOrder);
  props.appendChild(physOrder);
  entity.appendChild(props);

  const ag = doc.createElementNS(NS.emx, "EMX:Attribute_Groups");
  entity.appendChild(ag);

  for (const col of srcEnt.columns) {
    const colId = newGuid();
    const attr = doc.createElementNS(NS.emx, "EMX:Attribute");
    attr.setAttribute("id", colId);
    attr.setAttribute("name", col.name);

    const ap = doc.createElementNS(NS.emx, "EMX:AttributeProps");
    ap.appendChild(emxEl(doc, "Name", col.name));
    ap.appendChild(emxEl(doc, "Long_Id", colId));
    if (col.physicalName) ap.appendChild(emxEl(doc, "Physical_Name", col.physicalName, { Derived: "Y" }));
    if (col.physicalDataType) ap.appendChild(emxEl(doc, "Physical_Data_Type", col.physicalDataType, { Derived: "Y" }));
    if (col.nullable) ap.appendChild(emxEl(doc, "Nullable", col.nullable));
    const { id: domId, note } = resolveTargetDomain(target, col.domainName, col.physicalDataType);
    if (domId) ap.appendChild(emxEl(doc, "Parent_Domain_Ref", domId));
    if (note && !note.endsWith("matched by name")) warnings.push(`${srcEnt.name}.${col.name}: ${note}`);

    attr.appendChild(ap);
    ag.appendChild(attr);

    appendOrderRef(doc, props, "Attributes_Order_Ref_Array", "Attributes_Order_Ref", colId, true);
    appendOrderRef(doc, props, "Physical_Columns_Order_Ref_Array", "Physical_Columns_Order_Ref", colId, true);
  }

  if (srcEnt.pkNames.length) {
    warnings.push(
      `Entity '${srcEnt.name}' added without its primary key (PK columns were ${srcEnt.pkNames.join(", ")}); add the PK manually in erwin after import.`
    );
  }

  container.appendChild(entity);
  actions.push(`Added entity '${srcEnt.name}' with ${srcEnt.columns.length} column(s).`);
}

function appendColumnToEntity(
  doc: Document,
  entityEl: Element,
  srcCol: ModelColumn,
  target: FullModel,
  warnings: string[],
  actions: string[]
): void {
  let ag = entityEl.getElementsByTagNameNS(NS.emx, "Attribute_Groups")[0];
  if (!ag) {
    ag = doc.createElementNS(NS.emx, "EMX:Attribute_Groups");
    entityEl.appendChild(ag);
  }

  const colId = newGuid();
  const attr = doc.createElementNS(NS.emx, "EMX:Attribute");
  attr.setAttribute("id", colId);
  attr.setAttribute("name", srcCol.name);

  const ap = doc.createElementNS(NS.emx, "EMX:AttributeProps");
  ap.appendChild(emxEl(doc, "Name", srcCol.name));
  ap.appendChild(emxEl(doc, "Long_Id", colId));
  if (srcCol.physicalName) ap.appendChild(emxEl(doc, "Physical_Name", srcCol.physicalName, { Derived: "Y" }));
  if (srcCol.physicalDataType) ap.appendChild(emxEl(doc, "Physical_Data_Type", srcCol.physicalDataType, { Derived: "Y" }));
  if (srcCol.nullable) ap.appendChild(emxEl(doc, "Nullable", srcCol.nullable));
  const { id: domId, note } = resolveTargetDomain(target, srcCol.domainName, srcCol.physicalDataType);
  if (domId) ap.appendChild(emxEl(doc, "Parent_Domain_Ref", domId));
  attr.appendChild(ap);
  ag.appendChild(attr);

  const props = findEntityProps(entityEl);
  if (props) {
    appendOrderRef(doc, props, "Attributes_Order_Ref_Array", "Attributes_Order_Ref", colId, true);
    appendOrderRef(doc, props, "Physical_Columns_Order_Ref_Array", "Physical_Columns_Order_Ref", colId, true);
    appendOrderRef(doc, props, "Columns_Order_Ref_Array", "Columns_Order_Ref", colId, false);
  }

  const entName = entityEl.getAttribute("name") ?? "?";
  actions.push(`Added column '${srcCol.name}' to entity '${entName}'.`);
  if (note && !note.endsWith("matched by name")) warnings.push(`${entName}.${srcCol.name}: ${note}`);
}

export interface ExecuteInput {
  source: FullModel;
  targetXml: string;          // raw text — re-parsed fresh for each merge
  targetFilename: string;
  stagedTablesUpper: string[];
  stagedColumns: Array<{ tableUpper: string; columnUpper: string }>;
}

export function executeMerge(input: ExecuteInput): MergeReport {
  const { source, targetXml, targetFilename, stagedTablesUpper, stagedColumns } = input;

  // Fresh parse — never reuse the cached doc.
  const fresh = parseText(targetXml, targetFilename);
  if (fresh.variant !== "erwin-dm-v9") {
    throw new MergeExecuteError("Target is not an erwin-dm-v9 file.");
  }
  const target = collectFullModel(fresh.doc);

  const actions: string[] = [];
  const warnings: string[] = [];

  // 1. Tables
  for (const upper of stagedTablesUpper) {
    const srcEnt = source.entitiesByUpper.get(upper);
    if (!srcEnt) {
      throw new MergeExecuteError(`Source has no table '${upper}' (selection out of sync).`);
    }
    if (target.entitiesByUpper.has(upper)) {
      throw new DuplicateTableError(`Table ${srcEnt.name} already exists in the ERwin model`);
    }
    appendNewEntity(fresh.doc, srcEnt, target, warnings, actions);
    // Add to live target index so subsequent column-adds for this table no-op.
    target.entitiesByUpper.set(upper, srcEnt);
  }

  // 2. Columns on existing tables
  for (const sel of stagedColumns) {
    const srcEnt = source.entitiesByUpper.get(sel.tableUpper);
    if (!srcEnt) continue;
    const srcCol = srcEnt.columns.find((c) => c.name.toUpperCase() === sel.columnUpper);
    if (!srcCol) continue;
    const targetEntEl = findEntityByName(fresh.doc, sel.tableUpper);
    if (!targetEntEl) {
      // Was newly added in step 1 — already carries its own columns. Skip.
      continue;
    }
    // Skip if column already exists.
    const ag = targetEntEl.getElementsByTagNameNS(NS.emx, "Attribute_Groups")[0];
    let present = false;
    if (ag) {
      for (const a of Array.from(ag.children)) {
        if (a.namespaceURI === NS.emx && a.localName === "Attribute" &&
            (a.getAttribute("name") ?? "").toUpperCase() === sel.columnUpper) {
          present = true; break;
        }
      }
    }
    if (present) {
      warnings.push(`Column ${srcEnt.name}.${srcCol.name}: already present in target, skipped.`);
      continue;
    }
    appendColumnToEntity(fresh.doc, targetEntEl, srcCol, target, warnings, actions);
  }

  // Serialize and re-parse to confirm well-formedness.
  const xml = serializeDoc(fresh.doc);
  try {
    const reparse = new DOMParser().parseFromString(xml, "application/xml");
    if (reparse.querySelector("parsererror")) {
      throw new MergeExecuteError("Merged XML is not well-formed.");
    }
  } catch (err) {
    if (err instanceof MergeExecuteError) throw err;
    throw new MergeExecuteError(`Merged XML failed re-parse: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    outputFilename: outputFilename(targetFilename),
    xml,
    actions,
    warnings,
  };
}

export function buildReportText(
  sourceFilename: string,
  targetFilename: string,
  report: MergeReport,
  unresolvedConflictCount: number
): string {
  const lines: string[] = [];
  lines.push("erwin Model Merge — Report");
  lines.push("=".repeat(50));
  lines.push(`Source: ${sourceFilename}`);
  lines.push(`Target: ${targetFilename}`);
  lines.push(`Output: ${report.outputFilename}`);
  lines.push("");
  lines.push(`Actions (${report.actions.length}):`);
  if (report.actions.length) {
    for (const a of report.actions) lines.push(`  - ${a}`);
  } else lines.push("  (none)");
  lines.push("");
  lines.push(`Warnings (${report.warnings.length}):`);
  if (report.warnings.length) {
    for (const w of report.warnings) lines.push(`  - ${w}`);
  } else lines.push("  (none)");
  lines.push("");
  lines.push(`Unresolved conflicts: ${unresolvedConflictCount}`);
  return lines.join("\n");
}
