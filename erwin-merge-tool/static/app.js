"use strict";

/* ------------------------------------------------------------------ *
 * erwin Model Merge — frontend                                        *
 * ------------------------------------------------------------------ */

const state = {
  source: null,   // summary JSON from /api/load
  target: null,
  plan: null,     // {tables_missing, columns_missing, conflicts, ...}
  // Rows are kept in two ordered arrays; moving a row just toggles its
  // `side` property.
  rows: [],           // [{id, side: 'pending'|'staged', kind, ...}]
  conflictRows: [],   // separate — only visible when advanced toggle on
  focusedPane: "pending",
};

/* ------------------------------------------------------------------ *
 * Small DOM helpers                                                   *
 * ------------------------------------------------------------------ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function el(tag, opts = {}, ...children) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      if (v === false || v == null) continue;
      node.setAttribute(k, v === true ? "" : v);
    }
  }
  if (opts.on) {
    for (const [evt, fn] of Object.entries(opts.on)) node.addEventListener(evt, fn);
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    if (typeof c === "string") node.appendChild(document.createTextNode(c));
    else node.appendChild(c);
  }
  return node;
}

function show(node) { node.classList.remove("hidden"); }
function hide(node) { node.classList.add("hidden"); }

let toastTimer = null;
function toast(msg, kind = "info") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast toast-" + kind;
  show(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hide(t), 4000);
}

/* ------------------------------------------------------------------ *
 * Step 1 — file drops                                                 *
 * ------------------------------------------------------------------ */
function wireDropSlot(role) {
  const slot = document.querySelector(`.drop-slot[data-role="${role}"]`);
  const zone = slot.querySelector(".drop-zone");
  const input = slot.querySelector(`[data-file-input="${role}"]`);
  const browseBtn = slot.querySelector(`[data-pick="${role}"]`);
  const errEl = slot.querySelector(`[data-error="${role}"]`);
  const loadedEl = slot.querySelector(`[data-loaded="${role}"]`);

  function clearError() { errEl.textContent = ""; hide(errEl); }
  function setError(msg) { errEl.textContent = msg; show(errEl); }

  zone.addEventListener("click", (e) => {
    if (e.target.tagName === "BUTTON") return;
    input.click();
  });
  browseBtn.addEventListener("click", () => input.click());
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
  });
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("drag-over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    const f = e.dataTransfer?.files?.[0];
    if (f) handle(f);
  });
  input.addEventListener("change", () => {
    const f = input.files?.[0];
    if (f) handle(f);
  });

  async function handle(file) {
    clearError();
    hide(loadedEl);
    resetDownstream();
    zone.classList.add("loading");
    try {
      const fd = new FormData();
      fd.append("role", role);
      fd.append("file", file);
      const resp = await fetch("/api/load", { method: "POST", body: fd });
      const json = await resp.json();
      if (!json.ok) {
        setError(json.error || "Load failed.");
        return;
      }
      state[role] = json;
      loadedEl.querySelector('[data-slot="name"]').textContent = json.filename;
      loadedEl.querySelector('[data-slot="meta"]').textContent =
        `${json.entity_count} entities · ${json.domain_count} domains`;
      show(loadedEl);
      updateComputeButton();
    } catch (err) {
      setError("Upload failed: " + err.message);
    } finally {
      zone.classList.remove("loading");
    }
  }
}

function updateComputeButton() {
  const btn = $("#compute-btn");
  const hint = $("#compute-hint");
  if (state.source && state.target) {
    btn.disabled = false;
    hint.textContent = `Ready — ${state.source.filename} → ${state.target.filename}`;
  } else {
    btn.disabled = true;
    hint.textContent = "Load both files to continue.";
  }
}

function resetDownstream() {
  state.plan = null;
  state.rows = [];
  state.conflictRows = [];
  hide($("#step-plan"));
  hide($("#step-result"));
}

