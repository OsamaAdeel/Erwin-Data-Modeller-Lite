// Extract Relationship elements from an erwin-dm-v9 XML document.
//
// erwin DM stores relationships at the model root level as
// <EMX:Relationship> nodes whose props point at parent and child entities
// via Parent_Entity_Ref / Child_Entity_Ref (GUIDs).
//
// We surface a flat array { sourceEntityId, targetEntityId, name } that
// the ERD layout uses as edges.

import { NS } from "./namespaces";

export interface Relationship {
  id: string;
  name: string | null;
  parentEntityId: string;       // GUID of the "1" side (parent)
  childEntityId: string;        // GUID of the "many" side (child)
  cardinality: string | null;   // verbatim Cardinality_Type if present
}

function emxText(parent: Element, tag: string): string | null {
  const el = parent.getElementsByTagNameNS(NS.emx, tag)[0];
  return el?.textContent?.trim() || null;
}

export function collectRelationships(doc: Document): Relationship[] {
  const out: Relationship[] = [];
  const rels = doc.getElementsByTagNameNS(NS.emx, "Relationship");
  for (const r of Array.from(rels)) {
    const id = r.getAttribute("id");
    if (!id) continue;

    // Properties may live under <EMX:RelationshipProps> (canonical) or
    // <EMX:Relationship_Properties> (some exporters).
    const props =
      r.getElementsByTagNameNS(NS.emx, "RelationshipProps")[0] ??
      r.getElementsByTagNameNS(NS.emx, "Relationship_Properties")[0] ??
      null;
    if (!props) continue;

    const parentRef = emxText(props, "Parent_Entity_Ref");
    const childRef = emxText(props, "Child_Entity_Ref");
    if (!parentRef || !childRef) continue;

    out.push({
      id,
      name: r.getAttribute("name") || emxText(props, "Name") || null,
      parentEntityId: parentRef,
      childEntityId: childRef,
      cardinality: emxText(props, "Cardinality_Type"),
    });
  }
  return out;
}
