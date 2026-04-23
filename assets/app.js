/* ================================================================
   ERwin Modeller Lite — in-browser XML editor for ERwin repository
   files. Parses, collects existing entity names into a dictionary,
   renders an add-table form, and merges new entities back into the
   DOM before offering a versioned download.
   ================================================================ */

const NS = {
  dm: 'http://www.erwin.com/dm',
  emx: 'http://www.erwin.com/dm/data',
  udp: 'http://www.erwin.com/dm/metadata',
  em2: 'http://www.erwin.com/dm/EM2data'
};

/* ==================== Oracle DDL rules ==================== */
// Strictly reserved words from V$RESERVED_WORDS (reserved=Y). These cannot be
// used as identifiers without double-quoting, which the spec deliberately
// avoids. Comparison is case-insensitive.
const ORACLE_RESERVED_WORDS = new Set([
  'ACCESS', 'ADD', 'ALL', 'ALTER', 'AND', 'ANY', 'AS', 'ASC', 'AUDIT', 'BETWEEN', 'BY',
  'CHAR', 'CHECK', 'CLUSTER', 'COLUMN', 'COLUMN_VALUE', 'COMMENT', 'COMPRESS',
  'CONNECT', 'CREATE', 'CURRENT', 'DATE', 'DECIMAL', 'DEFAULT', 'DELETE', 'DESC',
  'DISTINCT', 'DROP', 'ELSE', 'EXCLUSIVE', 'EXISTS', 'FILE', 'FLOAT', 'FOR', 'FROM',
  'GRANT', 'GROUP', 'HAVING', 'IDENTIFIED', 'IMMEDIATE', 'IN', 'INCREMENT', 'INDEX',
  'INITIAL', 'INSERT', 'INTEGER', 'INTERSECT', 'INTO', 'IS', 'LEVEL', 'LIKE', 'LOCK',
  'LONG', 'MAXEXTENTS', 'MINUS', 'MLSLABEL', 'MODE', 'MODIFY', 'NESTED_TABLE_ID',
  'NOAUDIT', 'NOCOMPRESS', 'NOT', 'NOWAIT', 'NULL', 'NUMBER', 'OF', 'OFFLINE', 'ON',
  'ONLINE', 'OPTION', 'OR', 'ORDER', 'PCTFREE', 'PRIOR', 'PUBLIC', 'RAW', 'RENAME',
  'RESOURCE', 'REVOKE', 'ROW', 'ROWID', 'ROWNUM', 'ROWS', 'SELECT', 'SESSION', 'SET',
  'SHARE', 'SIZE', 'SMALLINT', 'START', 'SUCCESSFUL', 'SYNONYM', 'SYSDATE', 'TABLE',
  'THEN', 'TO', 'TRIGGER', 'UID', 'UNION', 'UNIQUE', 'UPDATE', 'USER', 'VALIDATE',
  'VALUES', 'VARCHAR', 'VARCHAR2', 'VIEW', 'WHENEVER', 'WHERE', 'WITH'
]);

const MAX_IDENTIFIER_LEN = 128;     // Oracle 12.2+
const MAX_COLUMNS_PER_TABLE = 1000; // Oracle hard limit

const TYPE_LIMITS = {
  VARCHAR2: { needsLen: true, maxLen: 4000 },     // up to 32767 with EXTENDED, but 4000 is the default and safer ceiling for a "lite" tool
  CHAR: { needsLen: true, maxLen: 2000 },
  NUMBER: { needsLen: false, maxPrec: 38, minScale: -84, maxScale: 127 },
  DATE: {},
  TIMESTAMP: {},
  CLOB: {},
  BLOB: {}
};

const DATA_TYPES = ['VARCHAR2', 'NUMBER', 'DATE', 'TIMESTAMP', 'CHAR', 'CLOB', 'BLOB'];

/**
 * Validate an Oracle identifier (table or column name) per the DDL rules.
 * @returns {{ok:true} | {ok:false, error:string}}
 */