/* ------------------------------------------------------------------ *
 * Step 2 — compute plan                                               *
 * ------------------------------------------------------------------ */
$("#compute-btn").addEventListener("click", async () => {
  try {
    const resp = await fetch("/api/plan", { method: "POST" });
    const json = await resp.json();
    if (!json.ok) {
      toast(json.error || "Plan failed.", "error");
      return;
    }
    state.plan = json;
    buildRowsFromPlan(json);
    renderPlan();
    show($("#step-plan"));
    hide($("#step-result"));
    $("#step-plan").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    toast("Plan failed: " + err.message, "error");
  }
});

let rowIdCounter = 0;
function buildRowsFromPlan(plan) {
  state.rows = [];
  state.conflictRows = [];

  // Table rows (and nested column rows for the PREVIEW; moving the table
  // implicitly carries them, we just display them).
  for (const t of plan.tables_missing) {
    state.rows.push({
      id: `row-${++rowIdCounter}`,
      side: "pending",
      kind: "table",
      tableName: t.name,
      columnCount: t.column_count,
      pk: t.pk,
      columns: t.columns,
    });
  }

  // Column rows on tables that already exist in target — these are
  // independently movable.
  for (const c of plan.columns_missing) {
    state.rows.push({
      id: `row-${++rowIdCounter}`,
      side: "pending",
      kind: "column",
      tableName: c.table,
      columnName: c.column.name,
      physicalDataType: c.column.physical_data_type,
      nullOption: c.column.null_option,
      domainName: c.column.domain_name,
      isPk: c.column.is_pk,
    });
  }

  for (const c of plan.conflicts) {
    state.conflictRows.push({
      id: `conflict-${++rowIdCounter}`,
      decision: "keep", // 'keep' (default) or 'override'
      ...c,
    });
  }
}

/* --- rendering ----------------------------------------------------- */
function renderPlan() {
  // Summary tiles
  const missingTables = state.plan.tables_missing.length;
  const missingCols = state.plan.columns_missing.length;
  const conflictCount = state.plan.conflicts.length;
  $("#tile-tables").textContent = missingTables;
  $("#tile-columns").textContent = missingCols;
  $("#tile-conflicts").textContent = conflictCount;

  const noop = missingTables === 0 && missingCols === 0 && conflictCount === 0;
  if (noop) {
    show($("#noop-banner"));
  } else {
    hide($("#noop-banner"));
  }

  renderPane("pending");
  renderPane("staged");
  renderConflicts();
  updateCounters();
  updateExecuteButton();
}

function renderPane(side) {
  const body = $(side === "pending" ? "#pane-pending" : "#pane-staged");
  body.innerHTML = "";

  const rows = state.rows.filter((r) => r.side === side);
  if (rows.length === 0) {
    body.appendChild(el("div", { class: "pane-empty", text:
      side === "pending" ? "Nothing pending." : "Nothing staged yet." }));
  }

  // Group rows visually by table for readability.
  const tableRows = rows.filter((r) => r.kind === "table");
  const columnRowsByTable = new Map();
  for (const r of rows.filter((r) => r.kind === "column")) {
    if (!columnRowsByTable.has(r.tableName)) columnRowsByTable.set(r.tableName, []);
    columnRowsByTable.get(r.tableName).push(r);
  }

  for (const t of tableRows) {
    body.appendChild(renderTableRow(t, side));
  }
  for (const [tbl, cols] of columnRowsByTable) {
    body.appendChild(renderColumnGroup(tbl, cols, side));
  }
}

