// OFSAA ERwin importer is sensitive to the XML declaration — it must include
// standalone="no" and UTF-8. Strip whatever DOMSerializer emitted (browsers
// vary) and prepend the canonical declaration.
const OFSAA_PROLOG = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>';

export function serializeDoc(doc: XMLDocument): string {
  let xml = new XMLSerializer().serializeToString(doc);
  xml = xml.replace(/^<\?xml[^?]*\?>\s*/, "");
  return `${OFSAA_PROLOG}\n${xml}`;
}

// Match a `_v<digits>` (case-insensitive) immediately before the extension.
const VERSION_SUFFIX = /^(.*)(_[vV])(\d+)$/;

/**
 * Roll the filename forward to the next version.
 *   model.xml             → model_v1.xml
 *   model_v1.xml          → model_v2.xml
 *   model_v9.xml          → model_v10.xml
 *   customer_data_v10.xml → customer_data_v11.xml
 *   model_V2.xml          → model_V3.xml      (preserves marker case)
 *   model                 → model_v1.xml      (no extension → append .xml)
 *   model_v2_v3.xml       → model_v2_v4.xml   (last _v wins)
 *   "customer data.xml"   → "customer data_v1.xml" (spaces preserved)
 */
export function generateNextFileName(fileName: string): string {
  const trimmed = (fileName ?? "").trim();
  if (!trimmed) return "untitled_v1.xml";

  // Split off the trailing extension if there is one. Leading-dot names
  // (".xml") and trailing-dot names ("foo.") are treated as extension-less.
  const lastDot = trimmed.lastIndexOf(".");
  const hasExt = lastDot > 0 && lastDot < trimmed.length - 1;
  const base = hasExt ? trimmed.slice(0, lastDot) : trimmed;

  // System only emits XML; force .xml regardless of the input extension.
  const match = base.match(VERSION_SUFFIX);
  if (match) {
    const [, prefix, vMarker, numStr] = match;
    const next = parseInt(numStr, 10) + 1;
    return `${prefix}${vMarker}${next}.xml`;
  }
  return `${base}_v1.xml`;
}
