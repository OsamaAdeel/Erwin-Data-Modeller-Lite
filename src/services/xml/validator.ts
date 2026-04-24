// Standalone OFSAA ERwin XML validator.
//
// Takes the full XML string we're about to hand to the OFSAA uploader and
// returns a list of concrete rule violations. Designed to be called from:
//   - the pre-upload CI check
//   - the unit test suite
//   - an ad-hoc "validate this file" action in the UI
//
// It re-parses the XML with DOMParser rather than trusting the in-memory
// Document, because bugs in the emitter are exactly what this is meant to
// catch — looking at a detached Document would miss serialization-layer
// regressions.

import { ORACLE_RESERVED_WORDS } from "@/services/ddl/oracleParser";
import { NS } from "./namespaces";

export type ViolationSeverity = "error" | "warning";

// Use localName-based lookups throughout. The OFSAA tags we care about all
// live in the EMX namespace, but XML parsers differ in how strictly they
// preserve namespaceURI after a parse/serialize round-trip (happy-dom for
// one is imperfect). Local names are distinctive enough to disambiguate.

export interface Violation {
  rule: string;              // e.g. "RULE 4", "RULE 9"
  severity: ViolationSeverity;
  entity?: string;           // entity display name
  column?: string;           // column display name
  field?: string;            // XML tag the violation attaches to
  message: string;
}

export interface OfsaaValidationResult {
  ok: boolean;
  violations: Violation[];
}

const GUID_RE = /^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}\+\d{8}$/;

const OFSAA_MAX_IDENTIFIER_LEN = 30;

// Tags that must carry Derived="Y" when they appear inside entity/attribute
// /key-group definitions (Rule 8).
const DERIVED_TAGS = new Set<string>([
  "Physical_Name",
  "Physical_Data_Type",
  "Null_Option_Type",
  "Physical_Order",
  "Comment",
  "Logical_Data_Type",
  "Do_Not_Generate",
  "Constraint_Name",
  "Is_Unique",
  "User_Formatted_Name",
  "Attribute_Order",
  "Column_Order",
]);

// Tags that must carry ReadOnly="Y" (Rule 8, second list).
const READONLY_TAGS = new Set<string>([
  "Owner_Path",
  "Physical_Order",
  "Attribute_Order",
  "Column_Order",
  "User_Formatted_Name",
  "Dependent_Objects_Ref_Array",
]);

// Required EntityProps children IN ORDER (Rule 3).
const ENTITY_REQUIRED = [
  "Name",
  "Long_Id",
  "Owner_Path",
  "Type",
  "Physical_Name",
  "Dependent_Objects_Ref_Array",
  "Do_Not_Generate",
  "Attributes_Order_Ref_Array",
  "Physical_Columns_Order_Ref_Array",
  "Columns_Order_Ref_Array",
  "User_Formatted_Name",
] as const;

// Required AttributeProps children (Rule 4) — order-independent; presence only.
const ATTR_REQUIRED = [
  "Name",
  "Long_Id",
  "Owner_Path",
  "Type",
  "Physical_Data_Type",
  "Null_Option_Type",
  "Physical_Order",
  "Comment",
  "Physical_Name",
  "Logical_Data_Type",
  "Parent_Domain_Ref",
  "Attribute_Order",
  "Column_Order",
  "User_Formatted_Name",
] as const;

// Required Key_GroupProps children (Rule 7).
const PK_REQUIRED = [
  "Name",
  "Long_Id",
  "Owner_Path",
  "Key_Group_Type",
  "Physical_Name",
  "Generate_As_Constraint",
  "Dependent_Objects_Ref_Array",
  "Do_Not_Generate",
  "Constraint_Name",
  "Is_Unique",
  "User_Formatted_Name",
] as const;

function nsChildren(parent: Element, tag: string): Element[] {
  return Array.from(parent.children).filter((c) => c.localName === tag);
}

function nsChild(parent: Element, tag: string): Element | null {
  return nsChildren(parent, tag)[0] ?? null;
}

function nsText(parent: Element, tag: string): string | null {
  return nsChild(parent, tag)?.textContent?.trim() ?? null;
}

function findAll(scope: Document | Element, tag: string): Element[] {
  return Array.from(scope.getElementsByTagNameNS("*", tag));
}

function entityDisplayName(entity: Element): string {
  const props = nsChild(entity, "EntityProps");
  if (props) {
    const n = nsText(props, "Name");
    if (n) return n;
  }
  return entity.getAttribute("name") ?? "<unnamed entity>";
}

function attrDisplayName(attr: Element): string {
  const props = nsChild(attr, "AttributeProps");
  if (props) {
    const n = nsText(props, "Name");
    if (n) return n;
  }
  return attr.getAttribute("name") ?? "<unnamed column>";
}