function renderTableRow(row, side) {
  const node = el("div", {
    class: "row row-table",
    attrs: { "data-row-id": row.id, tabindex: "0", role: "button" },
    on: {
      click: (e) => {
        if (e.target.closest(".row-move-btn")) return;
        if (e.target.tagName === "INPUT") return;
        toggleSelect(row.id, e);
      },
      keydown: (e) => handleRowKey(e, row),
    },
  });

  const header = el("div", { class: "row-head" });
  header.appendChild(el("input", {
    class: "row-check",
    attrs: { type: "checkbox", "data-row-id": row.id },
    on: {
      click: (e) => e.stopPropagation(),
      change: (e) => setSelected(row.id, e.target.checked),
    },
  }));
  header.appendChild(el("div", { class: "row-icon", text: "▸" }));
  header.appendChild(el("div", { class: "row-title", text: row.tableName }));
  header.appendChild(el("button", {
    class: "row-move-btn",
    text: side === "pending" ? "→" : "←",
    attrs: { type: "button", title: side === "pending" ? "Move to target" : "Move back" },
    on: { click: (e) => { e.stopPropagation(); moveRow(row.id, side === "pending" ? "staged" : "pending"); } },
  }));
  node.appendChild(header);

  const subline = `${row.columnCount} col${row.columnCount === 1 ? "" : "s"}` +
    (row.pk && row.pk.length ? `, PK: ${row.pk.join(", ")}` : "");
  node.appendChild(el("div", { class: "row-sub", text: subline }));

  // Show nested column preview for new tables (not selectable — they're
  // implied by the parent).
  if (row.columns && row.columns.length) {
    const nested = el("div", { class: "row-nested" });
    for (const c of row.columns) {
      const typeStr = c.physical_data_type ? ` — ${c.physical_data_type}` : "";
      const pkMark = c.is_pk ? " (PK)" : "";
      nested.appendChild(el("div", {
        class: "row-nested-col",
        attrs: { title: "Carried with parent table" },
        text: `├ ${c.name}${typeStr}${pkMark}`,
      }));
    }
    node.appendChild(nested);
  }
  return node;
}

function renderColumnGroup(tableName, cols, side) {
  const group = el("div", { class: "group" });
  group.appendChild(el("div", {
    class: "group-head",
    text: `▸ ${tableName}  (existing table, +${cols.length} col${cols.length === 1 ? "" : "s"})`,
  }));
  for (const c of cols) {
    group.appendChild(renderColumnRow(c, side));
  }
  return group;
}

function renderColumnRow(row, side) {
  const node = el("div", {
    class: "row row-column",
    attrs: { "data-row-id": row.id, tabindex: "0", role: "button" },
    on: {
      click: (e) => {
        if (e.target.closest(".row-move-btn")) return;
        if (e.target.tagName === "INPUT") return;
        toggleSelect(row.id, e);
      },
      keydown: (e) => handleRowKey(e, row),
    },
  });
  const head = el("div", { class: "row-head" });
  head.appendChild(el("input", {
    class: "row-check",
    attrs: { type: "checkbox", "data-row-id": row.id },
    on: {
      click: (e) => e.stopPropagation(),
      change: (e) => setSelected(row.id, e.target.checked),
    },
  }));
  head.appendChild(el("div", { class: "row-icon", text: "+" }));
  const title = el("div", { class: "row-title" });
  title.appendChild(document.createTextNode(row.columnName));
  if (row.isPk) title.appendChild(el("span", { class: "badge badge-pk", text: "PK" }));
  head.appendChild(title);
  head.appendChild(el("button", {
    class: "row-move-btn",
    text: side === "pending" ? "→" : "←",
    attrs: { type: "button" },
    on: { click: (e) => { e.stopPropagation(); moveRow(row.id, side === "pending" ? "staged" : "pending"); } },
  }));
  node.appendChild(head);

  const bits = [];
  if (row.physicalDataType) bits.push(row.physicalDataType);
  if (row.domainName) bits.push(`domain: ${row.domainName}`);
  if (row.nullOption) bits.push(row.nullOption);
  if (bits.length) node.appendChild(el("div", { class: "row-sub", text: bits.join(" · ") }));
  return node;
}