function validateIdentifier(name, kind = 'name') {
  if (!name) return { ok: false, error: `${kind} cannot be empty` };
  // Byte length: identifiers are byte-bounded, not char-bounded. ASCII = 1 byte,
  // multibyte chars cost more. We approximate via TextEncoder.
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

/**
 * Validate a column's data-type sizing per Oracle limits.
 * @returns {string|null} error string or null if ok
 */
function validateColumnSize(col) {
  const limits = TYPE_LIMITS[col.type] || {};
  if (limits.needsLen) {
    const n = parseInt(col.size, 10);
    if (!col.size || isNaN(n)) return `${col.type} requires a length`;
    if (n < 1) return `${col.type} length must be ≥ 1`;
    if (n > limits.maxLen) return `${col.type} length must be ≤ ${limits.maxLen}`;
  }
  if (col.type === 'NUMBER') {
    if (col.size) {
      const p = parseInt(col.size, 10);
      if (isNaN(p) || p < 1 || p > limits.maxPrec) {
        return `NUMBER precision must be 1–${limits.maxPrec}`;
      }
    }
    if (col.scale !== '' && col.scale !== undefined && col.scale !== null) {
      const s = parseInt(col.scale, 10);
      if (isNaN(s) || s < limits.minScale || s > limits.maxScale) {
        return `NUMBER scale must be ${limits.minScale} to ${limits.maxScale}`;
      }
    }
  }
  return null;
}

const state = {
  fileName: null,
  doc: null,
  variant: null,            // 'erwin-dm-v9' | 'erwin-classic' | 'unknown'
  entityDict: new Map(),       // UPPER-CASE name -> original-case name
  domainMap: new Map(),       // DM-v9 domain name -> id
  columns: [],
  folderFiles: []               // sorted desc by lastModified, populated when a folder is picked
};

/* ==================== Upload / parse ==================== */

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const folderFileSelect = document.getElementById('folder-file-select');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragging');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragging');
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

/* ----- Folder file dropdown (populated by the preferred-folder flow) ----- */

folderFileSelect.addEventListener('change', (e) => {
  const idx = parseInt(e.target.value, 10);
  const file = state.folderFiles[idx];
  if (!file) return;
  document.getElementById('folder-latest-tag').classList.toggle('dim', idx !== 0);
  handleFile(file);
});

function renderFolderPicker(files, folderName) {
  const picker = document.getElementById('folder-picker');
  // Prefer an explicitly-passed folder name (from the FS Access handle).
  // Fall back to webkitRelativePath for any legacy webkitdirectory-loaded files.
  const name = folderName
    || (files[0].webkitRelativePath || '').split('/')[0]
    || '(folder)';
  document.getElementById('folder-name').textContent = name;
  document.getElementById('folder-count').textContent = files.length.toLocaleString();

  folderFileSelect.innerHTML = '';
  files.forEach((f, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    const ts = formatTimestamp(f.lastModified);
    const size = formatSize(f.size);
    let path = f.webkitRelativePath || f.name;
    if (path.startsWith(name + '/')) path = path.slice(name.length + 1);
    opt.textContent = `${path}  ·  ${ts}  ·  ${size}${i === 0 ? '  ·  LATEST' : ''}`;
    opt.title = `${path}\nModified: ${new Date(f.lastModified).toString()}\nSize: ${size}`;
    folderFileSelect.appendChild(opt);
  });
  folderFileSelect.value = '0';
  document.getElementById('folder-latest-tag').classList.remove('dim');
  picker.classList.remove('hidden');
}

function formatTimestamp(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function handleFile(file) {
  try {
    const text = await file.text();
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const err = doc.querySelector('parsererror');
    if (err) {
      alert('Could not parse XML file.\n\n' + err.textContent.slice(0, 300));
      return;
    }
    state.fileName = file.name;
    state.doc = doc;
    // Sync the folder dropdown if this file is one of the folder files.
    if (state.folderFiles.length) {
      const idx = state.folderFiles.indexOf(file);
      if (idx >= 0) {
        folderFileSelect.value = String(idx);
        document.getElementById('folder-latest-tag').classList.toggle('dim', idx !== 0);
      }
    }
    analyzeDoc();
    renderFileInfo();
    renderExistingList();
    initForm();
    document.getElementById('form-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    alert('Error reading file: ' + e.message);
  }
}

/* ==================== Preferred folder (File System Access API) ====================
 * Lets the user designate a folder once. The browser persists the directory handle
 * in IndexedDB; on every visit we attempt to silently auto-load the latest XML from
 * that folder. Permission usually has to be re-granted with one click per session.
 *
 * Chromium-only (Chrome / Edge / Opera). Firefox / Safari users will see the setup
 * link but it will tell them the feature is unavailable.
 * ============================================================================== */

const FSA_SUPPORTED = typeof window.showDirectoryPicker === 'function';
const PREFS_DB = 'erwinModellerLite';
const PREFS_STORE = 'preferences';
const PREFS_KEY = 'preferredFolder';

state.preferredHandle = null;

function openPrefsDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PREFS_DB, 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore(PREFS_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function savePreferredHandle(handle) {
  const db = await openPrefsDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(PREFS_STORE, 'readwrite');
    tx.objectStore(PREFS_STORE).put(handle, PREFS_KEY);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}
async function loadPreferredHandle() {
  const db = await openPrefsDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(PREFS_STORE, 'readonly');
    const req = tx.objectStore(PREFS_STORE).get(PREFS_KEY);
    req.onsuccess = () => res(req.result || null);
    req.onerror = () => rej(req.error);
  });
}
async function clearPreferredHandle() {
  const db = await openPrefsDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(PREFS_STORE, 'readwrite');
    tx.objectStore(PREFS_STORE).delete(PREFS_KEY);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}

function setPreferredStatus(text, isError = false) {
  const el = document.getElementById('preferred-status');
  if (!text) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.textContent = text;
  el.classList.remove('hidden');
  el.classList.toggle('error', isError);
}

function renderPreferredUI() {
  const banner = document.getElementById('preferred-banner');
  const setup = document.getElementById('preferred-setup');
  if (state.preferredHandle) {
    banner.classList.remove('hidden');
    setup.classList.add('hidden');
    document.getElementById('preferred-name').textContent = state.preferredHandle.name;
  } else {
    banner.classList.add('hidden');
    setup.classList.remove('hidden');
  }
}

async function pickPreferredFolder() {
  if (!FSA_SUPPORTED) {
    alert('The "preferred folder" feature requires a Chromium-based browser (Chrome, Edge, Opera). ' +
      'You can still use the drop zone above to load a single XML file.');
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'read', startIn: 'downloads' });
    await savePreferredHandle(handle);
    state.preferredHandle = handle;
    renderPreferredUI();
    setPreferredStatus(`Saved "${handle.name}" as your preferred folder.`);
    await reloadFromPreferred(false);
  } catch (e) {
    if (e.name !== 'AbortError') {
      setPreferredStatus('Could not set preferred folder: ' + e.message, true);
    }
  }
}

