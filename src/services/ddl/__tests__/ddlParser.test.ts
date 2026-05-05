import { describe, it, expect } from "vitest";
import {
  parseOracleDdl,
  parseOracleDdlMulti,
  splitDdlStatements,
} from "@/services/ddl/ddlParser";

describe("parseOracleDdl — bare-identifier baseline", () => {
  it("parses a simple unquoted CREATE TABLE", () => {
    const ddl = `
      CREATE TABLE CUSTOMER (
        ID NUMBER NOT NULL PRIMARY KEY,
        NAME VARCHAR2(100) NOT NULL,
        CREATED_AT DATE
      );
    `;
    const r = parseOracleDdl(ddl);
    expect(r.tableName).toBe("CUSTOMER");
    expect(r.warnings).toEqual([]);
    expect(r.columns.map((c) => c.name)).toEqual(["ID", "NAME", "CREATED_AT"]);
    const id = r.columns.find((c) => c.name === "ID")!;
    expect(id.type).toBe("NUMBER");
    expect(id.pk).toBe(true);
    expect(id.nullable).toBe(false);
    const name = r.columns.find((c) => c.name === "NAME")!;
    expect(name.type).toBe("VARCHAR2");
    expect(name.size).toBe("100");
    expect(name.nullable).toBe(false);
  });

  it("applies a table-level PRIMARY KEY across multiple columns", () => {
    const ddl = `
      CREATE TABLE ORDER_LINE (
        ORDER_ID NUMBER,
        LINE_ID NUMBER,
        QTY NUMBER,
        PRIMARY KEY (ORDER_ID, LINE_ID)
      );
    `;
    const r = parseOracleDdl(ddl);
    expect(r.columns.find((c) => c.name === "ORDER_ID")?.pk).toBe(true);
    expect(r.columns.find((c) => c.name === "LINE_ID")?.pk).toBe(true);
    expect(r.columns.find((c) => c.name === "QTY")?.pk).toBe(false);
  });
});

describe("parseOracleDdl — Oracle export quirks", () => {
  it("handles a quoted table name", () => {
    const ddl = `
      CREATE TABLE "FCT_CUSTOMER" (
        "CUSTOMER_ID" NUMBER NOT NULL ENABLE
      );
    `;
    const r = parseOracleDdl(ddl);
    expect(r.tableName).toBe("FCT_CUSTOMER");
    expect(r.columns).toHaveLength(1);
    expect(r.columns[0].name).toBe("CUSTOMER_ID");
  });

  it("handles a quoted schema-qualified table name", () => {
    const ddl = `
      CREATE TABLE "FSDF"."FCT_CUSTOMER" (
        "ID" NUMBER NOT NULL ENABLE
      );
    `;
    const r = parseOracleDdl(ddl);
    expect(r.tableName).toBe("FCT_CUSTOMER");
  });

  it("treats DEFAULT NULL as the default, not a NOT NULL constraint", () => {
    const ddl = `
      CREATE TABLE "T" (
        "C" NUMBER(22,3) DEFAULT NULL
      );
    `;
    const r = parseOracleDdl(ddl);
    expect(r.columns[0].nullable).toBe(true);
  });

  it("recognises NOT NULL ENABLE as a non-null constraint", () => {
    const ddl = `
      CREATE TABLE "T" (
        "C" NUMBER(10,0) DEFAULT NULL NOT NULL ENABLE
      );
    `;
    const r = parseOracleDdl(ddl);
    expect(r.columns[0].nullable).toBe(false);
  });

  it("parses VARCHAR2(N CHAR) and VARCHAR2(N BYTE)", () => {
    const ddl = `
      CREATE TABLE "T" (
        "A" VARCHAR2(3 CHAR) DEFAULT NULL,
        "B" VARCHAR2(120 BYTE) DEFAULT NULL,
        "C" VARCHAR2(50) DEFAULT NULL
      );
    `;
    const r = parseOracleDdl(ddl);
    expect(r.columns.map((c) => [c.name, c.type, c.size])).toEqual([
      ["A", "VARCHAR2", "3"],
      ["B", "VARCHAR2", "120"],
      ["C", "VARCHAR2", "50"],
    ]);
  });

  it("picks up PK columns from a named CONSTRAINT clause", () => {
    const ddl = `
      CREATE TABLE "T" (
        "A" NUMBER NOT NULL ENABLE,
        "B" NUMBER NOT NULL ENABLE,
        "C" VARCHAR2(10) DEFAULT NULL,
        CONSTRAINT "PK_T" PRIMARY KEY ("A", "B") USING INDEX ENABLE
      );
    `;
    const r = parseOracleDdl(ddl);
    expect(r.columns.find((c) => c.name === "A")?.pk).toBe(true);
    expect(r.columns.find((c) => c.name === "B")?.pk).toBe(true);
    expect(r.columns.find((c) => c.name === "C")?.pk).toBe(false);
  });
});

