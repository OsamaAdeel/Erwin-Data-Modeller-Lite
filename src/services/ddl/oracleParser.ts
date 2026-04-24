import type { NewColumnSpec } from "@/services/xml/types";

// Strictly reserved (V$RESERVED_WORDS reserved=Y). These cannot be used as
// identifiers without double-quoting, which the spec deliberately avoids.
export const ORACLE_RESERVED_WORDS = new Set<string>([
  "ACCESS","ADD","ALL","ALTER","AND","ANY","AS","ASC","AUDIT","BETWEEN","BY",
  "CHAR","CHECK","CLUSTER","COLUMN","COLUMN_VALUE","COMMENT","COMPRESS",
  "CONNECT","CREATE","CURRENT","DATE","DECIMAL","DEFAULT","DELETE","DESC",
  "DISTINCT","DROP","ELSE","EXCLUSIVE","EXISTS","FILE","FLOAT","FOR","FROM",
  "GRANT","GROUP","HAVING","IDENTIFIED","IMMEDIATE","IN","INCREMENT","INDEX",
  "INITIAL","INSERT","INTEGER","INTERSECT","INTO","IS","LEVEL","LIKE","LOCK",
  "LONG","MAXEXTENTS","MINUS","MLSLABEL","MODE","MODIFY","NESTED_TABLE_ID",
  "NOAUDIT","NOCOMPRESS","NOT","NOWAIT","NULL","NUMBER","OF","OFFLINE","ON",
  "ONLINE","OPTION","OR","ORDER","PCTFREE","PRIOR","PUBLIC","RAW","RENAME",
  "RESOURCE","REVOKE","ROW","ROWID","ROWNUM","ROWS","SELECT","SESSION","SET",
  "SHARE","SIZE","SMALLINT","START","SUCCESSFUL","SYNONYM","SYSDATE","TABLE",
  "THEN","TO","TRIGGER","UID","UNION","UNIQUE","UPDATE","USER","VALIDATE",
  "VALUES","VARCHAR","VARCHAR2","VIEW","WHENEVER","WHERE","WITH",
]);

export const MAX_IDENTIFIER_LEN = 128;     // Oracle 12.2+
export const MAX_COLUMNS_PER_TABLE = 1000; // Oracle hard limit

export interface TypeLimits {
  needsLen?: boolean;
  maxLen?: number;
  maxPrec?: number;
  minScale?: number;
  maxScale?: number;
}

export const TYPE_LIMITS: Record<string, TypeLimits> = {
  VARCHAR2:  { needsLen: true, maxLen: 4000 },
  CHAR:      { needsLen: true, maxLen: 2000 },
  NUMBER:    { needsLen: false, maxPrec: 38, minScale: -84, maxScale: 127 },
  DATE:      {},
  TIMESTAMP: {},
  CLOB:      {},
  BLOB:      {},
};

export const DATA_TYPES = [
  "VARCHAR2", "NUMBER", "DATE", "TIMESTAMP", "CHAR", "CLOB", "BLOB",
] as const;

export interface IdentifierResult {
  ok: boolean;
  error?: string;
}

export function validateIdentifier(name: string, kind = "name"): IdentifierResult {
  if (!name) return { ok: false, error: `${kind} cannot be empty` };
  const byteLen = new TextEncoder().encode(name).length;
  if (byteLen > MAX_IDENTIFIER_LEN) {
    return { ok: false, error: `${kind} exceeds ${MAX_IDENTIFIER_LEN}-byte limit (got ${byteLen})` };
  }
  if (!/^[A-Za-z]/.test(name)) {
    return { ok: false, error: `${kind} must start with a letter` };
  }
  if (!/^[A-Za-z][A-Za-z0-9_$#]*$/.test(name)) {
    return { ok: false, error: `${kind} may only contain letters, digits, _ $ #` };
  }
  if (ORACLE_RESERVED_WORDS.has(name.toUpperCase())) {
    return { ok: false, error: `"${name}" is an Oracle reserved word` };
  }
  return { ok: true };
}

export function validateColumnSize(col: NewColumnSpec): string | null {
  const limits = TYPE_LIMITS[col.type] ?? {};
  if (limits.needsLen) {
    const n = parseInt(col.size, 10);
    if (!col.size || isNaN(n)) return `${col.type} requires a length`;
    if (n < 1) return `${col.type} length must be ≥ 1`;
    if (limits.maxLen != null && n > limits.maxLen) return `${col.type} length must be ≤ ${limits.maxLen}`;
  }
  if (col.type === "NUMBER") {
    if (col.size) {
      const p = parseInt(col.size, 10);
      if (isNaN(p) || p < 1 || (limits.maxPrec != null && p > limits.maxPrec)) {
        return `NUMBER precision must be 1–${limits.maxPrec}`;
      }
    }
    if (col.scale !== "" && col.scale != null) {
      const s = parseInt(col.scale, 10);
      if (
        isNaN(s) ||
        (limits.minScale != null && s < limits.minScale) ||
        (limits.maxScale != null && s > limits.maxScale)
      ) {
        return `NUMBER scale must be ${limits.minScale} to ${limits.maxScale}`;
      }
    }
  }
  return null;
}
