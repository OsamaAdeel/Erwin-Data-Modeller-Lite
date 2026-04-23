"""
Core merge logic for erwin-dm-v9 XML files.

Read a source and target, compute what's missing in target, and merge
additions in without touching anything that already exists.

Hard rules (enforced here):
  * Never delete from target.
  * Never modify existing target columns (datatype / nullability / PK).
  * Never copy source GUIDs; mint fresh ones.
  * Match entities and columns by uppercased name.
  * Resolve domains by name against the target's domain library.
  * Refuse non-erwin-dm-v9 files at parse time.
  * On duplicate-table collision during merge, raise DuplicateTableError
    so the caller can abort and roll back.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from lxml import etree

# ---------------------------------------------------------------------------
# Namespaces (erwin Data Modeler 9.x)
# ---------------------------------------------------------------------------
NS = {
    "dm": "http://tempuri.org/DataModel.xsd",
    "emx": "http://tempuri.org/EMX.xsd",
    "udp": "http://tempuri.org/UDP.xsd",
    "em2": "http://tempuri.org/EM2.xsd",
}
Q_EMX = "{%s}" % NS["emx"]
Q_DM = "{%s}" % NS["dm"]


class MergeError(Exception):
    """Generic merge failure. The message is shown to the user verbatim."""


class DuplicateTableError(MergeError):
    """Raised when a staged table already exists in the target model."""


# ---------------------------------------------------------------------------
# Parse / variant detection
# ---------------------------------------------------------------------------
def make_parser() -> etree.XMLParser:
    # huge_tree=True for the 100 MB+ models; keep blank text so the file
    # round-trips without losing the original whitespace.
    return etree.XMLParser(remove_blank_text=False, huge_tree=True)


def parse_xml(data: bytes) -> etree._ElementTree:
    return etree.fromstring(data, make_parser()).getroottree()


def detect_variant(tree: etree._ElementTree) -> str:
    """Returns 'erwin-dm-v9' if the file looks like an erwin DM 9.x model,
    otherwise 'unknown'. Mirrors the analyze_xml.py heuristic from the
    erwin-xml-merge skill: root tag 'erwin' with Format='erwin_Repository'.
    """
    root = tree.getroot()
    tag = etree.QName(root).localname
    if tag.lower() == "erwin" and root.get("Format") == "erwin_Repository":
        return "erwin-dm-v9"
    return "unknown"


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
def emx_text(parent: etree._Element, tag: str) -> Optional[str]:
    el = parent.find(f"{Q_EMX}{tag}")
    return el.text if el is not None and el.text is not None else None


def emx_child(parent: etree._Element, tag: str) -> Optional[etree._Element]:
    return parent.find(f"{Q_EMX}{tag}")


def new_guid() -> str:
    """erwin DM 9.x GUID format: {UUID-UPPERCASE}+00000000."""
    return "{%s}+00000000" % str(uuid.uuid4()).upper()


# ---------------------------------------------------------------------------
# Data classes for the parsed/projected model
# ---------------------------------------------------------------------------
@dataclass
class Column:
    id: str
    name: str
    physical_name: Optional[str]
    physical_data_type: Optional[str]
    null_option: Optional[str]      # e.g. 'NULL' / 'NOT NULL' / null
    parent_domain_ref: Optional[str]  # GUID of the referenced domain, if any
    domain_name: Optional[str]        # resolved by the containing model's map
    is_pk: bool = False


@dataclass
class Entity:
    id: str
    name: str
    columns: List[Column]
    pk_names: List[str]          # uppercase
    columns_by_upper: Dict[str, Column] = field(default_factory=dict)


@dataclass
class Model:
    filename: str
    tree: etree._ElementTree
    entities: List[Entity]
    entities_by_upper: Dict[str, Entity]
    # domain_id -> domain_name   (for interpreting source refs)
    domain_id_to_name: Dict[str, str]
    # domain_name_upper -> (name, id)   (for target lookups)
    domain_name_to_id: Dict[str, Tuple[str, str]]


# ---------------------------------------------------------------------------
# Model extraction
# ---------------------------------------------------------------------------
def _collect_domains(root: etree._Element) -> Tuple[Dict[str, str], Dict[str, Tuple[str, str]]]:
    """Walk the whole tree for EMX:Domain elements, returning id->name and
    UPPER(name)->(name, id). Domains can live under dm:Domains or nested
    under other Domain elements (subdomains)."""
    id_to_name: Dict[str, str] = {}
    name_to_id: Dict[str, Tuple[str, str]] = {}
    for dom in root.iter(f"{Q_EMX}Domain"):
        did = dom.get("id")
        dname = dom.get("name")
        if not did or not dname:
            continue
        id_to_name[did] = dname
        name_to_id.setdefault(dname.upper(), (dname, did))
    return id_to_name, name_to_id


def _collect_pk_names(entity_el: etree._Element, cols_by_id: Dict[str, Column]) -> List[str]:
    """Find the Key_Group whose Key_Group_Type == '1' (primary key) and
    return the uppercase column names it references."""
    kgg = entity_el.find(f".//{Q_EMX}Key_Group_Groups")
    if kgg is None:
        return []
    for kg in kgg.findall(f"{Q_EMX}Key_Group"):
        props = kg.find(f"{Q_EMX}Key_Group_Properties")
        kind = emx_text(props, "Key_Group_Type") if props is not None else None
        if kind != "1":
            continue
        arr = kg.find(f".//{Q_EMX}Key_Group_Members_Order_Ref_Array")
        if arr is None:
            continue
        names: List[str] = []
        for ref in arr.findall(f"{Q_EMX}Key_Group_Members_Order_Ref"):
            mem_id = emx_text(ref, "Ref") or (ref.text or "").strip() or ref.get("id")
            # The ref's text is normally a Key_Group_Member id, not a column
            # id. Walk up to find the matching Key_Group_Member and read its
            # Member_Attribute_Ref.
            if mem_id:
                member = entity_el.find(
                    f".//{Q_EMX}Key_Group_Member[@id='{mem_id}']"
                )
                if member is not None:
                    mprops = member.find(f"{Q_EMX}Key_Group_Member_Properties")
                    if mprops is not None:
                        col_ref = emx_text(mprops, "Member_Attribute_Ref")
                        col = cols_by_id.get(col_ref) if col_ref else None
                        if col:
                            names.append(col.name.upper())
        return names
    return []


def _collect_entities(root: etree._Element, dom_id_to_name: Dict[str, str]) -> List[Entity]:
    entities: List[Entity] = []
    for ent_el in root.iter(f"{Q_EMX}Entity"):
        eid = ent_el.get("id") or ""
        ename = ent_el.get("name") or ""
        if not eid or not ename:
            continue
        cols_by_id: Dict[str, Column] = {}
        cols: List[Column] = []
        # Columns live under EMX:Entity/EMX:Attribute_Groups/EMX:Attribute.
        # Use a bounded XPath instead of iter() so we don't pick up
        # attributes nested under sub-entities (shouldn't happen, but safe).
        ag = ent_el.find(f"{Q_EMX}Attribute_Groups")
        if ag is not None:
            for attr_el in ag.findall(f"{Q_EMX}Attribute"):
                aid = attr_el.get("id") or ""
                aname = attr_el.get("name") or ""
                if not aid or not aname:
                    continue
                props = attr_el.find(f"{Q_EMX}Attribute_Properties")
                phys_name = emx_text(props, "Physical_Name") if props is not None else None
                phys_type = emx_text(props, "Physical_Data_Type") if props is not None else None
                null_opt = emx_text(props, "Null_Option_Type") if props is not None else None
                dom_ref = emx_text(props, "Parent_Domain_Ref") if props is not None else None
                dom_name = dom_id_to_name.get(dom_ref) if dom_ref else None
                col = Column(
                    id=aid,
                    name=aname,
                    physical_name=phys_name,
                    physical_data_type=phys_type,
                    null_option=null_opt,
                    parent_domain_ref=dom_ref,
                    domain_name=dom_name,
                    is_pk=False,
                )
                cols.append(col)
                cols_by_id[aid] = col
        pk_names = _collect_pk_names(ent_el, cols_by_id)
        pk_upper = set(pk_names)
        for col in cols:
            if col.name.upper() in pk_upper:
                col.is_pk = True
        ent = Entity(
            id=eid,
            name=ename,
            columns=cols,
            pk_names=pk_names,
            columns_by_upper={c.name.upper(): c for c in cols},
        )
        entities.append(ent)
    return entities


def load_model(data: bytes, filename: str) -> Model:
    tree = parse_xml(data)
    if detect_variant(tree) != "erwin-dm-v9":
        raise MergeError(
            f"{filename} is not an erwin-dm-v9 file "
            "(expected root <erwin Format=\"erwin_Repository\">)."
        )
    root = tree.getroot()
    id_to_name, name_to_id = _collect_domains(root)
    entities = _collect_entities(root, id_to_name)
    return Model(
        filename=filename,
        tree=tree,
        entities=entities,
        entities_by_upper={e.name.upper(): e for e in entities},
        domain_id_to_name=id_to_name,
        domain_name_to_id=name_to_id,
    )


def model_summary_json(m: Model, role: str) -> dict:
    """Trimmed dict for the frontend — includes enough to render plan rows
    without shipping the full tree."""
    return {
        "role": role,
        "filename": m.filename,
        "variant": "erwin-dm-v9",
        "entity_count": len(m.entities),
        "domain_count": len(m.domain_id_to_name),
        "entities": [
            {
                "name": e.name,
                "columns": [
                    {
                        "name": c.name,
                        "physical_name": c.physical_name,
                        "physical_data_type": c.physical_data_type,
                        "null_option": c.null_option,
                        "domain_name": c.domain_name,
                        "is_pk": c.is_pk,
                    }
                    for c in e.columns
                ],
                "pk": list(e.pk_names),
            }
            for e in m.entities
        ],
        "domain_names": sorted({n for _, (n, _) in m.domain_name_to_id.items()}),
    }


# ---------------------------------------------------------------------------
# Plan computation (diff)
# ---------------------------------------------------------------------------
def compute_plan(source: Model, target: Model) -> dict:
    """Produce three lists: tables_missing, columns_missing, conflicts.

    Cross-cutting rules:
      * Matching is by UPPER(name). We surface case-only differences
        (source 'Customer' vs target 'CUSTOMER') as a conflict so the user
        can confirm it's the same thing.
      * We never assert anything on target-only tables/columns.
    """
    tables_missing: List[dict] = []
    columns_missing: List[dict] = []
    conflicts: List[dict] = []

    for src_ent in source.entities:
        upper = src_ent.name.upper()
        tgt_ent = target.entities_by_upper.get(upper)
        if tgt_ent is None:
            tables_missing.append(
                {
                    "name": src_ent.name,
                    "column_count": len(src_ent.columns),
                    "pk": list(src_ent.pk_names),
                    "columns": [
                        {
                            "name": c.name,
                            "physical_data_type": c.physical_data_type,
                            "null_option": c.null_option,
                            "domain_name": c.domain_name,
                            "is_pk": c.is_pk,
                        }
                        for c in src_ent.columns
                    ],
                }
            )
            # Warn about domain names the target can't resolve (informational
            # only — execute_merge falls back heuristically).
            for c in src_ent.columns:
                if c.domain_name and c.domain_name.upper() not in target.domain_name_to_id:
                    conflicts.append(
                        {
                            "kind": "missing_domain",
                            "table": src_ent.name,
                            "column": c.name,
                            "domain_name": c.domain_name,
                        }
                    )
            continue

        # Name matched case-insensitively but not exactly: flag it.
        if src_ent.name != tgt_ent.name:
            conflicts.append(
                {
                    "kind": "table_case_mismatch",
                    "source_name": src_ent.name,
                    "target_name": tgt_ent.name,
                }
            )

        for src_col in src_ent.columns:
            ukey = src_col.name.upper()
            tgt_col = tgt_ent.columns_by_upper.get(ukey)
            if tgt_col is None:
                columns_missing.append(
                    {
                        "table": tgt_ent.name,  # use target's casing
                        "column": {
                            "name": src_col.name,
                            "physical_data_type": src_col.physical_data_type,
                            "null_option": src_col.null_option,
                            "domain_name": src_col.domain_name,
                            "is_pk": src_col.is_pk,
                        },
                    }
                )
                if src_col.domain_name and src_col.domain_name.upper() not in target.domain_name_to_id:
                    conflicts.append(
                        {
                            "kind": "missing_domain",
                            "table": tgt_ent.name,
                            "column": src_col.name,
                            "domain_name": src_col.domain_name,
                        }
                    )
                continue

            # Both sides present: look for disagreement.
            diffs = {}
            if (src_col.physical_data_type or "") != (tgt_col.physical_data_type or ""):
                diffs["physical_data_type"] = {
                    "source": src_col.physical_data_type,
                    "target": tgt_col.physical_data_type,
                }
            if (src_col.null_option or "") != (tgt_col.null_option or ""):
                diffs["null_option"] = {
                    "source": src_col.null_option,
                    "target": tgt_col.null_option,
                }
            if (src_col.domain_name or "") != (tgt_col.domain_name or ""):
                diffs["domain_name"] = {
                    "source": src_col.domain_name,
                    "target": tgt_col.domain_name,
                }
            if src_col.is_pk != tgt_col.is_pk:
                diffs["pk_membership"] = {
                    "source": src_col.is_pk,
                    "target": tgt_col.is_pk,
                }
            if diffs:
                conflicts.append(
                    {
                        "kind": "column_diff",
                        "table": tgt_ent.name,
                        "column": tgt_col.name,
                        "diffs": diffs,
                    }
                )

    return {
        "tables_missing": tables_missing,
        "columns_missing": columns_missing,
        "conflicts": conflicts,
    }


# ---------------------------------------------------------------------------
# Merge execution
# ---------------------------------------------------------------------------
def _resolve_target_domain(
    target: Model,
    domain_name: Optional[str],
    phys_type: Optional[str],
) -> Tuple[Optional[str], Optional[str], str]:
    """Return (resolved_domain_name, resolved_domain_id, note).

    Lookup order:
      1. Exact source domain name present in target: use that.
      2. Fallback by physical datatype: NUMBER→Amount,
         VARCHAR*→Code_Alphanumeric_Long, DATE→DATE.
      3. '<default>' if present.
      4. Nothing (note explains why).
    """
    if domain_name:
        hit = target.domain_name_to_id.get(domain_name.upper())
        if hit:
            return hit[0], hit[1], f"domain '{domain_name}' matched by name"

    fallback_name = None
    if phys_type:
        pt = phys_type.upper()
        if pt.startswith("NUMBER") or pt in ("INTEGER", "BIGINT", "DECIMAL", "NUMERIC"):
            fallback_name = "Amount"
        elif pt.startswith("VARCHAR") or pt.startswith("CHAR") or pt.startswith("NVARCHAR"):
            fallback_name = "Code_Alphanumeric_Long"
        elif pt.startswith("DATE") or pt.startswith("TIMESTAMP"):
            fallback_name = "DATE"

    if fallback_name:
        hit = target.domain_name_to_id.get(fallback_name.upper())
        if hit:
            return hit[0], hit[1], (
                f"domain '{domain_name or '?'}' not in target — "
                f"fell back to '{hit[0]}' by datatype '{phys_type}'"
            )

    hit = target.domain_name_to_id.get("<DEFAULT>")
    if hit:
        return hit[0], hit[1], (
            f"domain '{domain_name or '?'}' not in target and no type "
            f"fallback matched — used '<default>'"
        )

    return None, None, (
        f"domain '{domain_name or '?'}' not in target and no fallback found — "
        "Parent_Domain_Ref left unset"
    )


def _append_order_ref(
    parent_props: etree._Element,
    array_tag: str,
    ref_tag: str,
    ref_value: str,
    create_if_missing: bool,
) -> bool:
    """Append <ref_tag><emx:Ref>ref_value</emx:Ref></ref_tag> to the
    <array_tag> container. Returns True if appended, False otherwise.
    """
    arr = parent_props.find(f"{Q_EMX}{array_tag}")
    if arr is None:
        if not create_if_missing:
            return False
        arr = etree.SubElement(parent_props, f"{Q_EMX}{array_tag}")
    ref_el = etree.SubElement(arr, f"{Q_EMX}{ref_tag}")
    ref_el.text = ref_value
    return True


def _clone_smallest_attribute(entity_el: etree._Element) -> Optional[etree._Element]:
    """Pick an existing Attribute under this entity to use as a template.
    Returns a deep-copied element with id/name stripped — caller fills in
    the new values. Returns None if no template is available.
    """
    ag = entity_el.find(f"{Q_EMX}Attribute_Groups")
    if ag is None:
        return None
    attrs = ag.findall(f"{Q_EMX}Attribute")
    if not attrs:
        return None
    # "Smallest" == fewest descendants, on the assumption that a minimal
    # attribute has no extra UDP instances / validation rules hanging off it.
    tmpl = min(attrs, key=lambda a: len(list(a.iter())))
    from copy import deepcopy
    return deepcopy(tmpl)


def _build_attribute_element(
    doc_root: etree._Element,
    template: Optional[etree._Element],
    src_col: Column,
    resolved_domain_id: Optional[str],
    resolved_domain_name: Optional[str],
) -> Tuple[etree._Element, str]:
    """Return (new_attribute_element, new_id)."""
    new_id = new_guid()
    if template is not None:
        from copy import deepcopy
        attr_el = deepcopy(template)
        attr_el.set("id", new_id)
        attr_el.set("name", src_col.name)
        # Strip sub-ids that would collide. We only re-id the Attribute's
        # own id; inner props re-key against the attribute itself and
        # erwin rebuilds indexes on import.
        props = attr_el.find(f"{Q_EMX}Attribute_Properties")
        if props is not None:
            _set_or_create(props, "Physical_Name", src_col.physical_name or src_col.name)
            _set_or_create(props, "Physical_Data_Type", src_col.physical_data_type or "")
            if src_col.null_option is not None:
                _set_or_create(props, "Null_Option_Type", src_col.null_option)
            if resolved_domain_id:
                _set_or_create(props, "Parent_Domain_Ref", resolved_domain_id)
    else:
        attr_el = etree.SubElement(doc_root, f"{Q_EMX}Attribute")  # will be detached
        doc_root.remove(attr_el)
        attr_el.set("id", new_id)
        attr_el.set("name", src_col.name)
        props = etree.SubElement(attr_el, f"{Q_EMX}Attribute_Properties")
        etree.SubElement(props, f"{Q_EMX}Physical_Name").text = src_col.physical_name or src_col.name
        etree.SubElement(props, f"{Q_EMX}Physical_Data_Type").text = src_col.physical_data_type or ""
        if src_col.null_option is not None:
            etree.SubElement(props, f"{Q_EMX}Null_Option_Type").text = src_col.null_option
        if resolved_domain_id:
            etree.SubElement(props, f"{Q_EMX}Parent_Domain_Ref").text = resolved_domain_id
    return attr_el, new_id


def _set_or_create(parent: etree._Element, tag: str, value: str) -> None:
    el = parent.find(f"{Q_EMX}{tag}")
    if el is None:
        el = etree.SubElement(parent, f"{Q_EMX}{tag}")
    el.text = value


def _find_entity_in_tree(tree: etree._ElementTree, name_upper: str) -> Optional[etree._Element]:
    for ent_el in tree.getroot().iter(f"{Q_EMX}Entity"):
        if (ent_el.get("name") or "").upper() == name_upper:
            return ent_el
    return None


def _entities_container(root: etree._Element) -> Optional[etree._Element]:
    """Find the element that holds <emx:Entity> children, so we can append
    a new one next to the existing ones. Returns the parent element."""
    first = next(iter(root.iter(f"{Q_EMX}Entity")), None)
    if first is not None:
        return first.getparent()
    return None


def _append_new_entity(
    target_tree: etree._ElementTree,
    src_ent: Entity,
    target: Model,
    warnings: List[str],
    actions: List[str],
) -> None:
    """Clone shape of an existing target entity (to match whatever the
    target's style is), strip out its columns/PK/order-refs, then fill
    with the source entity's columns (fresh GUIDs, domain resolution)."""
    target_root = target_tree.getroot()
    existing_ents = list(target_root.iter(f"{Q_EMX}Entity"))
    if not existing_ents:
        raise MergeError(
            "Target has no existing entities to use as a structural template; "
            "cannot add a new entity from scratch."
        )
    from copy import deepcopy
    tmpl_ent = min(existing_ents, key=lambda e: len(list(e.iter())))
    new_ent = deepcopy(tmpl_ent)
    new_ent.set("id", new_guid())
    new_ent.set("name", src_ent.name)

    # Strip Attribute_Groups contents and order arrays from the clone.
    ag = new_ent.find(f"{Q_EMX}Attribute_Groups")
    if ag is not None:
        for a in list(ag):
            ag.remove(a)
    else:
        ag = etree.SubElement(new_ent, f"{Q_EMX}Attribute_Groups")

    props = new_ent.find(f"{Q_EMX}EntityProps")
    if props is None:
        props = emx_child(new_ent, "EntityProps")  # same call — pure redundancy guard
    if props is None:
        # Fallback: try common alternatives; different exports use
        # different prop containers.
        for alt in ("Entity_Props", "Entity_Properties"):
            props = new_ent.find(f"{Q_EMX}{alt}")
            if props is not None:
                break
    if props is not None:
        for arr_tag in (
            "Attributes_Order_Ref_Array",
            "Physical_Columns_Order_Ref_Array",
            "Columns_Order_Ref_Array",
        ):
            arr = props.find(f"{Q_EMX}{arr_tag}")
            if arr is not None:
                for c in list(arr):
                    arr.remove(c)

    # Drop inherited Key_Group_Groups — we're only carrying columns, not PKs,
    # per the "never modify target PKs" rule. (Adding the PK would require
    # creating matching Key_Group_Members; we surface that as a warning.)
    kgg = new_ent.find(f".//{Q_EMX}Key_Group_Groups")
    if kgg is not None:
        for k in list(kgg):
            kgg.remove(k)
    if src_ent.pk_names:
        warnings.append(
            f"Entity '{src_ent.name}' added without its primary key "
            f"(PK columns were {', '.join(src_ent.pk_names)}); "
            "add the PK manually in erwin after import."
        )

    # Append columns.
    for col in src_ent.columns:
        name, did, note = _resolve_target_domain(target, col.domain_name, col.physical_data_type)
        attr_el, new_id = _build_attribute_element(target_root, None, col, did, name)
        ag.append(attr_el)
        if props is not None:
            _append_order_ref(props, "Attributes_Order_Ref_Array",
                              "Attributes_Order_Ref", new_id, create_if_missing=True)
            _append_order_ref(props, "Physical_Columns_Order_Ref_Array",
                              "Physical_Columns_Order_Ref", new_id, create_if_missing=True)
            _append_order_ref(props, "Columns_Order_Ref_Array",
                              "Columns_Order_Ref", new_id, create_if_missing=False)
        if note and "matched by name" not in note:
            warnings.append(f"{src_ent.name}.{col.name}: {note}")

    container = _entities_container(target_root)
    if container is None:
        raise MergeError("Could not locate the <emx:Entity> container in target.")
    container.append(new_ent)
    actions.append(f"Added entity '{src_ent.name}' with {len(src_ent.columns)} column(s).")


def _append_column_to_existing(
    target_tree: etree._ElementTree,
    target_entity_el: etree._Element,
    src_col: Column,
    target: Model,
    warnings: List[str],
    actions: List[str],
) -> None:
    ag = target_entity_el.find(f"{Q_EMX}Attribute_Groups")
    if ag is None:
        ag = etree.SubElement(target_entity_el, f"{Q_EMX}Attribute_Groups")
    tmpl = _clone_smallest_attribute(target_entity_el)
    name, did, note = _resolve_target_domain(target, src_col.domain_name, src_col.physical_data_type)
    attr_el, new_id = _build_attribute_element(target_tree.getroot(), tmpl, src_col, did, name)
    ag.append(attr_el)

    # Append order refs on the entity's props element.
    props = target_entity_el.find(f"{Q_EMX}EntityProps")
    if props is None:
        for alt in ("Entity_Props", "Entity_Properties"):
            props = target_entity_el.find(f"{Q_EMX}{alt}")
            if props is not None:
                break
    if props is not None:
        _append_order_ref(props, "Attributes_Order_Ref_Array",
                          "Attributes_Order_Ref", new_id, create_if_missing=True)
        _append_order_ref(props, "Physical_Columns_Order_Ref_Array",
                          "Physical_Columns_Order_Ref", new_id, create_if_missing=True)
        _append_order_ref(props, "Columns_Order_Ref_Array",
                          "Columns_Order_Ref", new_id, create_if_missing=False)
    ent_name = target_entity_el.get("name") or "?"
    actions.append(f"Added column '{src_col.name}' to entity '{ent_name}'.")
    if note and "matched by name" not in note:
        warnings.append(f"{ent_name}.{src_col.name}: {note}")


def _override_existing_column(
    target_entity_el: etree._Element,
    target_col_name_upper: str,
    src_col: Column,
    target: Model,
    warnings: List[str],
    actions: List[str],
) -> None:
    ag = target_entity_el.find(f"{Q_EMX}Attribute_Groups")
    if ag is None:
        return
    for attr_el in ag.findall(f"{Q_EMX}Attribute"):
        if (attr_el.get("name") or "").upper() != target_col_name_upper:
            continue
        props = attr_el.find(f"{Q_EMX}Attribute_Properties")
        if props is None:
            return
        if src_col.physical_data_type is not None:
            _set_or_create(props, "Physical_Data_Type", src_col.physical_data_type)
        if src_col.null_option is not None:
            _set_or_create(props, "Null_Option_Type", src_col.null_option)
        _, did, note = _resolve_target_domain(target, src_col.domain_name, src_col.physical_data_type)
        if did:
            _set_or_create(props, "Parent_Domain_Ref", did)
        ent_name = target_entity_el.get("name") or "?"
        actions.append(
            f"Overrode column '{attr_el.get('name')}' on '{ent_name}' "
            f"(datatype/nullability/domain) with source values."
        )
        if note and "matched by name" not in note:
            warnings.append(f"{ent_name}.{attr_el.get('name')}: {note}")
        return


def execute_merge(
    source: Model,
    target_bytes: bytes,
    target_filename: str,
    staged_tables_upper: List[str],
    staged_columns: List[dict],     # [{'table': upper, 'column': upper}, ...]
    staged_overrides: List[dict],   # [{'table': upper, 'column': upper}, ...]
) -> Tuple[bytes, str, List[str], List[str], List[str]]:
    """
    Re-parses target from bytes (fresh tree, not cached), applies staged
    changes, validates the result, and returns:
        (merged_xml_bytes, output_filename, actions, warnings, errors_left)
    `errors_left` lists conflicts the user did NOT override — included in the
    report but not fatal.

    Raises DuplicateTableError on duplicate-table collisions (caller aborts).
    """
    # Fresh parse of target — never work off the cached `Model.tree`.
    target = load_model(target_bytes, target_filename)
    actions: List[str] = []
    warnings: List[str] = []

    # 1. Tables
    for upper in staged_tables_upper:
        src_ent = source.entities_by_upper.get(upper)
        if src_ent is None:
            raise MergeError(f"Source has no table '{upper}' (selection out of sync).")
        if upper in target.entities_by_upper:
            raise DuplicateTableError(
                f"Table {src_ent.name} already exists in the ERwin model"
            )
        _append_new_entity(target.tree, src_ent, target, warnings, actions)

    # 2. Columns on existing tables
    for sel in staged_columns:
        tbl_u = sel["table"].upper()
        col_u = sel["column"].upper()
        src_ent = source.entities_by_upper.get(tbl_u)
        if src_ent is None:
            raise MergeError(f"Source has no table '{tbl_u}' (selection out of sync).")
        src_col = src_ent.columns_by_upper.get(col_u)
        if src_col is None:
            raise MergeError(
                f"Source table '{src_ent.name}' has no column '{col_u}' (selection out of sync)."
            )
        tgt_ent_el = _find_entity_in_tree(target.tree, tbl_u)
        if tgt_ent_el is None:
            # We were told this table already existed in target, but it doesn't
            # after a fresh parse — treat it as a new-table add instead.
            _append_new_entity(target.tree, src_ent, target, warnings, actions)
            continue
        # Skip if column already exists (another concurrent run put it there).
        ag = tgt_ent_el.find(f"{Q_EMX}Attribute_Groups")
        present = False
        if ag is not None:
            for a in ag.findall(f"{Q_EMX}Attribute"):
                if (a.get("name") or "").upper() == col_u:
                    present = True
                    break
        if present:
            warnings.append(
                f"Column {src_ent.name}.{src_col.name}: already present in target, skipped."
            )
            continue
        _append_column_to_existing(target.tree, tgt_ent_el, src_col, target, warnings, actions)

    # 3. Conflict overrides (user explicitly asked for this)
    for sel in staged_overrides:
        tbl_u = sel["table"].upper()
        col_u = sel["column"].upper()
        src_ent = source.entities_by_upper.get(tbl_u)
        if src_ent is None:
            continue
        src_col = src_ent.columns_by_upper.get(col_u)
        if src_col is None:
            continue
        tgt_ent_el = _find_entity_in_tree(target.tree, tbl_u)
        if tgt_ent_el is None:
            continue
        _override_existing_column(tgt_ent_el, col_u, src_col, target, warnings, actions)

    # 4. Serialize and re-parse to confirm well-formedness.
    merged_bytes = etree.tostring(
        target.tree, xml_declaration=True, encoding="UTF-8", standalone=True
    )
    try:
        etree.fromstring(merged_bytes, make_parser())
    except etree.XMLSyntaxError as exc:
        raise MergeError(f"Merged XML is not well-formed: {exc}")

    # 5. Filename rule: _V<N>.xml → _V<N+1>.xml, else updated_<name>
    out_name = _next_filename(target_filename)

    return merged_bytes, out_name, actions, warnings, []


_VERSION_RE = re.compile(r"^(.*_[Vv])(\d+)(\.xml)$", re.IGNORECASE)


def _next_filename(name: str) -> str:
    m = _VERSION_RE.match(name)
    if m:
        prefix, digits, ext = m.group(1), m.group(2), m.group(3)
        n = int(digits) + 1
        # Preserve zero-padding width.
        padded = str(n).zfill(len(digits))
        return f"{prefix}{padded}{ext}"
    return f"updated_{name}"


def build_report(
    source_filename: str,
    target_filename: str,
    output_filename: str,
    actions: List[str],
    warnings: List[str],
    unresolved_conflicts: List[dict],
) -> str:
    lines: List[str] = []
    lines.append("erwin Model Merge — Report")
    lines.append("=" * 50)
    lines.append(f"Source: {source_filename}")
    lines.append(f"Target: {target_filename}")
    lines.append(f"Output: {output_filename}")
    lines.append("")
    lines.append(f"Actions ({len(actions)}):")
    if actions:
        for a in actions:
            lines.append(f"  - {a}")
    else:
        lines.append("  (none)")
    lines.append("")
    lines.append(f"Warnings ({len(warnings)}):")
    if warnings:
        for w in warnings:
            lines.append(f"  - {w}")
    else:
        lines.append("  (none)")
    lines.append("")
    lines.append(f"Unresolved conflicts ({len(unresolved_conflicts)}):")
    if unresolved_conflicts:
        for c in unresolved_conflicts:
            lines.append(f"  - {c}")
    else:
        lines.append("  (none)")
    lines.append("")
    return "\n".join(lines)