describe("splitDdlStatements", () => {
  it("returns one entry for a single statement", () => {
    expect(splitDdlStatements("CREATE TABLE FOO (A NUMBER);"))
      .toEqual(["CREATE TABLE FOO (A NUMBER)"]);
  });

  it("splits two statements on a top-level semicolon", () => {
    const ddl = `CREATE TABLE A (X NUMBER); CREATE TABLE B (Y NUMBER);`;
    expect(splitDdlStatements(ddl)).toEqual([
      "CREATE TABLE A (X NUMBER)",
      "CREATE TABLE B (Y NUMBER)",
    ]);
  });

  it("ignores semicolons inside parens (defensive)", () => {
    // Oracle would reject this DDL, but a paren-aware splitter shouldn't
    // be fooled by the stray inner `;`.
    const ddl = `CREATE TABLE A (X VARCHAR2(50; 1)); CREATE TABLE B (Y NUMBER);`;
    expect(splitDdlStatements(ddl)).toHaveLength(2);
  });

  it("handles a missing trailing semicolon", () => {
    const ddl = `CREATE TABLE A (X NUMBER)`;
    expect(splitDdlStatements(ddl)).toEqual([ddl]);
  });

  it("drops empty / whitespace-only segments", () => {
    expect(splitDdlStatements(";; ;\n;")).toEqual([]);
  });
});

describe("parseOracleDdlMulti", () => {
  it("parses two CREATE TABLE statements separately", () => {
    const ddl = `
      CREATE TABLE CUSTOMER_MASTER (
        CUSTOMER_ID NUMBER PRIMARY KEY,
        NAME VARCHAR2(100)
      );
      CREATE TABLE ACCOUNT_MASTER (
        ACCOUNT_ID NUMBER PRIMARY KEY,
        CUSTOMER_ID NUMBER,
        BALANCE NUMBER
      );
    `;
    const r = parseOracleDdlMulti(ddl);
    expect(r.parseErrors).toEqual([]);
    expect(r.tables).toHaveLength(2);
    expect(r.tables.map((t) => t.tableName)).toEqual([
      "CUSTOMER_MASTER",
      "ACCOUNT_MASTER",
    ]);
    expect(r.tables[0].columns.find((c) => c.name === "CUSTOMER_ID")?.pk).toBe(true);
    expect(r.tables[1].columns.find((c) => c.name === "ACCOUNT_ID")?.pk).toBe(true);
  });

  it("reports non-CREATE-TABLE statements as parse errors", () => {
    const ddl = `
      CREATE TABLE A (X NUMBER);
      CREATE INDEX IDX_A ON A (X);
      CREATE TABLE B (Y NUMBER);
    `;
    const r = parseOracleDdlMulti(ddl);
    expect(r.tables.map((t) => t.tableName)).toEqual(["A", "B"]);
    expect(r.parseErrors).toHaveLength(1);
    expect(r.parseErrors[0].message).toMatch(/Not a CREATE TABLE/);
  });

  it("reports CREATE TABLE statements that yield no columns", () => {
    // The body has only a CONSTRAINT — no columns to extract.
    const ddl = `
      CREATE TABLE A (
        CONSTRAINT FK FOREIGN KEY (X) REFERENCES B(X)
      );
      CREATE TABLE B (Y NUMBER);
    `;
    const r = parseOracleDdlMulti(ddl);
    expect(r.tables.map((t) => t.tableName)).toEqual(["B"]);
    expect(r.parseErrors).toHaveLength(1);
  });

  it("returns empty result for empty input", () => {
    const r = parseOracleDdlMulti("   \n\t  ");
    expect(r.tables).toEqual([]);
    expect(r.parseErrors).toEqual([]);
  });
});