function isValidOfsaaIdentifier(name: string): string | null {
  if (!name) return "empty";
  if (!/^[A-Za-z]/.test(name)) return "must start with a letter";
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name))
    return "may only contain letters, digits, and underscores";
  if (name.length > OFSAA_MAX_IDENTIFIER_LEN)
    return `exceeds ${OFSAA_MAX_IDENTIFIER_LEN}-character limit`;
  if (ORACLE_RESERVED_WORDS.has(name.toUpperCase()))
    return "is an Oracle reserved word";
  return null;
}

export function validateOfsaaXml(xml: string): OfsaaValidationResult {
  const violations: Violation[] = [];
  const push = (v: Violation) => violations.push(v);

  // --- Parse ---
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parserErr = doc.querySelector("parsererror");
  if (parserErr) {
    return {
      ok: false,
      violations: [
        {
          rule: "RULE 1",
          severity: "error",
          message: "XML failed to parse",
        },
      ],
    };
  }

  // --- Rule 1: prolog + root namespaces ---
  if (!/^<\?xml\s+version="1\.0"\s+encoding="UTF-8"\s+standalone="no"\?>/.test(xml)) {
    push({
      rule: "RULE 1",
      severity: "error",
      message:
        'Root XML declaration must be exactly <?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    });
  }

  const root = doc.documentElement;
  if (!root || root.localName !== "erwin") {
    push({
      rule: "RULE 1",
      severity: "error",
      message: "Root must be <erwin>",
    });
  } else {
    if (root.getAttribute("Format") !== "erwin_Repository") {
      push({
        rule: "RULE 1",
        severity: "error",
        message: 'Root must carry Format="erwin_Repository"',
      });
    }
    // Namespace declarations: look them up by xmlns attributes rather than
    // namespaceURI (which some parsers don't propagate on round-trip).
    const declaredNs = Array.from(root.attributes)
      .filter((a) => a.name === "xmlns" || a.name.startsWith("xmlns:"))
      .map((a) => a.value);
    if (!declaredNs.includes(NS.dm)) {
      push({
        rule: "RULE 1",
        severity: "error",
        message: `Root must declare the ${NS.dm} namespace`,
      });
    }
    if (!declaredNs.includes(NS.emx)) {
      push({
        rule: "RULE 1",
        severity: "error",
        message: `Root must declare the ${NS.emx} namespace`,
      });
    }
  }

  // --- Global: collect every Long_Id for uniqueness + xref checks ---
  const allLongIdEls = findAll(doc, "Long_Id");
  const seenIds = new Map<string, number>();
  for (const el of allLongIdEls) {
    const text = el.textContent?.trim() ?? "";
    if (!text) {
      push({
        rule: "RULE 2",
        severity: "error",
        field: "Long_Id",
        message: "Long_Id element is empty",
      });
      continue;
    }
    if (!GUID_RE.test(text)) {
      push({
        rule: "RULE 2",
        severity: "error",
        field: "Long_Id",
        message: `Long_Id "${text}" does not match {UUID}+00000000 format`,
      });
    }
    seenIds.set(text, (seenIds.get(text) ?? 0) + 1);
  }
  for (const [id, count] of seenIds) {
    if (count > 1) {
      push({
        rule: "RULE 2",
        severity: "error",
        field: "Long_Id",
        message: `Long_Id "${id}" appears ${count} times — must be unique`,
      });
    }
  }

  // --- Collect domain IDs for xref (Rule 9) ---
  const domainIds = new Set<string>();
  const domains = findAll(doc, "Domain");
  for (const d of domains) {
    const id = d.getAttribute("id");
    if (id) domainIds.add(id);
    const props =
      nsChild(d, "DomainProps") ?? nsChild(d, "Domain_Properties");
    if (props) {
      const idEl = nsText(props, "Long_Id");
      if (idEl) domainIds.add(idEl);
    }
  }

  // --- Walk every entity ---
  const entities = findAll(doc, "Entity");
  const pkNamesSeen = new Map<string, number>();

  for (const ent of entities) {
    const entName = entityDisplayName(ent);
    const props = nsChild(ent, "EntityProps");
    if (!props) {
      push({
        rule: "RULE 3",
        severity: "error",
        entity: entName,
        message: "Entity is missing <EntityProps>",
      });
      continue;
    }

    // Rule 3: presence + order
    const childOrder = Array.from(props.children).map((c) => c.localName);

    for (const req of ENTITY_REQUIRED) {
      if (!childOrder.includes(req)) {
        push({
          rule: "RULE 3",
          severity: "error",
          entity: entName,
          field: req,
          message: `EntityProps is missing <${req}>`,
        });
      }
    }

    // Rule 3 order: verify required fields appear in the prescribed order.
    const positions: number[] = [];
    for (const req of ENTITY_REQUIRED) {
      const idx = childOrder.indexOf(req);
      if (idx >= 0) positions.push(idx);
    }
    for (let i = 1; i < positions.length; i++) {
      if (positions[i] <= positions[i - 1]) {
        push({
          rule: "RULE 3",
          severity: "error",
          entity: entName,
          message: "EntityProps children are out of required order",
        });
        break;
      }
    }

    // Rule 6: identifier check on physical/display names.
    const physicalName = nsText(props, "Physical_Name");
    const nameForCheck = physicalName ?? entName;
    const nameErr = isValidOfsaaIdentifier(nameForCheck);
    if (nameErr) {
      push({
        rule: "RULE 6",
        severity: "error",
        entity: entName,
        field: "Physical_Name",
        message: `Table name "${nameForCheck}" ${nameErr}`,
      });
    }

    // Rule 10: Do_Not_Generate must not be true for entities in the emit set.
    const dng = nsText(props, "Do_Not_Generate");
    if (dng && dng.toLowerCase() === "true") {
      push({
        rule: "RULE 10",
        severity: "error",
        entity: entName,
        field: "Do_Not_Generate",
        message: "Entity has Do_Not_Generate=true — OFSAA will skip DDL silently",
      });
    }

    // --- Attributes ---
    const attrGroups = nsChild(ent, "Attribute_Groups");
    const attrs = attrGroups ? nsChildren(attrGroups, "Attribute") : [];
    const attrIdSet = new Set<string>();
    for (const attr of attrs) {
      const colName = attrDisplayName(attr);
      const aid = attr.getAttribute("id") ?? "";
      if (aid) attrIdSet.add(aid);

      const ap = nsChild(attr, "AttributeProps");
      if (!ap) {
        push({
          rule: "RULE 4",
          severity: "error",
          entity: entName,
          column: colName,
          message: "Attribute is missing <AttributeProps>",
        });
        continue;
      }

      // Rule 4: required presence.
      for (const req of ATTR_REQUIRED) {
        if (!nsChild(ap, req)) {
          push({
            rule: "RULE 4",
            severity: "error",
            entity: entName,
            column: colName,
            field: req,
            message: `AttributeProps is missing <${req}>`,
          });
        }
      }

      // Rule 4: the legacy Nullable tag is forbidden.
      if (nsChild(ap, "Nullable")) {
        push({
          rule: "RULE 4",
          severity: "error",
          entity: entName,
          column: colName,
          field: "Nullable",
          message:
            "<Nullable> is not valid in OFSAA ERwin XML — use <Null_Option_Type> (0=NOT NULL, 1=NULL)",
        });
      }

      // Rule 4: Null_Option_Type must be 0 or 1.
      const not = nsText(ap, "Null_Option_Type");
      if (not !== null && not !== "0" && not !== "1") {
        push({
          rule: "RULE 4",
          severity: "error",
          entity: entName,
          column: colName,
          field: "Null_Option_Type",
          message: `Null_Option_Type must be "0" or "1" (got "${not}")`,
        });
      }

      // Rule 6: column identifier check.
      const colPhysical = nsText(ap, "Physical_Name") ?? colName;
      const colErr = isValidOfsaaIdentifier(colPhysical);
      if (colErr) {
        push({
          rule: "RULE 6",
          severity: "error",
          entity: entName,
          column: colName,
          field: "Physical_Name",
          message: `Column name "${colPhysical}" ${colErr}`,
        });
      }

      // Rule 8: Derived/ReadOnly presence on the tags listed.
      for (const child of Array.from(ap.children)) {
        const tag = child.localName;
        if (DERIVED_TAGS.has(tag) && child.getAttribute("Derived") !== "Y") {
          push({
            rule: "RULE 8",
            severity: "error",
            entity: entName,
            column: colName,
            field: tag,
            message: `<${tag}> must carry Derived="Y"`,
          });
        }
        if (READONLY_TAGS.has(tag) && child.getAttribute("ReadOnly") !== "Y") {
          push({
            rule: "RULE 8",
            severity: "error",
            entity: entName,
            column: colName,
            field: tag,
            message: `<${tag}> must carry ReadOnly="Y"`,
          });
        }
      }

      // Rule 9: Parent_Domain_Ref must reference an existing domain.
      const pdr = nsText(ap, "Parent_Domain_Ref");
      if (pdr && domainIds.size > 0 && !domainIds.has(pdr)) {
        push({
          rule: "RULE 9",
          severity: "error",
          entity: entName,
          column: colName,
          field: "Parent_Domain_Ref",
          message: `Parent_Domain_Ref "${pdr}" does not match any Domain Long_Id`,
        });
      }
    }

    // Rule 3 + Rule 9: ordering arrays must have one entry per column and
    // every referenced id must exist.
    for (const arrayTag of [
      "Attributes_Order_Ref_Array",
      "Physical_Columns_Order_Ref_Array",
      "Columns_Order_Ref_Array",
    ] as const) {
      const arr = nsChild(props, arrayTag);
      if (!arr) continue; // already flagged by RULE 3 presence check
      const refs = Array.from(arr.children);
      if (refs.length !== attrs.length) {
        push({
          rule: "RULE 3",
          severity: "error",
          entity: entName,
          field: arrayTag,
          message: `${arrayTag} has ${refs.length} entries but entity has ${attrs.length} columns`,
        });
      }
      for (const ref of refs) {
        const refId = ref.textContent?.trim() ?? "";
        if (!attrIdSet.has(refId)) {
          push({
            rule: "RULE 9",
            severity: "error",
            entity: entName,
            field: arrayTag,
            message: `${arrayTag} references Long_Id "${refId}" which is not an Attribute in this entity`,
          });
        }
      }
    }

    // --- Key Groups (PK) ---
    const kgGroups = nsChild(ent, "Key_Group_Groups");
    const kgs = kgGroups ? nsChildren(kgGroups, "Key_Group") : [];
    let pkCount = 0;
    for (const kg of kgs) {
      const kgp = nsChild(kg, "Key_GroupProps");
      if (!kgp) {
        push({
          rule: "RULE 7",
          severity: "error",
          entity: entName,
          message: "Key_Group is missing <Key_GroupProps>",
        });
        continue;
      }

      const kgType = nsText(kgp, "Key_Group_Type");
      if (kgType !== "PK") {
        // Only flag as a PK violation if it is supposed to be a PK — but
        // Rule 7 is explicit that entities must have one Key_Group_Type=PK
        // and that type must be the string "PK", never "1" or any integer.
        push({
          rule: "RULE 7",
          severity: "error",
          entity: entName,
          field: "Key_Group_Type",
          message: `Key_Group_Type must be the string "PK", got "${kgType ?? "<missing>"}"`,
        });
      } else {
        pkCount++;

        // Rule 7: required presence.
        for (const req of PK_REQUIRED) {
          if (!nsChild(kgp, req)) {
            push({
              rule: "RULE 7",
              severity: "error",
              entity: entName,
              field: req,
              message: `Key_GroupProps is missing <${req}>`,
            });
          }
        }

        const pkName = nsText(kgp, "Name") ?? "";
        if (pkName) {
          pkNamesSeen.set(pkName, (pkNamesSeen.get(pkName) ?? 0) + 1);
        }

        // Rule 10: PK must not be Do_Not_Generate=true either.
        const pkDng = nsText(kgp, "Do_Not_Generate");
        if (pkDng && pkDng.toLowerCase() === "true") {
          push({
            rule: "RULE 10",
            severity: "error",
            entity: entName,
            field: "Do_Not_Generate",
            message: "Primary key Do_Not_Generate=true — OFSAA will skip index",
          });
        }

        // Rule 9: every Attribute_Ref inside a Key_Group_Member must point
        // at an existing column in this entity.
        const memberGroups = nsChild(kg, "Key_Group_Member_Groups");
        const members = memberGroups
          ? nsChildren(memberGroups, "Key_Group_Member")
          : [];
        for (const km of members) {
          const kmp = nsChild(km, "Key_Group_MemberProps");
          if (!kmp) continue;
          const ar = nsText(kmp, "Attribute_Ref");
          if (!ar) {
            push({
              rule: "RULE 7",
              severity: "error",
              entity: entName,
              message: "Key_Group_MemberProps is missing <Attribute_Ref>",
            });
            continue;
          }
          if (!attrIdSet.has(ar)) {
            push({
              rule: "RULE 9",
              severity: "error",
              entity: entName,
              field: "Attribute_Ref",
              message: `Key_Group_Member Attribute_Ref "${ar}" does not match any column in this entity`,
            });
          }
        }
      }
    }

    if (pkCount > 1) {
      push({
        rule: "RULE 7",
        severity: "error",
        entity: entName,
        message: `Entity has ${pkCount} PK Key_Groups — expected exactly one`,
      });
    }
  }

  // Rule 7: PK index name (XPK<TABLE>) must be unique across the model.
  for (const [name, count] of pkNamesSeen) {
    if (count > 1) {
      push({
        rule: "RULE 7",
        severity: "error",
        field: "Name",
        message: `PK index name "${name}" appears ${count} times — must be unique across the model`,
      });
    }
  }

  return { ok: violations.length === 0, violations };
}