async function reloadFromPreferred(silent) {
  const handle = state.preferredHandle;
  if (!handle) return;
  try {
    let perm = await handle.queryPermission({ mode: 'read' });
    if (perm !== 'granted') {
      perm = await handle.requestPermission({ mode: 'read' });
    }
    if (perm !== 'granted') {
      if (!silent) setPreferredStatus('Permission denied. Click "Reload latest" to grant access.', true);
      return;
    }
    // Walk the folder, collecting XML files with their lastModified timestamps.
    const files = [];
    for await (const [name, entry] of handle.entries()) {
      if (entry.kind === 'file' && name.toLowerCase().endsWith('.xml')) {
        files.push(await entry.getFile());
      }
    }
    if (!files.length) {
      setPreferredStatus(`No .xml files found in "${handle.name}".`, true);
      return;
    }
    files.sort((a, b) => b.lastModified - a.lastModified);
    state.folderFiles = files;
    renderFolderPicker(files, handle.name);
    await handleFile(files[0]);
    setPreferredStatus(`Loaded latest from "${handle.name}" — ${files[0].name} (${formatTimestamp(files[0].lastModified)}).`);
  } catch (e) {
    setPreferredStatus('Could not read preferred folder: ' + e.message, true);
  }
}

async function clearPreferred() {
  await clearPreferredHandle();
  state.preferredHandle = null;
  renderPreferredUI();
  setPreferredStatus('Preferred folder cleared.');
}

async function initPreferredFolder() {
  if (!FSA_SUPPORTED) {
    // Hide the setup link entirely on Firefox/Safari to reduce noise.
    document.getElementById('preferred-setup').classList.add('hidden');
    return;
  }
  document.getElementById('set-preferred-btn').addEventListener('click', pickPreferredFolder);
  document.getElementById('reload-preferred-btn').addEventListener('click', () => reloadFromPreferred(false));
  document.getElementById('clear-preferred-btn').addEventListener('click', clearPreferred);

  try {
    const handle = await loadPreferredHandle();
    if (handle) {
      state.preferredHandle = handle;
      renderPreferredUI();
      // Try silent auto-load. If permission isn't already granted (most common
      // case after a browser restart), the user just clicks "Reload latest".
      const perm = await handle.queryPermission({ mode: 'read' });
      if (perm === 'granted') {
        await reloadFromPreferred(true);
      } else {
        setPreferredStatus(`Click "Reload latest" to grant access to "${handle.name}" and load the newest XML.`);
      }
    } else {
      renderPreferredUI();
    }
  } catch (e) {
    console.warn('Preferred folder init failed:', e);
    renderPreferredUI();
  }
}

initPreferredFolder();

function analyzeDoc() {
  const root = state.doc.documentElement;
  state.variant = detectVariant(root);
  state.entityDict = collectEntityNames(state.doc, state.variant);
  state.domainMap = state.variant === 'erwin-dm-v9' ? collectDomainMap(state.doc) : new Map();
}