describe("parseOracleDdl — full real-world Oracle export", () => {
  // Reproduction of the user-reported failure: an OFSAA-style export with
  // quoted identifiers, DEFAULT NULL, NOT NULL ENABLE, VARCHAR2(N CHAR),
  // and a named CONSTRAINT-style composite PK.
  it("parses FCT_OPS_RISK_DATA cleanly", () => {
    const ddl = `CREATE TABLE "FCT_OPS_RISK_DATA"
(  "D_FINANCIAL_YEAR" DATE DEFAULT NULL NOT NULL ENABLE,
   "N_RUN_SKEY" NUMBER(10,0) DEFAULT NULL NOT NULL ENABLE,
   "N_MIS_DATE_SKEY" NUMBER(10,0) DEFAULT NULL NOT NULL ENABLE,
   "N_ENTITY_SKEY" NUMBER(10,0) DEFAULT NULL NOT NULL ENABLE,
   "N_LOB_SKEY" NUMBER(10,0) DEFAULT NULL NOT NULL ENABLE,
   "N_GAAP_SKEY" NUMBER(10,0) DEFAULT NULL NOT NULL ENABLE,
   "N_ANNUAL_GROSS_INCOME" NUMBER(22,3) DEFAULT NULL,
   "V_CCY_CODE" VARCHAR2(3 CHAR) DEFAULT NULL,
   "N_DATA_SOURCE_CD" NUMBER(10,0) DEFAULT NULL,
   CONSTRAINT "PK_1881" PRIMARY KEY ("D_FINANCIAL_YEAR", "N_RUN_SKEY", "N_MIS_DATE_SKEY", "N_ENTITY_SKEY", "N_LOB_SKEY", "N_GAAP_SKEY") USING INDEX ENABLE
);`;
    const r = parseOracleDdl(ddl);
    expect(r.tableName).toBe("FCT_OPS_RISK_DATA");
    expect(r.warnings).toEqual([]);

    // All 9 columns parsed (6 PK members + 3 trailing).
    expect(r.columns.map((c) => c.name)).toEqual([
      "D_FINANCIAL_YEAR",
      "N_RUN_SKEY",
      "N_MIS_DATE_SKEY",
      "N_ENTITY_SKEY",
      "N_LOB_SKEY",
      "N_GAAP_SKEY",
      "N_ANNUAL_GROSS_INCOME",
      "V_CCY_CODE",
      "N_DATA_SOURCE_CD",
    ]);

    // The 6 columns named in the named-CONSTRAINT PK are now flagged.
    const pkNames = r.columns.filter((c) => c.pk).map((c) => c.name).sort();
    expect(pkNames).toEqual([
      "D_FINANCIAL_YEAR",
      "N_ENTITY_SKEY",
      "N_GAAP_SKEY",
      "N_LOB_SKEY",
      "N_MIS_DATE_SKEY",
      "N_RUN_SKEY",
    ]);

    // All PK members must be NOT NULL — both because they're explicitly
    // marked, and because the parser forces nullable=false on PK columns.
    for (const c of r.columns) {
      if (c.pk) expect(c.nullable).toBe(false);
    }

    // VARCHAR2(3 CHAR) → size captured as "3".
    const ccy = r.columns.find((c) => c.name === "V_CCY_CODE")!;
    expect(ccy.type).toBe("VARCHAR2");
    expect(ccy.size).toBe("3");

    // NUMBER(22,3) → size + scale captured.
    const income = r.columns.find((c) => c.name === "N_ANNUAL_GROSS_INCOME")!;
    expect(income.type).toBe("NUMBER");
    expect(income.size).toBe("22");
    expect(income.scale).toBe("3");
  });
});
