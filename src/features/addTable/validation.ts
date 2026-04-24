import {
  MAX_COLUMNS_PER_TABLE,
  validateColumnSize,
  validateIdentifier,
} from "@/services/ddl/oracleParser";
import type { NewColumnSpec } from "@/services/xml/types";
import type { StagedTable } from "./addTableSlice";

export interface ColumnError {
  colId: string;
  message: string;
  isNameError: boolean;
}

export interface ValidationResult {
  errors: string[];                    // tag codes ('table-name-empty', 'col-empty', …)
  warnings: string[];
  tableNameError?: string;             // user-facing error string
  columnErrors: ColumnError[];
  canSubmit: boolean;                  // form can be committed to the staged list
  tableNameValid: boolean;
}

export interface ValidationInput {
  tableName: string;
  columns: NewColumnSpec[];
  entityDict: Map<string, string>;
  stagedTables: StagedTable[];
  editingId: string | null;
  isFinalized: boolean;
}

export const WARNING_MESSAGES: Record<string, string> = {
  "no-pk": "No primary key selected — allowed, but not recommended",
  "bare-number": "NUMBER column has no precision — best practice is to specify NUMBER(p[,s])",
  "at-limit": `Reached Oracle's maximum of ${MAX_COLUMNS_PER_TABLE} columns per table`,
};

export function validate(input: ValidationInput): ValidationResult {
  const {
    tableName,
    columns,
    entityDict,
    stagedTables,
    editingId,
    isFinalized,
  } = input;

  const errs: string[] = [];
  const warns: string[] = [];
  const colErrs: ColumnError[] = [];
  let tableNameError: string | undefined;
  let tableNameValid = false;

  // Once finalized, the form is read-only.
  if (isFinalized) errs.push("finalized");

  const stagedNames = new Set(
    stagedTables
      .filter((t) => t.id !== editingId)
      .map((t) => t.table_name.toUpperCase())
  );

  const tn = tableName.trim();
  if (!tn) {
    errs.push("table-name-empty");
  } else if (entityDict?.has(tn.toUpperCase())) {
    errs.push("table-name-dup");
    tableNameError = `Table "${tn}" already exists in the model.`;
  } else if (stagedNames.has(tn.toUpperCase())) {
    errs.push("table-name-dup-staged");
    tableNameError = `Table "${tn}" is already queued in this session.`;
  } else {
    const idCheck = validateIdentifier(tn, "table name");
    if (!idCheck.ok) {
      errs.push("table-name-invalid");
      tableNameError = idCheck.error;
    } else {
      tableNameValid = true;
    }
  }

  if (!columns.length) errs.push("no-columns");
  if (columns.length > MAX_COLUMNS_PER_TABLE) errs.push("too-many-columns");

  const seen = new Map<string, string>();
  let hasPK = false;
  let bareNumber = false;

  for (const col of columns) {
    const colMessages: Array<{ msg: string; isNameError: boolean }> = [];
    const trimmed = col.name.trim();

    if (!trimmed) {
      colMessages.push({ msg: "name required", isNameError: true });
      errs.push("col-empty");
    } else {
      const idCheck = validateIdentifier(trimmed, "column name");
      if (!idCheck.ok) {
        colMessages.push({ msg: idCheck.error!, isNameError: true });
        errs.push("col-invalid");
      } else {
        const key = trimmed.toUpperCase();
        if (seen.has(key)) {
          colMessages.push({ msg: `duplicate column name "${trimmed}"`, isNameError: true });
          errs.push("col-dup");
        } else {
          seen.set(key, col.id);
        }
      }
    }

    const sizeErr = validateColumnSize(col);
    if (sizeErr) {
      colMessages.push({ msg: sizeErr, isNameError: false });
      errs.push("col-size");
    }

    if (col.type === "NUMBER" && !col.size) bareNumber = true;
    if (col.pk) hasPK = true;

    if (colMessages.length) {
      colErrs.push({
        colId: col.id,
        message: colMessages[0].msg,
        isNameError: colMessages[0].isNameError,
      });
    }
  }

  if (tableNameValid) {
    if (columns.length && !hasPK) warns.push("no-pk");
    if (bareNumber) warns.push("bare-number");
    if (columns.length >= MAX_COLUMNS_PER_TABLE) warns.push("at-limit");
  }

  return {
    errors: errs,
    warnings: warns,
    tableNameError,
    columnErrors: colErrs,
    tableNameValid,
    canSubmit: errs.length === 0,
  };
}