function detectVariant(root) {
  const tag = root.tagName;
  const fmt = root.getAttribute('Format') || '';
  const ns = root.namespaceURI || '';
  if (tag === 'erwin' && fmt === 'erwin_Repository' && ns === NS.dm) return 'erwin-dm-v9';
  const classicEntities = Array.from(root.getElementsByTagName('Entity'))
    .filter(e => e.namespaceURI !== NS.emx);
  if (classicEntities.length > 0) return 'erwin-classic';
  return 'unknown';
}

function collectEntityNames(doc, variant) {
  const dict = new Map();
  if (variant === 'erwin-dm-v9') {
    const entities = doc.getElementsByTagNameNS(NS.emx, 'Entity');
    for (const e of entities) {
      const nameAttr = e.getAttribute('name') || '';
      let physical = nameAttr;
      const props = e.getElementsByTagNameNS(NS.emx, 'EntityProps')[0];
      if (props) {
        const pn = props.getElementsByTagNameNS(NS.emx, 'Physical_Name')[0];
        if (pn && pn.textContent.trim()) physical = pn.textContent.trim();
      }
      if (physical) dict.set(physical.toUpperCase(), physical);
      if (nameAttr && !dict.has(nameAttr.toUpperCase())) dict.set(nameAttr.toUpperCase(), nameAttr);
    }
  } else if (variant === 'erwin-classic') {
    const entities = Array.from(doc.getElementsByTagName('Entity'))
      .filter(e => e.namespaceURI !== NS.emx);
    for (const e of entities) {
      const n = e.getAttribute('Name') || e.getAttribute('name') ||
        e.getAttribute('Physical_Name') || '';
      if (n) dict.set(n.toUpperCase(), n);
    }
  }
  return dict;
}

function collectDomainMap(doc) {
  const map = new Map();
  const domains = doc.getElementsByTagNameNS(NS.emx, 'Domain');
  for (const d of domains) {
    const name = d.getAttribute('name');
    const id = d.getAttribute('id');
    if (name && id) map.set(name, id);
  }
  return map;
}

/* ==================== UI render ==================== */

function renderFileInfo() {
  document.getElementById('file-section').classList.remove('hidden');
  document.getElementById('form-section').classList.remove('hidden');
  document.getElementById('file-name').textContent = state.fileName;
  document.getElementById('variant-name').textContent = state.variant;
  document.getElementById('entity-count').textContent = state.entityDict.size.toLocaleString();
  document.getElementById('footer-variant').textContent = `Variant: ${state.variant}`;

  const notice = document.getElementById('variant-notice');
  if (state.variant === 'erwin-dm-v9') {
    notice.textContent = 'Note · DM-v9 entities will appear in the model tree but must be dragged onto a diagram inside ERwin DM to be visible.';
    notice.classList.remove('hidden');
  } else if (state.variant === 'unknown') {
    notice.textContent = 'Warning · Unknown ERwin variant. Output may not load cleanly in ERwin. Proceed with caution.';
    notice.classList.remove('hidden');
  } else {
    notice.classList.add('hidden');
  }
}

function renderExistingList(filter = '') {
  const list = document.getElementById('existing-list');
  list.innerHTML = '';
  const names = [...state.entityDict.values()].sort((a, b) => a.localeCompare(b));
  const filtered = filter
    ? names.filter(n => n.toUpperCase().includes(filter.toUpperCase()))
    : names;
  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'existing-empty';
    empty.textContent = filter ? 'No matches' : 'No entities';
    list.appendChild(empty);
    return;
  }
  for (const n of filtered) {
    const row = document.createElement('div');
    row.className = 'existing-row';
    row.textContent = n;
    row.title = n;
    list.appendChild(row);
  }
}

document.getElementById('existing-toggle').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  const panel = document.getElementById('existing-panel');
  btn.classList.toggle('open');
  panel.classList.toggle('open');
});

document.getElementById('existing-search').addEventListener('input', (e) => {
  renderExistingList(e.target.value);
});

/* ==================== Form ==================== */

function initForm() {
  state.columns = [];
  addColumn();
  document.getElementById('table-name').value = '';
  validate();
}

function addColumn() {
  if (state.columns.length >= MAX_COLUMNS_PER_TABLE) return;
  state.columns.push({
    id: crypto.randomUUID(),
    name: '',
    type: 'VARCHAR2',
    size: '',
    scale: '',
    nullable: true,
    pk: false
  });
  renderColumns();
  validate();
}

function removeColumn(id) {
  state.columns = state.columns.filter(c => c.id !== id);
  renderColumns();
  validate();
}

