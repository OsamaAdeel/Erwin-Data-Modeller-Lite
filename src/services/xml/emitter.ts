// OFSAA-compliant ERwin DM v9 emitter.
//
// Every structural choice in this file is driven by the OFSAA ERwin importer
// rules: required field order, Derived/ReadOnly XML attributes, the
// Null_Option_Type integer (not the legacy Nullable tag), the PK Key_Group_Type
// = "PK" string, and cross-reference integrity. See validator.ts for the
// machine-checkable version of those rules.

import { ORACLE_RESERVED_WORDS } from "@/services/ddl/oracleParser";
import { NS } from "./namespaces";
import type { NewColumnSpec } from "./types";

export class EmitterError extends Error {}

// Max identifier length accepted by the OFSAA importer (stricter than Oracle
// 12.2's 128 chars). Enforced at emit time only — the form-level validator in
// features/addTable is allowed to be more permissive for non-OFSAA workflows.
const OFSAA_MAX_IDENTIFIER_LEN = 30;

const ENTITY_TYPE_REGULAR = "1";
const ATTR_TYPE_REGULAR = "100";

// Null_Option_Type: 0 = NOT NULL, 1 = NULL. Do not emit the legacy Nullable
// tag — it trips ORA-00904 in OFSAA.
function nullOptionType(col: NewColumnSpec): string {
  return col.nullable ? "1" : "0";
}

function newGuid(): string {
  return `{${crypto.randomUUID().toUpperCase()}}+00000000`;
}

function emxEl(
  doc: Document,
  name: string,
  text: string | null,
  attrs?: Record<string, string>
): Element {
  const el = doc.createElementNS(NS.emx, "EMX:" + name);
  if (text !== null && text !== undefined) el.textContent = text;
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function orderRefArray(
  doc: Document,
  arrayTag: string,
  itemTag: string,
  ids: string[]
): Element {
  const arr = doc.createElementNS(NS.emx, "EMX:" + arrayTag);
  ids.forEach((id, i) => {
    const ref = doc.createElementNS(NS.emx, "EMX:" + itemTag);
    ref.setAttribute("index", String(i));
    ref.textContent = id;
    arr.appendChild(ref);
  });
  return arr;
}

export function formatDatatype(col: NewColumnSpec): string {
  if (col.type === "VARCHAR2" || col.type === "CHAR") {
    return col.size ? `${col.type}(${col.size})` : col.type;
  }
  if (col.type === "NUMBER") {
    if (col.size && col.scale) return `NUMBER(${col.size},${col.scale})`;
    if (col.size) return `NUMBER(${col.size})`;
    return "NUMBER";
  }
  return col.type;
}

// Logical_Data_Type per OFSAA Rule 5. Kept distinct from the Oracle physical
// type so the importer can re-derive the physical one if ever asked to.
export function logicalDatatype(col: NewColumnSpec): string {
  switch (col.type) {
    case "VARCHAR2":
      return col.size ? `VARCHAR(${col.size})` : "VARCHAR";
    case "CHAR":
      return col.size ? `CHAR(${col.size})` : "CHAR";
    case "NUMBER":
      if (col.size && col.scale) return `DECIMAL(${col.size},${col.scale})`;
      if (col.size) return `DECIMAL(${col.size})`;
      return "INTEGER";
    case "DATE":
      return "DATE";
    case "TIMESTAMP":
      return "TIMESTAMP";
    case "CLOB":
      return "LONG";
    case "BLOB":
      return "LARGE BINARY";
    default: {
      // Defensive: if the union is ever extended and this switch isn't,
      // throw rather than emit a blank string (Rule 5).
      const bad = (col as NewColumnSpec).type as string;
      throw new EmitterError(`Unknown logical type for "${bad}"`);
    }
  }
}

// Strict OFSAA identifier check. Raises EmitterError with the offending name,
// does not silently truncate or quote.
export function assertOfsaaIdentifier(name: string, kind: string): void {
  if (!name) throw new EmitterError(`${kind} cannot be empty`);
  if (!/^[A-Za-z]/.test(name)) {
    throw new EmitterError(`${kind} "${name}" must start with a letter`);
  }
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    throw new EmitterError(
      `${kind} "${name}" may only contain letters, digits, and underscores`
    );
  }
  if (name.length > OFSAA_MAX_IDENTIFIER_LEN) {
    throw new EmitterError(
      `${kind} "${name}" exceeds ${OFSAA_MAX_IDENTIFIER_LEN}-character OFSAA limit (got ${name.length})`
    );
  }
  if (ORACLE_RESERVED_WORDS.has(name.toUpperCase())) {
    throw new EmitterError(`${kind} "${name}" is an Oracle reserved word`);
  }
}

