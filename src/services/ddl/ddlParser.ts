// Tiny pragmatic Oracle DDL parser. Handles the subset we care about:
//
//   CREATE TABLE [schema.]TABLE_NAME (
//     COL_1   TYPE[(size[,scale])]   [NOT NULL] [PRIMARY KEY],
//     COL_2   TYPE,
//     ...
//     PRIMARY KEY (COL_1, COL_2)
//   )
//
// Anything we can't recognise (CONSTRAINT, FOREIGN KEY, INDEX, CHECK,
// trailing storage clauses, etc.) becomes a warning, not a hard fail —
// users paste real DDL with all sorts of cruft.
//
// Not a full SQL parser; not trying to be. The output is always
// best-effort plus a list of skipped lines so the user can decide
// what's missing.

import type { DataType, NewColumnSpec } from "@/services/xml/types";

export interface ParsedDdl {
  /** Table name if a CREATE TABLE header was present. */
  tableName?: string;
  columns: NewColumnSpec[];
  /** One entry per line we couldn't fold into a column. */
  warnings: string[];
}

export function parseOracleDdl(input: string): ParsedDdl {
  const warnings: string[] = [];
  let tableName: string | undefined;
  let body = input.trim();

  // Strip a leading "CREATE TABLE [schema.]NAME (" if present.
  const createMatch = body.match(
    /CREATE\s+(?:GLOBAL\s+TEMPORARY\s+)?TABLE\s+(?:[A-Za-z_][\w$#]*\s*\.\s*)?([A-Za-z_][\w$#]*)\s*\(/i
  );
  if (createMatch && createMatch.index != null) {
    tableName = createMatch[1];
    body = body.slice(createMatch.index + createMatch[0].length);
    // Trim trailing ");" plus any storage clauses after it.
    const lastClose = body.lastIndexOf(")");
    if (lastClose >= 0) body = body.slice(0, lastClose);
  }

  const columns: NewColumnSpec[] = [];
  const pkCols = new Set<string>();

  for (const raw of splitTopLevel(body, ",")) {
    const line = raw.trim();
    if (!line) continue;

    // Table-level PRIMARY KEY (a, b)
    const tablePkMatch = line.match(/^PRIMARY\s+KEY\s*\(\s*([^)]+)\s*\)$/i);
    if (tablePkMatch) {
      for (const c of tablePkMatch[1].split(",")) {
        pkCols.add(c.trim().replace(/^"|"$/g, "").toUpperCase());
      }
      continue;
    }

    // Skip table-level constraints / indexes / checks etc.
    if (/^(CONSTRAINT|FOREIGN\s+KEY|UNIQUE|CHECK|INDEX|USING|PARTITION)\b/i.test(line)) {
      warnings.push(`Skipped: ${truncate(line, 80)}`);
      continue;
    }

    const colMatch = line.match(
      /^"?([A-Za-z_][\w$#]*)"?\s+([A-Za-z_][\w$#]*\d?)(?:\s*\(\s*(\d+)(?:\s*,\s*(-?\d+))?\s*\))?(.*)$/i
    );
    if (!colMatch) {
      warnings.push(`Couldn't parse: ${truncate(line, 80)}`);
      continue;
    }

    const [, name, rawType, size = "", scale = "", rest = ""] = colMatch;
    const type = mapDataType(rawType);
    if (!type) {
      warnings.push(`Unknown type "${rawType}" for column ${name}`);
      continue;
    }

    const restUpper = rest.toUpperCase();
    const explicitNotNull = /\bNOT\s+NULL\b/.test(restUpper);
    const inlinePk = /\bPRIMARY\s+KEY\b/.test(restUpper);

    columns.push({
      id: crypto.randomUUID(),
      name,
      type,
      size,
      scale,
      nullable: !explicitNotNull && !inlinePk,
      pk: inlinePk,
    });
  }

  // Apply table-level PRIMARY KEY (...) to the matching columns.
  for (const col of columns) {
    if (pkCols.has(col.name.toUpperCase())) {
      col.pk = true;
      col.nullable = false;
    }
  }

  return { tableName, columns, warnings };
}

/** Split on `sep` at parenthesis-depth 0 (so NUMBER(10,2) survives). */
function splitTopLevel(input: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of input) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === sep && depth === 0) {
      out.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf);
  return out;
}

function mapDataType(raw: string): DataType | null {
  const u = raw.toUpperCase();
  if (u === "VARCHAR2" || u === "VARCHAR" || u === "NVARCHAR2" || u === "NVARCHAR") return "VARCHAR2";
  if (u === "CHAR" || u === "NCHAR") return "CHAR";
  if (
    u === "NUMBER" ||
    u === "INTEGER" ||
    u === "INT" ||
    u === "SMALLINT" ||
    u === "DECIMAL" ||
    u === "NUMERIC"
  ) {
    return "NUMBER";
  }
  if (u === "DATE") return "DATE";
  if (u === "TIMESTAMP" || u === "DATETIME") return "TIMESTAMP";
  if (u === "CLOB" || u === "NCLOB" || u === "TEXT" || u === "LONG") return "CLOB";
  if (u === "BLOB" || u === "RAW" || u === "LONGRAW") return "BLOB";
  return null;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