function renderColumns() {
  const container = document.getElementById('columns-list');
  container.innerHTML = '';
  state.columns.forEach((col) => {
    const row = document.createElement('div');
    row.className = 'column-row';

    // -- name
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'COLUMN_NAME';
    nameInput.spellcheck = false;
    nameInput.autocomplete = 'off';
    nameInput.maxLength = MAX_IDENTIFIER_LEN;
    nameInput.value = col.name;
    nameInput.addEventListener('input', (e) => {
      col.name = e.target.value;
      validate();
    });

    // -- type
    const typeSelect = document.createElement('select');
    DATA_TYPES.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      if (col.type === t) opt.selected = true;
      typeSelect.appendChild(opt);
    });
    typeSelect.addEventListener('change', (e) => {
      col.type = e.target.value;
      col.size = '';
      col.scale = '';
      renderColumns();
      validate();
    });

    // -- size / precision
    const sizeCell = document.createElement('div');
    sizeCell.className = 'size-inputs';
    const limits = TYPE_LIMITS[col.type] || {};
    if (col.type === 'VARCHAR2' || col.type === 'CHAR') {
      const s = document.createElement('input');
      s.type = 'number';
      s.placeholder = 'length';
      s.min = '1';
      s.max = String(limits.maxLen);
      s.value = col.size;
      s.addEventListener('input', (e) => { col.size = e.target.value; validate(); });
      sizeCell.appendChild(s);
    } else if (col.type === 'NUMBER') {
      sizeCell.classList.add('two');
      const p = document.createElement('input');
      p.type = 'number'; p.placeholder = 'prec'; p.min = '1'; p.max = '38'; p.value = col.size;
      p.addEventListener('input', (e) => { col.size = e.target.value; validate(); });
      const sc = document.createElement('input');
      sc.type = 'number'; sc.placeholder = 'scale'; sc.min = '-84'; sc.max = '127'; sc.value = col.scale;
      sc.addEventListener('input', (e) => { col.scale = e.target.value; validate(); });
      sizeCell.appendChild(p);
      sizeCell.appendChild(sc);
    } else {
      sizeCell.classList.add('empty');
    }

    // -- nullable
    const nullCell = document.createElement('div');
    nullCell.className = 'checkbox-cell';
    const nullChk = document.createElement('input');
    nullChk.type = 'checkbox';
    nullChk.className = 'check';
    nullChk.checked = col.nullable;
    nullChk.disabled = col.pk;
    nullChk.addEventListener('change', (e) => {
      col.nullable = e.target.checked;
      validate();
    });
    nullCell.appendChild(nullChk);

    // -- pk
    const pkCell = document.createElement('div');
    pkCell.className = 'checkbox-cell';
    const pkChk = document.createElement('input');
    pkChk.type = 'checkbox';
    pkChk.className = 'check';
    pkChk.checked = col.pk;
    pkChk.addEventListener('change', (e) => {
      col.pk = e.target.checked;
      if (col.pk) col.nullable = false;
      renderColumns();
      validate();
    });
    pkCell.appendChild(pkChk);

    // -- remove
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '×';
    removeBtn.type = 'button';
    removeBtn.disabled = state.columns.length === 1;
    removeBtn.title = 'Remove column';
    removeBtn.addEventListener('click', () => removeColumn(col.id));

    // mark inputs so validate() can find them by column id
    nameInput.dataset.colId = col.id;
    nameInput.dataset.role = 'name';

    row.appendChild(nameInput);
    row.appendChild(typeSelect);
    row.appendChild(sizeCell);
    row.appendChild(nullCell);
    row.appendChild(pkCell);
    row.appendChild(removeBtn);
    container.appendChild(row);

    // per-column error message (hidden until validate populates it)
    const errEl = document.createElement('div');
    errEl.className = 'column-error hidden';
    errEl.id = `col-err-${col.id}`;
    container.appendChild(errEl);
  });
}

document.getElementById('add-col-btn').addEventListener('click', addColumn);
document.getElementById('table-name').addEventListener('input', validate);

/* ==================== Validation ==================== */