/* --- conflicts ----------------------------------------------------- */
$("#show-conflicts").addEventListener("change", (e) => {
  if (e.target.checked) show($("#conflicts-body"));
  else hide($("#conflicts-body"));
});

function renderConflicts() {
  const body = $("#conflicts-body");
  body.innerHTML = "";
  if (state.conflictRows.length === 0) {
    body.appendChild(el("div", { class: "pane-empty", text: "No conflicts." }));
    return;
  }
  for (const c of state.conflictRows) {
    body.appendChild(renderConflictRow(c));
  }
}

function renderConflictRow(c) {
  const node = el("div", { class: "conflict-row", attrs: { "data-row-id": c.id } });
  const head = el("div", { class: "conflict-head" });
  let label = "";
  if (c.kind === "column_diff") {
    label = `${c.table}.${c.column} — column differs`;
  } else if (c.kind === "table_case_mismatch") {
    label = `Table name case differs: source "${c.source_name}" vs target "${c.target_name}"`;
  } else if (c.kind === "missing_domain") {
    label = `${c.table}.${c.column} — domain "${c.domain_name}" missing in target (will fall back by datatype)`;
  }
  head.appendChild(el("div", { class: "conflict-label", text: label }));
  node.appendChild(head);

  if (c.kind === "column_diff") {
    const pre = el("pre", { class: "conflict-diffs" });
    pre.textContent = JSON.stringify(c.diffs, null, 2);
    node.appendChild(pre);
    const actions = el("div", { class: "conflict-actions" });
    const keep = el("label", { class: "radio" });
    const keepIn = el("input", { attrs: { type: "radio", name: `cf-${c.id}`, value: "keep", checked: c.decision === "keep" } });
    keep.appendChild(keepIn); keep.appendChild(document.createTextNode("Keep target (default)"));
    const ovr = el("label", { class: "radio" });
    const ovrIn = el("input", { attrs: { type: "radio", name: `cf-${c.id}`, value: "override", checked: c.decision === "override" } });
    ovr.appendChild(ovrIn); ovr.appendChild(document.createTextNode("Override target with source"));
    keepIn.addEventListener("change", () => { c.decision = "keep"; updateExecuteButton(); });
    ovrIn.addEventListener("change", () => {
      if (!window.confirm("Overriding an existing column's datatype/nullability/domain can break downstream consumers. Are you sure?")) {
        ovrIn.checked = false; keepIn.checked = true; c.decision = "keep";
        return;
      }
      c.decision = "override"; updateExecuteButton();
    });
    actions.appendChild(keep); actions.appendChild(ovr);
    node.appendChild(actions);
  }
  return node;
}

/* --- selection & movement ----------------------------------------- */
const selected = new Set();
function setSelected(rowId, on) {
  if (on) selected.add(rowId); else selected.delete(rowId);
  const cbs = $$(`.row-check[data-row-id="${rowId}"]`);
  cbs.forEach((cb) => { cb.checked = on; });
  const rows = $$(`.row[data-row-id="${rowId}"]`);
  rows.forEach((r) => r.classList.toggle("selected", on));
}
function toggleSelect(rowId, evt) {
  setSelected(rowId, !selected.has(rowId));
}
function clearSelection() {
  const ids = Array.from(selected);
  ids.forEach((id) => setSelected(id, false));
}

function moveRow(rowId, toSide) {
  const row = state.rows.find((r) => r.id === rowId);
  if (!row) return;
  row.side = toSide;
  setSelected(rowId, false);
  renderPane("pending");
  renderPane("staged");
  updateCounters();
  updateExecuteButton();
}

function moveSelected(toSide) {
  const ids = Array.from(selected);
  for (const id of ids) {
    const r = state.rows.find((x) => x.id === id);
    if (r && r.side !== toSide) r.side = toSide;
  }
  clearSelection();
  renderPane("pending");
  renderPane("staged");
  updateCounters();
  updateExecuteButton();
}

