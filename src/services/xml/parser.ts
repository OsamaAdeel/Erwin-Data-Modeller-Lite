import { NS } from "./namespaces";
import type { ParsedDoc, Variant } from "./types";

export class XmlParseError extends Error {}

export async function parseFile(file: File): Promise<ParsedDoc> {
  const text = await file.text();
  return parseText(text, file.name);
}

export function parseText(text: string, fileName: string): ParsedDoc {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const errEl = doc.querySelector("parsererror");
  if (errEl) {
    throw new XmlParseError((errEl.textContent ?? "Could not parse XML").slice(0, 300));
  }
  const variant = detectVariant(doc.documentElement);
  return {
    fileName,
    doc,
    variant,
    entityDict: collectEntityNames(doc, variant),
    domainMap: variant === "erwin-dm-v9" ? collectDomainMap(doc) : new Map(),
  };
}

export function detectVariant(root: Element): Variant {
  const tag = root.tagName;
  const fmt = root.getAttribute("Format") ?? "";
  const ns = root.namespaceURI ?? "";
  if (tag === "erwin" && fmt === "erwin_Repository" && ns === NS.dm) return "erwin-dm-v9";
  const classicEntities = Array.from(root.getElementsByTagName("Entity"))
    .filter((e) => e.namespaceURI !== NS.emx);
  if (classicEntities.length > 0) return "erwin-classic";
  return "unknown";
}

export function collectEntityNames(doc: Document, variant: Variant): Map<string, string> {
  const dict = new Map<string, string>();
  if (variant === "erwin-dm-v9") {
    const entities = doc.getElementsByTagNameNS(NS.emx, "Entity");
    for (const e of Array.from(entities)) {
      const nameAttr = e.getAttribute("name") ?? "";
      let physical = nameAttr;
      const props = e.getElementsByTagNameNS(NS.emx, "EntityProps")[0];
      if (props) {
        const pn = props.getElementsByTagNameNS(NS.emx, "Physical_Name")[0];
        const txt = pn?.textContent?.trim();
        if (txt) physical = txt;
      }
      if (physical) dict.set(physical.toUpperCase(), physical);
      if (nameAttr && !dict.has(nameAttr.toUpperCase())) {
        dict.set(nameAttr.toUpperCase(), nameAttr);
      }
    }
  } else if (variant === "erwin-classic") {
    const entities = Array.from(doc.getElementsByTagName("Entity"))
      .filter((e) => e.namespaceURI !== NS.emx);
    for (const e of entities) {
      const n =
        e.getAttribute("Name") ??
        e.getAttribute("name") ??
        e.getAttribute("Physical_Name") ??
        "";
      if (n) dict.set(n.toUpperCase(), n);
    }
  }
  return dict;
}

export function collectDomainMap(doc: Document): Map<string, string> {
  const map = new Map<string, string>();
  const domains = doc.getElementsByTagNameNS(NS.emx, "Domain");
  for (const d of Array.from(domains)) {
    const name = d.getAttribute("name");
    const id = d.getAttribute("id");
    if (name && id) map.set(name, id);
  }
  return map;
}
