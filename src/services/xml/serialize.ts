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
 * Output filename pattern.
 *   "v"         → model_v1.xml, model_v2.xml, model_v10.xml
 *   "v-padded"  → model_v01.xml, model_v02.xml, model_v10.xml (zero-padded
 *                 to width 2; the width grows naturally beyond 99)
 *   "timestamp" → model_2026-05-05.xml (ISO-ish date suffix; replaces any
 *                 prior timestamp)
 */
export type FilenamePattern = "v" | "v-padded" | "timestamp";

/**
 * Roll the filename forward to the next version. Default pattern matches
 * the prior behaviour exactly so existing callers and tests don't shift.
 *
 *   model.xml             → model_v1.xml
 *   model_v1.xml          → model_v2.xml
 *   model_v9.xml          → model_v10.xml
 *   customer_data_v10.xml → customer_data_v11.xml
 *   model_V2.xml          → model_V3.xml      (preserves marker case)
 *   model                 → model_v1.xml      (no extension → append .xml)
 *   model_v2_v3.xml       → model_v2_v4.xml   (last _v wins)
 *   "customer data.xml"   → "customer data_v1.xml" (spaces preserved)
 */
export function generateNextFileName(
  fileName: string,
  pattern: FilenamePattern = "v"
): string {
  const trimmed = (fileName ?? "").trim();
  if (!trimmed) {
    if (pattern === "timestamp") return `untitled_${todayStamp()}.xml`;
    return pattern === "v-padded" ? "untitled_v01.xml" : "untitled_v1.xml";
  }

  // Split off the trailing extension if there is one. Leading-dot names
  // (".xml") and trailing-dot names ("foo.") are treated as extension-less.
  const lastDot = trimmed.lastIndexOf(".");
  const hasExt = lastDot > 0 && lastDot < trimmed.length - 1;
  const base = hasExt ? trimmed.slice(0, lastDot) : trimmed;

  if (pattern === "timestamp") {
    // Strip any prior `_<YYYY-MM-DD>` or `_v<digits>` suffix so consecutive
    // generates don't accumulate stamps.
    const stripped = base
      .replace(/_\d{4}-\d{2}-\d{2}$/, "")
      .replace(/(_[vV])\d+$/, "");
    return `${stripped}_${todayStamp()}.xml`;
  }

  // System only emits XML; force .xml regardless of the input extension.
  const match = base.match(VERSION_SUFFIX);
  if (match) {
    const [, prefix, vMarker, numStr] = match;
    const next = parseInt(numStr, 10) + 1;
    const formatted = pattern === "v-padded"
      ? formatPadded(next, Math.max(2, numStr.length))
      : String(next);
    return `${prefix}${vMarker}${formatted}.xml`;
  }
  const initial = pattern === "v-padded" ? "01" : "1";
  return `${base}_v${initial}.xml`;
}

function formatPadded(n: number, width: number): string {
  const s = String(n);
  return s.length >= width ? s : "0".repeat(width - s.length) + s;
}

function todayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
