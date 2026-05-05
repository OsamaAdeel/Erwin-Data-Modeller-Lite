import { describe, it, expect } from "vitest";
import { parseOracleDdl } from "@/services/ddl/ddlParser";

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
