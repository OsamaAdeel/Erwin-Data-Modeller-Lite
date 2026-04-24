// Tests for OFSAA ERwin XML compliance — generation + validation.
//
// Uses happy-dom as the vitest environment so DOMParser / XMLSerializer /
// createElementNS all work just like in the browser.

import { describe, it, expect } from "vitest";
import { addEntityDMv9, EmitterError } from "@/services/xml/emitter";
import { serializeDoc } from "@/services/xml/serialize";
import { validateOfsaaXml } from "@/services/xml/validator";
import { NS } from "@/services/xml/namespaces";
import type { NewColumnSpec } from "@/services/xml/types";

// ---------------------------------------------------------------------------
// Fixtures

const DEFAULT_DOMAIN_ID = "{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}+00000000";

function buildBaseDoc(): { doc: XMLDocument; domainMap: Map<string, string> } {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<erwin xmlns="${NS.dm}"
       xmlns:UDP="${NS.udp}"
       xmlns:EMX="${NS.emx}"
       xmlns:EM2="${NS.em2}"
       FileVersion="9.98.29174"
       Format="erwin_Repository">
  <UDP_Definition_Groups>
    <Entity_Groups/>
  </UDP_Definition_Groups>
  <EMX:Model_Groups>
    <EMX:Model id="{MMMMMMMM-MMMM-MMMM-MMMM-MMMMMMMMMMMM}+00000000" name="Model_1"/>
  </EMX:Model_Groups>
  <EMX:Domain_Groups>
    <EMX:Domain id="${DEFAULT_DOMAIN_ID}" name="&lt;default&gt;">
      <EMX:DomainProps>
        <EMX:Name>&lt;default&gt;</EMX:Name>
        <EMX:Long_Id>${DEFAULT_DOMAIN_ID}</EMX:Long_Id>
      </EMX:DomainProps>
    </EMX:Domain>
  </EMX:Domain_Groups>
</erwin>`;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const domainMap = new Map<string, string>([["<default>", DEFAULT_DOMAIN_ID]]);
  return { doc, domainMap };
}

function makeCol(patch: Partial<NewColumnSpec>): NewColumnSpec {
  return {
    id: crypto.randomUUID(),
    name: "COL",
    type: "VARCHAR2",
    size: "50",
    scale: "",
    nullable: true,
    pk: false,
    ...patch,
  };
}

function emitAndSerialize(
  tableName: string,
  cols: NewColumnSpec[]
): string {
  const { doc, domainMap } = buildBaseDoc();
  addEntityDMv9(doc, tableName, cols, domainMap);
  return serializeDoc(doc);
}

// ---------------------------------------------------------------------------
// 1. Column with no Null_Option_Type → validation catches it

describe("RULE 4 — Null_Option_Type presence", () => {
  it("rejects an XML where a column is missing Null_Option_Type", () => {
    const xml = emitAndSerialize("CUSTOMER", [makeCol({ name: "ID", pk: true })]);
    // Surgically remove the Null_Option_Type element from the serialized XML.
    const broken = xml.replace(/<EMX:Null_Option_Type[^<]*<\/EMX:Null_Option_Type>/g, "");
    const r = validateOfsaaXml(broken);
    expect(r.ok).toBe(false);
    expect(
      r.violations.some(
        (v) => v.rule === "RULE 4" && v.field === "Null_Option_Type"
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Column with legacy <Nullable> tag → validation rejects it

describe("RULE 4 — legacy <Nullable> tag is forbidden", () => {
  it("rejects an XML containing <EMX:Nullable> on an AttributeProps", () => {
    const xml = emitAndSerialize("CUSTOMER", [makeCol({ name: "ID", pk: true })]);
    // Inject a Nullable sibling next to Physical_Name to simulate a regressed emitter.
    const broken = xml.replace(
      /<EMX:Physical_Name Derived="Y">ID<\/EMX:Physical_Name>/,
      '<EMX:Physical_Name Derived="Y">ID</EMX:Physical_Name><EMX:Nullable>true</EMX:Nullable>'
    );
    const r = validateOfsaaXml(broken);
    expect(r.ok).toBe(false);
    expect(
      r.violations.some(
        (v) => v.rule === "RULE 4" && v.field === "Nullable"
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Key_Group_Type set to "1" or any non-PK string → validation rejects it

describe("RULE 7 — Key_Group_Type must be 'PK'", () => {
  it('rejects Key_Group_Type="1"', () => {
    const xml = emitAndSerialize("CUSTOMER", [makeCol({ name: "ID", pk: true })]);
    const broken = xml.replace(
      /<EMX:Key_Group_Type>PK<\/EMX:Key_Group_Type>/,
      "<EMX:Key_Group_Type>1</EMX:Key_Group_Type>"
    );
    const r = validateOfsaaXml(broken);
    expect(r.ok).toBe(false);
    expect(
      r.violations.some(
        (v) => v.rule === "RULE 7" && v.field === "Key_Group_Type"
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Missing Columns_Order_Ref_Array → validation catches it

describe("RULE 3 — Columns_Order_Ref_Array must be present", () => {
  it("rejects an entity missing Columns_Order_Ref_Array", () => {
    const xml = emitAndSerialize("CUSTOMER", [makeCol({ name: "ID", pk: true })]);
    const broken = xml.replace(
      /<EMX:Columns_Order_Ref_Array>[\s\S]*?<\/EMX:Columns_Order_Ref_Array>/,
      ""
    );
    const r = validateOfsaaXml(broken);
    expect(r.ok).toBe(false);
    expect(
      r.violations.some(
        (v) =>
          v.rule === "RULE 3" &&
          v.field === "Columns_Order_Ref_Array" &&
          v.message.toLowerCase().includes("missing")
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Duplicate Long_Id → validation catches it

describe("RULE 2 — Long_Id uniqueness", () => {
  it("rejects an XML where two objects share a Long_Id", () => {
    const xml = emitAndSerialize("CUSTOMER", [
      makeCol({ name: "ID", pk: true }),
      makeCol({ name: "NAME" }),
    ]);
    // Grab any column Long_Id out of the emitted xml and substitute it in for
    // another occurrence where it shouldn't match.
    const match = xml.match(
      /<EMX:Long_Id>(\{[0-9A-F-]+\}\+00000000)<\/EMX:Long_Id>/
    );
    expect(match).toBeTruthy();
    const firstId = match![1];
    // Replace the *second* unique Long_Id we find with the first so they clash.
    const seen = new Set<string>();
    const broken = xml.replace(
      /<EMX:Long_Id>(\{[0-9A-F-]+\}\+00000000)<\/EMX:Long_Id>/g,
      (whole, id) => {
        if (id === firstId) return whole;
        if (seen.has(id)) return whole;
        seen.add(id);
        return `<EMX:Long_Id>${firstId}</EMX:Long_Id>`;
      }
    );
    const r = validateOfsaaXml(broken);
    expect(r.ok).toBe(false);
    expect(
      r.violations.some(
        (v) =>
          v.rule === "RULE 2" &&
          v.message.toLowerCase().includes("unique")
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Column name that is an Oracle reserved word → generation raises an error

describe("RULE 6 — reserved-word identifiers raise at emission time", () => {
  it('rejects a column named "SELECT"', () => {
    expect(() =>
      emitAndSerialize("CUSTOMER", [
        makeCol({ name: "ID", pk: true }),
        makeCol({ name: "SELECT" }),
      ])
    ).toThrow(EmitterError);
  });
});

// ---------------------------------------------------------------------------
// 7. Column name longer than 30 chars → generation raises an error

describe("RULE 6 — identifier length cap", () => {
  it("rejects a column name longer than 30 characters", () => {
    const longName = "A".repeat(31);
    expect(() =>
      emitAndSerialize("CUSTOMER", [makeCol({ name: longName, pk: true })])
    ).toThrow(/exceeds 30-character OFSAA limit/);
  });
});

// ---------------------------------------------------------------------------
// 8. Parent_Domain_Ref pointing to a non-existent domain → validation catches it

describe("RULE 9 — Parent_Domain_Ref must resolve", () => {
  it("rejects a Parent_Domain_Ref that doesn't match any Domain", () => {
    const xml = emitAndSerialize("CUSTOMER", [makeCol({ name: "ID", pk: true })]);
    const bogusId = "{FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF}+00000000";
    const broken = xml.replace(
      /<EMX:Parent_Domain_Ref>[^<]+<\/EMX:Parent_Domain_Ref>/,
      `<EMX:Parent_Domain_Ref>${bogusId}</EMX:Parent_Domain_Ref>`
    );
    const r = validateOfsaaXml(broken);
    expect(r.ok).toBe(false);
    expect(
      r.violations.some(
        (v) => v.rule === "RULE 9" && v.field === "Parent_Domain_Ref"
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. Key_Group_Member referencing non-existent column Long_Id → validation catches it

describe("RULE 9 — Key_Group_Member Attribute_Ref must resolve", () => {
  it("rejects an Attribute_Ref that doesn't match any column in the entity", () => {
    const xml = emitAndSerialize("CUSTOMER", [makeCol({ name: "ID", pk: true })]);
    const bogusId = "{DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF}+00000000";
    const broken = xml.replace(
      /(<EMX:Key_Group_MemberProps>[\s\S]*?<EMX:Attribute_Ref>)[^<]+(<\/EMX:Attribute_Ref>)/,
      `$1${bogusId}$2`
    );
    const r = validateOfsaaXml(broken);
    expect(r.ok).toBe(false);
    expect(
      r.violations.some(
        (v) => v.rule === "RULE 9" && v.field === "Attribute_Ref"
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. Fully valid entity with 3 columns → generates + validates clean

describe("happy path — a valid 3-column entity round-trips", () => {
  it("generates and passes validation with no errors", () => {
    const xml = emitAndSerialize("CUSTOMER", [
      makeCol({ name: "CUSTOMER_ID", pk: true, nullable: false, type: "NUMBER", size: "" }),
      makeCol({ name: "CUSTOMER_NAME", nullable: false, size: "100" }),
      makeCol({ name: "CREATED_AT", type: "DATE", size: "" }),
    ]);

    // Prolog compliance is part of the happy path.
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="no"?>')).toBe(true);

    const r = validateOfsaaXml(xml);
    if (!r.ok) {
      // Surface violations to make debugging easier when this test regresses.
      console.error(JSON.stringify(r.violations, null, 2));
    }
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });
});