function validate() {
  const errs = [];
  const warns = [];

  // ----- table name -----
  const tnInput = document.getElementById('table-name');
  const tn = tnInput.value.trim();
  const tnErr = document.getElementById('table-name-error');
  tnInput.classList.remove('error');
  tnErr.classList.add('hidden');

  let tableNameValid = false;
  if (!tn) {
    errs.push('table-name-empty');
  } else if (state.entityDict && state.entityDict.has(tn.toUpperCase())) {
    errs.push('table-name-dup');
    tnErr.textContent = `Table "${tn}" already exists in the model.`;
    tnErr.classList.remove('hidden');
    tnInput.classList.add('error');
  } else {
    const idCheck = validateIdentifier(tn, 'table name');
    if (!idCheck.ok) {
      errs.push('table-name-invalid');
      tnErr.textContent = idCheck.error;
      tnErr.classList.remove('hidden');
      tnInput.classList.add('error');
    } else {
      tableNameValid = true;
    }
  }

  // Lock the columns block until the table name passes its own checks.
  document.getElementById('columns-block').classList.toggle('locked', !tableNameValid);

  // ----- columns -----
  if (!state.columns.length) errs.push('no-columns');
  if (state.columns.length > MAX_COLUMNS_PER_TABLE) {
    errs.push('too-many-columns');
  }

  const seen = new Map(); // upper-case name -> first column id seen with that name
  let hasPK = false;
  let bareNumber = false;

  for (const col of state.columns) {
    const errEl = document.getElementById(`col-err-${col.id}`);
    const nameInput = document.querySelector(`input[data-col-id="${col.id}"][data-role="name"]`);
    if (errEl) { errEl.classList.add('hidden'); errEl.textContent = ''; }
    if (nameInput) nameInput.classList.remove('error');

    const colErrors = [];

    // name validation
    const trimmed = col.name.trim();
    if (!trimmed) {
      colErrors.push('name required');
      errs.push('col-empty');
    } else {
      const idCheck = validateIdentifier(trimmed, 'column name');
      if (!idCheck.ok) {
        colErrors.push(idCheck.error);
        errs.push('col-invalid');
      } else {
        const key = trimmed.toUpperCase();
        if (seen.has(key)) {
          colErrors.push(`duplicate column name "${trimmed}"`);
          errs.push('col-dup');
        } else {
          seen.set(key, col.id);
        }
      }
    }

    // size / type validation
    const sizeErr = validateColumnSize(col);
    if (sizeErr) {
      colErrors.push(sizeErr);
      errs.push('col-size');
    }

    // best-practice: bare NUMBER without precision
    if (col.type === 'NUMBER' && !col.size) bareNumber = true;

    if (col.pk) hasPK = true;

    // surface error on the row (first error only — keeps the strip tidy)
    if (colErrors.length && errEl) {
      errEl.textContent = colErrors[0];
      errEl.classList.remove('hidden');
      if (nameInput && (colErrors[0].includes('column name') || colErrors[0].includes('reserved') || colErrors[0].includes('duplicate'))) {
        nameInput.classList.add('error');
      }
    }
  }

  // ----- warnings (only when table name itself is valid, to avoid noise) -----
  if (tableNameValid) {
    if (state.columns.length && !hasPK) warns.push('no-pk');
    if (bareNumber) warns.push('bare-number');
    if (state.columns.length >= MAX_COLUMNS_PER_TABLE) warns.push('at-limit');
  }

  const wbox = document.getElementById('warnings');
  wbox.innerHTML = '';
  const warningMessages = {
    'no-pk': 'No primary key selected — allowed, but not recommended',
    'bare-number': 'NUMBER column has no precision — best practice is to specify NUMBER(p[,s])',
    'at-limit': `Reached Oracle's maximum of ${MAX_COLUMNS_PER_TABLE} columns per table`
  };
  warns.forEach(w => {
    const el = document.createElement('div');
    el.className = 'warning-strip';
    el.textContent = warningMessages[w];
    wbox.appendChild(el);
  });

  // disable Add column when at the hard limit
  const addBtn = document.getElementById('add-col-btn');
  addBtn.disabled = state.columns.length >= MAX_COLUMNS_PER_TABLE;
  addBtn.style.opacity = addBtn.disabled ? '0.4' : '';
  addBtn.style.cursor = addBtn.disabled ? 'not-allowed' : '';

  document.getElementById('generate-btn').disabled = errs.length > 0;
}

/* ==================== Generate & download ==================== */

document.getElementById('generate-btn').addEventListener('click', generate);
document.getElementById('add-another-btn').addEventListener('click', () => {
  document.getElementById('success-banner').classList.add('hidden');
  initForm();
  document.getElementById('table-name').focus();
});