$("#arrow-right").addEventListener("click", () => moveSelected("staged"));
$("#arrow-left").addEventListener("click", () => moveSelected("pending"));
$("#move-all-right").addEventListener("click", () => {
  state.rows.filter((r) => r.side === "pending").forEach((r) => (r.side = "staged"));
  clearSelection(); renderPane("pending"); renderPane("staged"); updateCounters(); updateExecuteButton();
});
$("#move-all-left").addEventListener("click", () => {
  state.rows.filter((r) => r.side === "staged").forEach((r) => (r.side = "pending"));
  clearSelection(); renderPane("pending"); renderPane("staged"); updateCounters(); updateExecuteButton();
});

function updateCounters() {
  const pending = state.rows.filter((r) => r.side === "pending");
  const staged = state.rows.filter((r) => r.side === "staged");
  const pendT = pending.filter((r) => r.kind === "table").length;
  const pendC = pending.filter((r) => r.kind === "column").length;
  const stgT = staged.filter((r) => r.kind === "table").length;
  const stgC = staged.filter((r) => r.kind === "column").length;
  const overrides = state.conflictRows.filter((c) => c.decision === "override").length;
  $("#counts-pending").textContent =
    `Pending: ${pendT} table${pendT === 1 ? "" : "s"}, ${pendC} column${pendC === 1 ? "" : "s"}`;
  $("#counts-staged").textContent =
    `Staged: ${stgT} table${stgT === 1 ? "" : "s"}, ${stgC} column${stgC === 1 ? "" : "s"}` +
    (overrides ? ` (${overrides} override${overrides === 1 ? "" : "s"})` : "");
}

function updateExecuteButton() {
  const staged = state.rows.filter((r) => r.side === "staged");
  const overrides = state.conflictRows.filter((c) => c.decision === "override");
  $("#execute-btn").disabled = staged.length === 0 && overrides.length === 0;
}

/* --- keyboard shortcuts ------------------------------------------- */
document.addEventListener("keydown", (e) => {
  // Ignore typing inside inputs (except the pane bodies themselves).
  if (["INPUT", "TEXTAREA"].includes(e.target.tagName) &&
      e.target.type !== "checkbox") return;

  // Track which pane has focus by checking which pane body or its
  // descendants are focused.
  const pendingPane = $("#pane-pending");
  const stagedPane = $("#pane-staged");
  const inPending = pendingPane.contains(document.activeElement);
  const inStaged = stagedPane.contains(document.activeElement);
  state.focusedPane = inStaged ? "staged" : inPending ? "pending" : state.focusedPane;

  if (e.key === "ArrowRight" || (e.key === "Enter" && !e.shiftKey && (inPending || inStaged))) {
    e.preventDefault(); moveSelected("staged"); return;
  }
  if (e.key === "ArrowLeft" || (e.key === "Enter" && e.shiftKey && (inPending || inStaged))) {
    e.preventDefault(); moveSelected("pending"); return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && (inPending || inStaged)) {
    e.preventDefault();
    const side = inStaged ? "staged" : "pending";
    state.rows.filter((r) => r.side === side).forEach((r) => setSelected(r.id, true));
    return;
  }
});

