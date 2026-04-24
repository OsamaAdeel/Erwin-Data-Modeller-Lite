import { NS } from "./namespaces";
import type { NewColumnSpec } from "./types";

export class EmitterError extends Error {}

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
  // Fallback: parent of the first existing entity
  const first = doc.getElementsByTagNameNS(NS.emx, "Entity")[0];
  return first ? first.parentNode as Element | null : null;
}

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

  const colIds = cols.map(() => newGuid());
  const entityId = newGuid();

  const entity = doc.createElementNS(NS.emx, "EMX:Entity");
  entity.setAttribute("id", entityId);
  entity.setAttribute("name", tableName);

  // -- EntityProps
  const props = doc.createElementNS(NS.emx, "EMX:EntityProps");
  props.appendChild(emxEl(doc, "Name", tableName));
  props.appendChild(emxEl(doc, "Long_Id", entityId));
  props.appendChild(emxEl(doc, "Type", "1"));
  props.appendChild(emxEl(doc, "Physical_Name", tableName, { Derived: "Y" }));
  props.appendChild(
    emxEl(doc, "Dependent_Objects_Ref_Array", null, { ReadOnly: "Y", Derived: "Y" })
  );
  props.appendChild(emxEl(doc, "Do_Not_Generate", "false", { Derived: "Y" }));

  const attrOrder = doc.createElementNS(NS.emx, "EMX:Attributes_Order_Ref_Array");
  colIds.forEach((cid, i) => {
    const ref = doc.createElementNS(NS.emx, "EMX:Attributes_Order_Ref");
    ref.setAttribute("index", String(i));
    ref.textContent = cid;
    attrOrder.appendChild(ref);
  });
  props.appendChild(attrOrder);

  const physOrder = doc.createElementNS(NS.emx, "EMX:Physical_Columns_Order_Ref_Array");
  colIds.forEach((cid, i) => {
    const ref = doc.createElementNS(NS.emx, "EMX:Physical_Columns_Order_Ref");
    ref.setAttribute("index", String(i));
    ref.textContent = cid;
    physOrder.appendChild(ref);
  });
  props.appendChild(physOrder);

  entity.appendChild(props);

  // -- Attribute_Groups
  const attrGroups = doc.createElementNS(NS.emx, "EMX:Attribute_Groups");
  cols.forEach((col, i) => {
    const attr = doc.createElementNS(NS.emx, "EMX:Attribute");
    attr.setAttribute("id", colIds[i]);
    attr.setAttribute("name", col.name);

    const ap = doc.createElementNS(NS.emx, "EMX:AttributeProps");
    ap.appendChild(emxEl(doc, "Name", col.name));
    ap.appendChild(emxEl(doc, "Long_Id", colIds[i]));
    ap.appendChild(emxEl(doc, "Physical_Name", col.name, { Derived: "Y" }));
    ap.appendChild(emxEl(doc, "Physical_Data_Type", formatDatatype(col), { Derived: "Y" }));
    ap.appendChild(emxEl(doc, "Nullable", col.nullable ? "true" : "false"));

    const domainId = pickDomain(col, domainMap);
    if (domainId) ap.appendChild(emxEl(doc, "Parent_Domain_Ref", domainId));
    attr.appendChild(ap);
    attrGroups.appendChild(attr);
  });
  entity.appendChild(attrGroups);

  // -- Key groups (PK)
  const pkCols = cols.filter((c) => c.pk);
  if (pkCols.length) {
    const kgGroups = doc.createElementNS(NS.emx, "EMX:Key_Group_Groups");
    const kgId = newGuid();
    const kg = doc.createElementNS(NS.emx, "EMX:Key_Group");
    kg.setAttribute("id", kgId);
    kg.setAttribute("name", `XPK${tableName}`);

    const kgp = doc.createElementNS(NS.emx, "EMX:Key_GroupProps");
    kgp.appendChild(emxEl(doc, "Name", `XPK${tableName}`));
    kgp.appendChild(emxEl(doc, "Long_Id", kgId));
    kgp.appendChild(emxEl(doc, "Key_Group_Type", "1"));

    const kmOrder = doc.createElementNS(NS.emx, "EMX:Key_Group_Members_Order_Ref_Array");
    const kmIds = pkCols.map(() => newGuid());
    pkCols.forEach((_, i) => {
      const ref = doc.createElementNS(NS.emx, "EMX:Key_Group_Members_Order_Ref");
      ref.setAttribute("index", String(i));
      ref.textContent = kmIds[i];
      kmOrder.appendChild(ref);
    });
    kgp.appendChild(kmOrder);
    kg.appendChild(kgp);

    const kmGroups = doc.createElementNS(NS.emx, "EMX:Key_Group_Member_Groups");
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