export function pickDomain(
  col: NewColumnSpec,
  domainMap: Map<string, string>
): string | null {
  if (!domainMap.size) return null;
  let wants: string[] = [];
  if (col.type === "DATE") wants = ["DATE", "Date", "Datetime"];
  else if (col.type === "TIMESTAMP") wants = ["Timestamp", "TIMESTAMP_TYPE2", "Datetime", "DATE"];
  else if (col.type === "NUMBER") wants = ["NUMBER", "Number", "Amount", "Numeric"];
  else if (col.type === "VARCHAR2") wants = ["VARCHAR2", "Code_Alphanumeric_Long", "String"];
  else if (col.type === "CHAR") wants = ["CHAR", "Code_Alphanumeric_Short", "String"];
  else if (col.type === "CLOB") wants = ["CLOB", "Text_Long_Description", "String"];
  wants.push("<default>", "<root>");
  for (const n of wants) {
    const id = domainMap.get(n);
    if (id) return id;
  }
  return domainMap.values().next().value ?? null;
}

function findDMv9Container(doc: Document): Element | null {
  // Expected path: /erwin/UDP_Definition_Groups/Entity_Groups
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

function findModelName(doc: Document): string {
  const model = doc.getElementsByTagNameNS(NS.emx, "Model")[0];
  if (model) {
    const n = model.getAttribute("name");
    if (n) return n;
  }
  return "Model_1";
}

// Collect every existing Key_Group name so we can reject XPK<tableName>
// collisions before emitting (Rule 7 uniqueness).
function collectKeyGroupNames(doc: Document): Set<string> {
  const names = new Set<string>();
  const groups = doc.getElementsByTagNameNS(NS.emx, "Key_Group");
  for (const kg of Array.from(groups)) {
    const nameAttr = kg.getAttribute("name");
    if (nameAttr) names.add(nameAttr);
    const props = kg.getElementsByTagNameNS(NS.emx, "Key_GroupProps")[0];
    if (props) {
      const nameEl = props.getElementsByTagNameNS(NS.emx, "Name")[0];
      const text = nameEl?.textContent?.trim();
      if (text) names.add(text);
    }
  }
  return names;
}

// -------------------------------------------------------------------------
// Classic (pre-DM-v9) emitter — untouched. OFSAA targets the DM-v9 schema;
// classic output is still used by other tools that consume the legacy format.

export function addEntityClassic(
  doc: Document,
  tableName: string,
  cols: NewColumnSpec[]
): void {
  const root = doc.documentElement;
  const entity = doc.createElement("Entity");
  entity.setAttribute("Name", tableName);
  entity.setAttribute("Physical_Name", tableName);

  cols.forEach((c) => {
    const a = doc.createElement("Attribute");
    a.setAttribute("Name", c.name);
    a.setAttribute("Physical_Name", c.name);
    a.setAttribute("Datatype", formatDatatype(c));
    a.setAttribute("Nullable", c.nullable ? "true" : "false");
    entity.appendChild(a);
  });

  const pkCols = cols.filter((c) => c.pk);
  if (pkCols.length) {
    const kg = doc.createElement("Key_Group");
    kg.setAttribute("Name", `XPK${tableName}`);
    kg.setAttribute("Type", "PK");
    pkCols.forEach((pk) => {
      const ka = doc.createElement("Key_Attribute");
      ka.setAttribute("Name", pk.name);
      kg.appendChild(ka);
    });
    entity.appendChild(kg);
  }
  root.appendChild(entity);
}

// -------------------------------------------------------------------------
// OFSAA-compliant DM v9 emitter.

export function addEntityDMv9(
  doc: Document,
  tableName: string,
  cols: NewColumnSpec[],
  domainMap: Map<string, string>
): void {
  const container = findDMv9Container(doc);
  if (!container) {
    throw new EmitterError(
      "Could not locate the entity container in this DM-v9 file."
    );
  }

  // Rule 6 — identifier constraints. Fail fast with a descriptive message.
  assertOfsaaIdentifier(tableName, "table name");
  for (const c of cols) assertOfsaaIdentifier(c.name, "column name");

  // Rule 5 — force early type validation (throws on unknown types).
  for (const c of cols) logicalDatatype(c);

  // Rule 7 — PK index name must be unique across the whole model.
  const kgName = `XPK${tableName}`;
  const existingKgNames = collectKeyGroupNames(doc);
  if (existingKgNames.has(kgName)) {
    throw new EmitterError(
      `Primary key index "${kgName}" already exists in the model`
    );
  }

  const modelName = findModelName(doc);
  const ownerPathEntity = modelName;
  const ownerPathChild = `${modelName}.${tableName}`;

  const colIds = cols.map(() => newGuid());
  const entityId = newGuid();

  const entity = doc.createElementNS(NS.emx, "EMX:Entity");
  entity.setAttribute("id", entityId);
  entity.setAttribute("name", tableName);

  // -- EntityProps (Rule 3 — fields must appear in this order) ------------
  const props = doc.createElementNS(NS.emx, "EMX:EntityProps");
  props.appendChild(emxEl(doc, "Name", tableName));
  props.appendChild(emxEl(doc, "Long_Id", entityId));
  props.appendChild(
    emxEl(doc, "Owner_Path", ownerPathEntity, {
      Tool: "Y",
      ReadOnly: "Y",
      Derived: "Y",
    })
  );
  props.appendChild(emxEl(doc, "Type", ENTITY_TYPE_REGULAR));
  props.appendChild(emxEl(doc, "Physical_Name", tableName, { Derived: "Y" }));
  props.appendChild(
    emxEl(doc, "Dependent_Objects_Ref_Array", null, {
      ReadOnly: "Y",
      Derived: "Y",
    })
  );
  props.appendChild(
    emxEl(doc, "Do_Not_Generate", "false", { Derived: "Y" })
  );
  props.appendChild(
    orderRefArray(
      doc,
      "Attributes_Order_Ref_Array",
      "Attributes_Order_Ref",
      colIds
    )
  );
  props.appendChild(
    orderRefArray(
      doc,
      "Physical_Columns_Order_Ref_Array",
      "Physical_Columns_Order_Ref",
      colIds
    )
  );
  props.appendChild(
    orderRefArray(doc, "Columns_Order_Ref_Array", "Columns_Order_Ref", colIds)
  );
  props.appendChild(
    emxEl(doc, "User_Formatted_Name", tableName, {
      ReadOnly: "Y",
      Derived: "Y",
    })
  );
  entity.appendChild(props);

  // -- Attribute_Groups (Rule 4) ------------------------------------------
  const attrGroups = doc.createElementNS(NS.emx, "EMX:Attribute_Groups");
  cols.forEach((col, i) => {
    const orderStr = String(i + 1); // 1-based per Rule 4

    const attr = doc.createElementNS(NS.emx, "EMX:Attribute");
    attr.setAttribute("id", colIds[i]);
    attr.setAttribute("name", col.name);

    const ap = doc.createElementNS(NS.emx, "EMX:AttributeProps");
    ap.appendChild(emxEl(doc, "Name", col.name));
    ap.appendChild(emxEl(doc, "Long_Id", colIds[i]));
    ap.appendChild(
      emxEl(doc, "Owner_Path", ownerPathChild, {
        Tool: "Y",
        ReadOnly: "Y",
        Derived: "Y",
      })
    );
    ap.appendChild(emxEl(doc, "Type", ATTR_TYPE_REGULAR));
    ap.appendChild(
      emxEl(doc, "Physical_Data_Type", formatDatatype(col), { Derived: "Y" })
    );
    ap.appendChild(
      emxEl(doc, "Null_Option_Type", nullOptionType(col), { Derived: "Y" })
    );
    ap.appendChild(
      emxEl(doc, "Physical_Order", orderStr, {
        ReadOnly: "Y",
        Derived: "Y",
      })
    );
    ap.appendChild(emxEl(doc, "Comment", null, { Derived: "Y" }));
    ap.appendChild(emxEl(doc, "Physical_Name", col.name, { Derived: "Y" }));
    ap.appendChild(
      emxEl(doc, "Logical_Data_Type", logicalDatatype(col), { Derived: "Y" })
    );

    const domainId = pickDomain(col, domainMap);
    if (domainId) ap.appendChild(emxEl(doc, "Parent_Domain_Ref", domainId));

    ap.appendChild(
      emxEl(doc, "Attribute_Order", orderStr, {
        ReadOnly: "Y",
        Derived: "Y",
      })
    );
    ap.appendChild(
      emxEl(doc, "Column_Order", orderStr, {
        ReadOnly: "Y",
        Derived: "Y",
      })
    );
    ap.appendChild(
      emxEl(doc, "User_Formatted_Name", col.name, {
        ReadOnly: "Y",
        Derived: "Y",
      })
    );

    attr.appendChild(ap);
    attrGroups.appendChild(attr);
  });
  entity.appendChild(attrGroups);

  // -- Key_Group (PK) (Rule 7) --------------------------------------------
  const pkCols = cols.filter((c) => c.pk);
  if (pkCols.length) {
    const kgGroups = doc.createElementNS(NS.emx, "EMX:Key_Group_Groups");
    const kgId = newGuid();
    const kg = doc.createElementNS(NS.emx, "EMX:Key_Group");
    kg.setAttribute("id", kgId);
    kg.setAttribute("name", kgName);

    const kgp = doc.createElementNS(NS.emx, "EMX:Key_GroupProps");
    kgp.appendChild(emxEl(doc, "Name", kgName));
    kgp.appendChild(emxEl(doc, "Long_Id", kgId));
    kgp.appendChild(
      emxEl(doc, "Owner_Path", ownerPathChild, {
        Tool: "Y",
        ReadOnly: "Y",
        Derived: "Y",
      })
    );
    kgp.appendChild(emxEl(doc, "Key_Group_Type", "PK")); // string, NOT integer
    kgp.appendChild(emxEl(doc, "Physical_Name", kgName, { Derived: "Y" }));
    kgp.appendChild(emxEl(doc, "Generate_As_Constraint", "true"));
    kgp.appendChild(
      emxEl(doc, "Dependent_Objects_Ref_Array", null, {
        ReadOnly: "Y",
        Derived: "Y",
      })
    );
    kgp.appendChild(
      emxEl(doc, "Do_Not_Generate", "false", { Derived: "Y" })
    );
    kgp.appendChild(emxEl(doc, "Constraint_Name", kgName, { Derived: "Y" }));
    kgp.appendChild(emxEl(doc, "Is_Unique", "true", { Derived: "Y" }));
    kgp.appendChild(
      emxEl(doc, "User_Formatted_Name", kgName, {
        ReadOnly: "Y",
        Derived: "Y",
      })
    );

    // Members (order array + full member groups)
    const kmIds = pkCols.map(() => newGuid());
    const kmOrder = doc.createElementNS(
      NS.emx,
      "EMX:Key_Group_Members_Order_Ref_Array"
    );
    pkCols.forEach((_, i) => {
      const ref = doc.createElementNS(
        NS.emx,
        "EMX:Key_Group_Members_Order_Ref"
      );
      ref.setAttribute("index", String(i));
      ref.textContent = kmIds[i];
      kmOrder.appendChild(ref);
    });
    kgp.appendChild(kmOrder);
    kg.appendChild(kgp);

    const kmGroups = doc.createElementNS(
      NS.emx,
      "EMX:Key_Group_Member_Groups"
    );
    pkCols.forEach((pk, i) => {
      const km = doc.createElementNS(NS.emx, "EMX:Key_Group_Member");
      km.setAttribute("id", kmIds[i]);

      const kmp = doc.createElementNS(NS.emx, "EMX:Key_Group_MemberProps");
      kmp.appendChild(emxEl(doc, "Long_Id", kmIds[i]));
      const ar = doc.createElementNS(NS.emx, "EMX:Attribute_Ref");
      ar.textContent = colIds[cols.indexOf(pk)];
      kmp.appendChild(ar);
      km.appendChild(kmp);
      kmGroups.appendChild(km);
    });
    kg.appendChild(kmGroups);
    kgGroups.appendChild(kg);
    entity.appendChild(kgGroups);
  }

  container.appendChild(entity);
}