function generate() {
  const tableName = document.getElementById('table-name').value.trim();
  const cols = state.columns.map(c => ({ ...c, name: c.name.trim() }));

  if (state.variant === 'erwin-dm-v9') {
    addEntityDMv9(state.doc, tableName, cols);
  } else {
    addEntityClassic(state.doc, tableName, cols);
  }

  // update in-memory dictionary so subsequent adds detect the new table
  state.entityDict.set(tableName.toUpperCase(), tableName);
  renderExistingList();
  document.getElementById('entity-count').textContent = state.entityDict.size.toLocaleString();

  // serialize + download
  let xml = new XMLSerializer().serializeToString(state.doc);
  if (!xml.startsWith('<?xml')) {
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + xml;
  }
  const outName = outputFilename(state.fileName);
  downloadBlob(xml, outName, 'application/xml');

  // roll forward so next generate increments off the new name
  state.fileName = outName;
  document.getElementById('file-name').textContent = outName;

  const banner = document.getElementById('success-banner');
  document.getElementById('success-text').textContent =
    `Added ${tableName} · downloaded ${outName}`;
  banner.classList.remove('hidden');
  banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function outputFilename(input) {
  const m = input.match(/^(.*_[Vv])(\d+)\.xml$/i);
  if (m) {
    const prefix = m[1];
    const num = m[2];
    const nextNum = (parseInt(num, 10) + 1).toString();
    const padded = nextNum.length < num.length ? nextNum.padStart(num.length, '0') : nextNum;
    return `${prefix}${padded}.xml`;
  }
  return `updated_${input}`;
}

function downloadBlob(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ==================== erwin-classic emission ==================== */

function addEntityClassic(doc, tableName, cols) {
  const root = doc.documentElement;
  const entity = doc.createElement('Entity');
  entity.setAttribute('Name', tableName);
  entity.setAttribute('Physical_Name', tableName);

  cols.forEach((c) => {
    const a = doc.createElement('Attribute');
    a.setAttribute('Name', c.name);
    a.setAttribute('Physical_Name', c.name);
    a.setAttribute('Datatype', formatDatatype(c));
    a.setAttribute('Nullable', c.nullable ? 'true' : 'false');
    entity.appendChild(a);
  });

  const pkCols = cols.filter(c => c.pk);
  if (pkCols.length) {
    const kg = doc.createElement('Key_Group');
    kg.setAttribute('Name', `XPK${tableName}`);
    kg.setAttribute('Type', 'PK');
    pkCols.forEach(pk => {
      const ka = doc.createElement('Key_Attribute');
      ka.setAttribute('Name', pk.name);
      kg.appendChild(ka);
    });
    entity.appendChild(kg);
  }
  root.appendChild(entity);
}

/* ==================== erwin-dm-v9 emission ==================== */

function addEntityDMv9(doc, tableName, cols) {
  const container = findDMv9Container(doc);
  if (!container) {
    alert('Could not locate the entity container in this DM-v9 file. Aborting.');
    return;
  }

  const newId = () => `{${crypto.randomUUID().toUpperCase()}}+00000000`;
  const colIds = cols.map(() => newId());
  const entityId = newId();

  const entity = doc.createElementNS(NS.emx, 'EMX:Entity');
  entity.setAttribute('id', entityId);
  entity.setAttribute('name', tableName);

  // -- EntityProps
  const props = doc.createElementNS(NS.emx, 'EMX:EntityProps');
  props.appendChild(emxEl(doc, 'Name', tableName));
  props.appendChild(emxEl(doc, 'Long_Id', entityId));
  props.appendChild(emxEl(doc, 'Type', '1'));
  props.appendChild(emxEl(doc, 'Physical_Name', tableName, { Derived: 'Y' }));
  props.appendChild(emxEl(doc, 'Dependent_Objects_Ref_Array', null, { ReadOnly: 'Y', Derived: 'Y' }));
  props.appendChild(emxEl(doc, 'Do_Not_Generate', 'false', { Derived: 'Y' }));

  const attrOrder = doc.createElementNS(NS.emx, 'EMX:Attributes_Order_Ref_Array');
  colIds.forEach((cid, i) => {
    const ref = doc.createElementNS(NS.emx, 'EMX:Attributes_Order_Ref');
    ref.setAttribute('index', String(i));
    ref.textContent = cid;
    attrOrder.appendChild(ref);
  });
  props.appendChild(attrOrder);

  const physOrder = doc.createElementNS(NS.emx, 'EMX:Physical_Columns_Order_Ref_Array');
  colIds.forEach((cid, i) => {
    const ref = doc.createElementNS(NS.emx, 'EMX:Physical_Columns_Order_Ref');
    ref.setAttribute('index', String(i));
    ref.textContent = cid;
    physOrder.appendChild(ref);
  });
  props.appendChild(physOrder);

  entity.appendChild(props);

  // -- Attribute_Groups
  const attrGroups = doc.createElementNS(NS.emx, 'EMX:Attribute_Groups');
  cols.forEach((col, i) => {
    const attr = doc.createElementNS(NS.emx, 'EMX:Attribute');
    attr.setAttribute('id', colIds[i]);
    attr.setAttribute('name', col.name);

    const ap = doc.createElementNS(NS.emx, 'EMX:AttributeProps');
    ap.appendChild(emxEl(doc, 'Name', col.name));
    ap.appendChild(emxEl(doc, 'Long_Id', colIds[i]));
    ap.appendChild(emxEl(doc, 'Physical_Name', col.name, { Derived: 'Y' }));
    ap.appendChild(emxEl(doc, 'Physical_Data_Type', formatDatatype(col), { Derived: 'Y' }));
    ap.appendChild(emxEl(doc, 'Nullable', col.nullable ? 'true' : 'false'));

    const domainId = pickDomain(col);
    if (domainId) {
      ap.appendChild(emxEl(doc, 'Parent_Domain_Ref', domainId));
    }
    attr.appendChild(ap);
    attrGroups.appendChild(attr);
  });
  entity.appendChild(attrGroups);

  // -- Key groups (PK)
  const pkCols = cols.filter(c => c.pk);
  if (pkCols.length) {
    const kgGroups = doc.createElementNS(NS.emx, 'EMX:Key_Group_Groups');
    const kgId = newId();
    const kg = doc.createElementNS(NS.emx, 'EMX:Key_Group');
    kg.setAttribute('id', kgId);
    kg.setAttribute('name', `XPK${tableName}`);

    const kgp = doc.createElementNS(NS.emx, 'EMX:Key_GroupProps');
    kgp.appendChild(emxEl(doc, 'Name', `XPK${tableName}`));
    kgp.appendChild(emxEl(doc, 'Long_Id', kgId));
    kgp.appendChild(emxEl(doc, 'Key_Group_Type', '1'));

    const kmOrder = doc.createElementNS(NS.emx, 'EMX:Key_Group_Members_Order_Ref_Array');
    const kmIds = pkCols.map(() => newId());
    pkCols.forEach((_, i) => {
      const ref = doc.createElementNS(NS.emx, 'EMX:Key_Group_Members_Order_Ref');
      ref.setAttribute('index', String(i));
      ref.textContent = kmIds[i];
      kmOrder.appendChild(ref);
    });
    kgp.appendChild(kmOrder);
    kg.appendChild(kgp);

    const kmGroups = doc.createElementNS(NS.emx, 'EMX:Key_Group_Member_Groups');
    pkCols.forEach((pk, i) => {
      const km = doc.createElementNS(NS.emx, 'EMX:Key_Group_Member');
      km.setAttribute('id', kmIds[i]);
      const kmp = doc.createElementNS(NS.emx, 'EMX:Key_Group_MemberProps');
      kmp.appendChild(emxEl(doc, 'Long_Id', kmIds[i]));
      const ar = doc.createElementNS(NS.emx, 'EMX:Attribute_Ref');
      ar.textContent = colIds[cols.indexOf(pk)];
      kmp.appendChild(ar);
      km.appendChild(kmp);
      kmGroups.appendChild(km);
    });
    kg.appendChild(kmGroups);
    kgGroups.appendChild(kg);
    entity.appendChild(kgGroups);
  }

  container.appendChild(entity);
}

function emxEl(doc, name, text, attrs) {
  const el = doc.createElementNS(NS.emx, 'EMX:' + name);
  if (text !== null && text !== undefined) el.textContent = text;
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function findDMv9Container(doc) {
  // Expected path: /erwin/UDP_Definition_Groups/Entity_Groups
  const udp = doc.getElementsByTagNameNS(NS.dm, 'UDP_Definition_Groups')[0]
    || doc.getElementsByTagName('UDP_Definition_Groups')[0];
  if (udp) {
    const eg = udp.getElementsByTagNameNS(NS.dm, 'Entity_Groups')[0]
      || udp.getElementsByTagName('Entity_Groups')[0];
    if (eg) return eg;
  }
  // Fallback: parent of the first existing entity
  const first = doc.getElementsByTagNameNS(NS.emx, 'Entity')[0];
  return first ? first.parentNode : null;
}

function pickDomain(col) {
  if (!state.domainMap || !state.domainMap.size) return null;
  let wants = [];
  if (col.type === 'DATE') wants = ['DATE', 'Date', 'Datetime'];
  else if (col.type === 'TIMESTAMP') wants = ['Timestamp', 'TIMESTAMP_TYPE2', 'Datetime', 'DATE'];
  else if (col.type === 'NUMBER') wants = ['NUMBER', 'Number', 'Amount', 'Numeric'];
  else if (col.type === 'VARCHAR2') wants = ['VARCHAR2', 'Code_Alphanumeric_Long', 'String'];
  else if (col.type === 'CHAR') wants = ['CHAR', 'Code_Alphanumeric_Short', 'String'];
  else if (col.type === 'CLOB') wants = ['CLOB', 'Text_Long_Description', 'String'];
  wants.push('<default>', '<root>');
  for (const n of wants) if (state.domainMap.has(n)) return state.domainMap.get(n);
  return state.domainMap.values().next().value || null;
}

function formatDatatype(col) {
  if (col.type === 'VARCHAR2' || col.type === 'CHAR') {
    return col.size ? `${col.type}(${col.size})` : col.type;
  }
  if (col.type === 'NUMBER') {
    if (col.size && col.scale) return `NUMBER(${col.size},${col.scale})`;
    if (col.size) return `NUMBER(${col.size})`;
    return 'NUMBER';
  }
  return col.type;
}
