// Structured projection of an erwin-dm-v9 document for the merge feature.
// Add Tables only needs entity *names*; merge needs columns + PK too.

import { NS } from "./namespaces";

export interface ModelColumn {
  id: string;                       // erwin GUID
  name: string;                     // logical name
  physicalName: string | null;
  physicalDataType: string | null;
  nullable: string | null;          // 'true' | 'false' | other (verbatim)
  parentDomainRef: string | null;   // domain GUID
  domainName: string | null;        // resolved by id->name map
  isPk: boolean;
}

export interface ModelEntity {
  id: string;
  name: string;
  columns: ModelColumn[];
  pkNames: string[];                // uppercase
}

export interface FullModel {
  entities: ModelEntity[];
  entitiesByUpper: Map<string, ModelEntity>;
  domainIdToName: Map<string, string>;
  domainNameToId: Map<string, string>; // UPPER(name) -> id (for target lookup)
}

const Q_EMX_PREFIX = "EMX:";

function emxText(parent: Element, tag: string): string | null {
  const el = parent.getElementsByTagNameNS(NS.emx, tag)[0];
  return el?.textContent?.trim() || null;
}

function collectDomains(doc: Document): {
  idToName: Map<string, string>;
  nameToId: Map<string, string>;
} {
  const idToName = new Map<string, string>();
  const nameToId = new Map<string, string>();
  const domains = doc.getElementsByTagNameNS(NS.emx, "Domain");
  for (const d of Array.from(domains)) {
    const id = d.getAttribute("id");
    const name = d.getAttribute("name");
    if (!id || !name) continue;
    idToName.set(id, name);
    const upper = name.toUpperCase();
    if (!nameToId.has(upper)) nameToId.set(upper, id);
  }
  return { idToName, nameToId };
}

function collectColumns(
  entityEl: Element,
  domainIdToName: Map<string, string>
): { columns: ModelColumn[]; byId: Map<string, ModelColumn> } {
  const columns: ModelColumn[] = [];
  const byId = new Map<string, ModelColumn>();

  // Look only at the entity's own Attribute_Groups child, not nested.
  const ag = Array.from(entityEl.children).find(
    (c) => c.namespaceURI === NS.emx && c.localName === "Attribute_Groups"
  );
  if (!ag) return { columns, byId };

  for (const attrEl of Array.from(ag.children)) {
    if (attrEl.namespaceURI !== NS.emx || attrEl.localName !== "Attribute") continue;
    const id = attrEl.getAttribute("id");
    const name = attrEl.getAttribute("name");
    if (!id || !name) continue;

    // Properties live under <EMX:AttributeProps> or <EMX:Attribute_Properties>
    // depending on the exporter. Prefer the canonical AttributeProps, fall
    // back to the underscored variant.
    let props: Element | null = attrEl.getElementsByTagNameNS(NS.emx, "AttributeProps")[0] ?? null;
    if (!props) {
      props = attrEl.getElementsByTagNameNS(NS.emx, "Attribute_Properties")[0] ?? null;
    }
    const physicalName = props ? emxText(props, "Physical_Name") : null;
    const physicalDataType = props ? emxText(props, "Physical_Data_Type") : null;
    const nullable = props ? (emxText(props, "Nullable") ?? emxText(props, "Null_Option_Type")) : null;
    const parentDomainRef = props ? emxText(props, "Parent_Domain_Ref") : null;
    const domainName = parentDomainRef ? domainIdToName.get(parentDomainRef) ?? null : null;

    const col: ModelColumn = {
      id, name, physicalName, physicalDataType, nullable,
      parentDomainRef, domainName, isPk: false,
    };
    columns.push(col);
    byId.set(id, col);
  }

  return { columns, byId };
}

function collectPkNames(
  entityEl: Element,
  colsById: Map<string, ModelColumn>
): string[] {
  // Find the Key_Group with Key_Group_Type = '1' (primary key).
  const kgGroups = entityEl.getElementsByTagNameNS(NS.emx, "Key_Group_Groups")[0];
  if (!kgGroups) return [];
  for (const kg of Array.from(kgGroups.children)) {
    if (kg.namespaceURI !== NS.emx || kg.localName !== "Key_Group") continue;
    const props = kg.getElementsByTagNameNS(NS.emx, "Key_GroupProps")[0]
      ?? kg.getElementsByTagNameNS(NS.emx, "Key_Group_Properties")[0];
    const kind = props ? emxText(props, "Key_Group_Type") : null;
    if (kind !== "1") continue;

    // Find member elements under this key group, then read their Attribute_Ref.
    const members = kg.getElementsByTagNameNS(NS.emx, "Key_Group_Member");
    const names: string[] = [];
    for (const m of Array.from(members)) {
      const mp = m.getElementsByTagNameNS(NS.emx, "Key_Group_MemberProps")[0]
        ?? m.getElementsByTagNameNS(NS.emx, "Key_Group_Member_Properties")[0];
      if (!mp) continue;
      const attrRef = emxText(mp, "Attribute_Ref") ?? emxText(mp, "Member_Attribute_Ref");
      if (!attrRef) continue;
      const col = colsById.get(attrRef);
      if (col) names.push(col.name.toUpperCase());
    }
    return names;
  }
  return [];
}

export function collectFullModel(doc: Document): FullModel {
  const { idToName, nameToId } = collectDomains(doc);
  const entityEls = doc.getElementsByTagNameNS(NS.emx, "Entity");
  const entities: ModelEntity[] = [];
  const entitiesByUpper = new Map<string, ModelEntity>();

  for (const ent of Array.from(entityEls)) {
    const id = ent.getAttribute("id") ?? "";
    const name = ent.getAttribute("name") ?? "";
    if (!id || !name) continue;
    const { columns, byId } = collectColumns(ent, idToName);
    const pkNames = collectPkNames(ent, byId);
    const pkSet = new Set(pkNames);
    for (const col of columns) {
      if (pkSet.has(col.name.toUpperCase())) col.isPk = true;
    }
    const entity: ModelEntity = { id, name, columns, pkNames };
    entities.push(entity);
    entitiesByUpper.set(name.toUpperCase(), entity);
  }

  return { entities, entitiesByUpper, domainIdToName: idToName, domainNameToId: nameToId };
}

// Suppress unused import warning under strict compiler — used internally.
void Q_EMX_PREFIX;