function handleRowKey(e, row) {
  if (e.key === " " || e.key === "Enter") {
    // Toggle via space; Enter is handled globally as "move selected".
    if (e.key === " ") {
      e.preventDefault();
      toggleSelect(row.id, e);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Step 3 — execute merge                                              *
 * ------------------------------------------------------------------ */
$("#execute-btn").addEventListener("click", async () => {
  const staged = state.rows.filter((r) => r.side === "staged");
  const tables = staged.filter((r) => r.kind === "table").map((r) => r.tableName);
  const columns = staged.filter((r) => r.kind === "column").map((r) => ({
    table: r.tableName, column: r.columnName,
  }));
  const overrides = state.conflictRows
    .filter((c) => c.kind === "column_diff" && c.decision === "override")
    .map((c) => ({ table: c.table, column: c.column }));

  const unresolved_conflicts = state.conflictRows
    .filter((c) => !(c.kind === "column_diff" && c.decision === "override"))
    .map((c) => ({ kind: c.kind, ...c }));

  const btn = $("#execute-btn");
  btn.disabled = true;
  btn.textContent = "Merging…";
  try {
    const resp = await fetch("/api/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tables, columns, overrides, unresolved_conflicts }),
    });
    const json = await resp.json();
    if (!json.ok) {
      toast(json.error || "Merge failed.", "error");
      btn.disabled = false; btn.textContent = "Execute merge";
      return;
    }
    showResult(json);
  } catch (err) {
    toast("Merge failed: " + err.message, "error");
    btn.disabled = false; btn.textContent = "Execute merge";
  }
});

function showResult(json) {
  const c = json.counts;
  const banner = $("#result-banner");
  banner.innerHTML = "";
  banner.appendChild(el("div", { text:
    `✓ Added ${c.tables_added} table${c.tables_added === 1 ? "" : "s"}` }));
  banner.appendChild(el("div", { text:
    `✓ Added ${c.columns_added} column${c.columns_added === 1 ? "" : "s"} to existing tables` }));
  if (c.overrides) {
    banner.appendChild(el("div", { text:
      `⚠ Overrode ${c.overrides} existing column${c.overrides === 1 ? "" : "s"}` }));
  }
  if (c.unresolved) {
    banner.appendChild(el("div", { text:
      `⚠ ${c.unresolved} conflict${c.unresolved === 1 ? "" : "s"} left unresolved (see report)` }));
  }
  $("#download-xml").href = json.xml_download_url;
  $("#download-xml").setAttribute("download", json.output_filename);
  $("#download-report").href = json.report_download_url;
  $("#download-report").setAttribute("download", json.report_filename);

  const log = [];
  if (json.actions?.length) {
    log.push("Actions:");
    for (const a of json.actions) log.push("  • " + a);
  }
  if (json.warnings?.length) {
    log.push("", "Warnings:");
    for (const w of json.warnings) log.push("  • " + w);
  }
  $("#result-log").textContent = log.join("\n") || "(no details)";

  show($("#step-result"));
  $("#step-result").scrollIntoView({ behavior: "smooth", block: "start" });

  const btn = $("#execute-btn");
  btn.disabled = false; btn.textContent = "Execute merge";
}

/* ------------------------------------------------------------------ *
 * Back / reset                                                        *
 * ------------------------------------------------------------------ */
$("#back-btn").addEventListener("click", () => {
  hide($("#step-plan"));
  hide($("#step-result"));
  $("#step-load").scrollIntoView({ behavior: "smooth", block: "start" });
});

$("#another-btn").addEventListener("click", () => {
  hide($("#step-result"));
  $("#step-plan").scrollIntoView({ behavior: "smooth", block: "start" });
});

$("#reset-btn").addEventListener("click", async () => {
  try { await fetch("/api/reset", { method: "POST" }); } catch (_) { /* ignore */ }
  state.source = null; state.target = null; state.plan = null;
  state.rows = []; state.conflictRows = [];
  for (const role of ["source", "target"]) {
    hide(document.querySelector(`[data-loaded="${role}"]`));
    const input = document.querySelector(`[data-file-input="${role}"]`);
    if (input) input.value = "";
    const err = document.querySelector(`[data-error="${role}"]`);
    if (err) { err.textContent = ""; hide(err); }
  }
  hide($("#step-plan"));
  hide($("#step-result"));
  updateComputeButton();
});

/* ------------------------------------------------------------------ *
 * Init                                                                *
 * ------------------------------------------------------------------ */
wireDropSlot("source");
wireDropSlot("target");
updateComputeButton();
