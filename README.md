# Erwin Data Modeller — Lite

A browser-based companion for [erwin Data Modeler](https://www.erwin.com/products/erwin-data-modeler/) exports. Pick a folder, add or merge entities, and visualise the ER diagram — all client-side, with **OFSAA-compliant** XML generation, no server, no upload, no licence required.

> Supports **classic erwin** and **erwin DM 9.x** (`erwin_Repository`, `EMX:` namespace) XML exports.

---

## Features

| Tab              | What it does                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Add Tables**   | Pick a **preferred folder** (FS Access API on Chrome/Edge, `<input webkitdirectory>` elsewhere) and the latest `.xml` auto-loads. **Recent folders** and **recent files** persist to IndexedDB across sessions. Queue multiple tables manually with strict Oracle identifier validation, or **paste one or many `CREATE TABLE` statements** — single paste fills the form, two-or-more bulk-imports with per-table validation. **Drag-or-keyboard reordering** of columns, **click any existing entity** to inspect its full column list (Column / Type / Nullable / PK / FK), **validate** the model against OFSAA rules without generating, **preview** the would-be XML, **configurable filename pattern** (sequential `v1` / zero-padded `v01` / ISO `date`), then download. Toast queue for rapid generates. |
| **Merge Models** | Load two DM 9.x files as **source** and **target**, diff them (missing tables, missing columns, conflicts), stage changes with an arrow-driven picker, execute the merge into a fresh target XML, and **validate the merged output** before download. |
| **ERD Diagram**  | Auto-layout the model with `dagre`; render an interactive SVG ERD with pan, zoom, hover-to-highlight relationships, and click-to-inspect columns. **Search** entities (debounced; non-matches dim). **Minimap** with a draggable viewport rectangle. Full **keyboard navigation**: `Tab` cycles entities, `+`/`-` zoom, `0` fits, arrows pan (`Shift+arrows` for larger steps). Minimap auto-hides on mobile. |

### App-wide ergonomics

- **Light / dark theme toggle**, with `prefers-color-scheme` default and localStorage persistence.
- **Hotkeys modal** (`?`) lists every keyboard shortcut.
- **WCAG 2.1 AA targets**: focus rings on every interactive element, error/result regions announced via `role="alert"` / `role="status"`, `role="tabpanel"` routing, full keyboard operability.
- **`prefers-reduced-motion`** respected for spinners, transitions, and step animations.
- **Skip-to-main-content** link, semantic `<h1>`, `<noscript>` fallback.
- **`beforeunload` guard** when staged tables would be lost.
- **OFSAA validator** runs as an in-app dry-run with grouped, expandable violations.

---

## Tech Stack

- **React 18** + **TypeScript** (strict mode, `noUnusedLocals`, `noUnusedParameters`)
- **Vite 5** for dev server + build
- **Redux Toolkit 2** + **react-redux 9** for state management
- **Sass (SCSS modules)** for styling
- **@dagrejs/dagre** for graph layout
- **Vitest 2** + **jsdom** for unit tests
- **DOMParser / XMLSerializer / File System Access API** (native browser APIs) — no runtime parsing dependencies

---

## Architecture

The app is a thin React UI over three feature domains. Each feature owns a Redux slice and a services layer; components never touch XML directly.

```mermaid
flowchart TB
    subgraph UI["UI Layer — React Components"]
        direction LR
        App[App.tsx<br/>Tab router · role=tabpanel]
        AddPanel[AddTablePanel]
        MergePanel[MergePanel]
        ErdPanel[ErdPanel]
        Shared["Shared atoms / molecules<br/>Button · Card (collapsible) · Input · Select · Textarea<br/>· Badge · ErwinLogo · ThemeToggle<br/>· FileDrop · FolderPicker · Field · StatTile · TabBar · EmptyState<br/>· ConfirmModal · HotkeysModal · MiniMap<br/>· ValidationPanel · XmlPreviewModal · EntityPropertiesCard"]
    end

    subgraph Hooks["Feature Hooks — selectors + dispatchers"]
        useAddTable
        useMerge
        useErd
        useTheme
    end

    subgraph Store["Redux Store"]
        direction LR
        addTableSlice[addTableSlice<br/>folder · recents · loadFile · staging · finalize<br/>· bulk DDL · validate · preview · generate · success queue<br/>· filenamePattern]
        mergeSlice[mergeSlice<br/>loadSlot · compute · execute · validate]
        erdSlice[erdSlice<br/>loadFile]
    end

    subgraph Services["Services Layer — pure TS"]
        folder[folder/folderScan<br/>pickDirectory · filterXml · sortLatest]
        idb[folder/db + recentFolders + recentFiles<br/>IndexedDB-backed recents]
        parser[xml/parser<br/>DOMParser + variant detection]
        emitter[xml/emitter<br/>OFSAA-compliant DM v9]
        validator[xml/validator<br/>validateOfsaaXml]
        modelSvc[xml/model<br/>FullModel]
        serialize[xml/serialize<br/>OFSAA prolog · generateNextFileName]
        diff[merge/diff<br/>computePlan]
        execute[merge/execute<br/>executeMerge]
        ddl[ddl/ddlParser<br/>parseOracleDdl · parseOracleDdlMulti]
        oracle[ddl/oracleParser<br/>identifier + size validation]
        layout[erd/layout<br/>dagre adapter]
    end

    subgraph Refs["Ref Store (non-serializable)"]
        refs[store/refs.ts<br/>XMLDocument · File · DirectoryHandle]
    end

    App --> AddPanel & MergePanel & ErdPanel
    AddPanel --> Shared
    MergePanel --> Shared
    ErdPanel --> Shared

    AddPanel --> useAddTable
    MergePanel --> useMerge
    ErdPanel --> useErd
    App --> useTheme

    useAddTable --> addTableSlice
    useMerge --> mergeSlice
    useErd --> erdSlice

    addTableSlice --> folder
    addTableSlice --> idb
    addTableSlice --> parser
    addTableSlice --> ddl
    addTableSlice --> emitter
    addTableSlice --> validator
    addTableSlice --> serialize
    addTableSlice -.parseId / fileId.-> refs
    mergeSlice --> parser
    mergeSlice --> modelSvc
    mergeSlice --> diff
    mergeSlice --> execute
    mergeSlice --> validator
    erdSlice --> parser
    erdSlice --> modelSvc
    erdSlice --> layout

    emitter --> oracle
    emitter -.optional.-> validator
    ddl --> oracle
```

### Data flow — Add Tables (multi-table workflow)

```mermaid
sequenceDiagram
    participant User
    participant FolderPicker
    participant useAddTable
    participant addTableSlice as addTableSlice<br/>(thunks + reducers)
    participant IDB as IndexedDB<br/>(folders + files)
    participant Refs as Ref Store
    participant parser
    participant ddl as ddlParser
    participant emitter
    participant validator

    rect rgba(0, 100, 200, 0.05)
        Note over User: Step 1 — Source the model
        alt Pick folder (or restore recent)
            User->>FolderPicker: Set preferred folder / pick recent
            FolderPicker->>addTableSlice: dispatch(pickFolder | useRecentFolder | useRecentFile)
            addTableSlice->>IDB: saveRecentFolder + saveRecentFile
            addTableSlice->>Refs: store File handles + DirectoryHandle
            addTableSlice->>parser: parseFile(latest)
            parser-->>addTableSlice: {doc, entityDict, domainMap, variant}
            addTableSlice->>Refs: setParsedDoc(parseId, doc)
        else Drop a single file
            User->>FolderPicker: drag-drop XML
            FolderPicker->>addTableSlice: dispatch(loadFile)
        end
    end

    rect rgba(0, 100, 200, 0.05)
        Note over User: Step 3 — Stage tables (manual OR bulk)
        alt Manual form entry
            loop for each new table
                User->>useAddTable: fill name + columns, click Add table
                useAddTable->>addTableSlice: dispatch(commitTable)
                addTableSlice->>addTableSlice: validate + append to stagedTables
            end
        else Paste DDL
            User->>useAddTable: paste CREATE TABLE statements
            useAddTable->>ddl: parseOracleDdlMulti(text)
            ddl-->>useAddTable: {tables, parseErrors}
            alt one statement
                useAddTable->>addTableSlice: replaceColumns + setTableName (fills form)
            else two or more
                useAddTable->>addTableSlice: dispatch(bulkStageTables)
                addTableSlice->>addTableSlice: validate each (dedupe, identifier, sizes)<br/>append valid + record bulkImport result
            end
        end
    end

    rect rgba(0, 100, 200, 0.05)
        Note over User: Step 5 — Validate · Preview · Generate
        opt Validate
            User->>useAddTable: click Validate model
            useAddTable->>addTableSlice: dispatch(validateModel)
            addTableSlice->>emitter: clone + addEntityDMv9 (in-memory)
            addTableSlice->>validator: validateOfsaaXml(serialized)
            validator-->>addTableSlice: ok / grouped violations
        end
        opt Preview
            User->>useAddTable: click Preview XML
            useAddTable->>addTableSlice: dispatch(previewXml)
            addTableSlice-->>User: open XmlPreviewModal (Copy / Download)
        end
        User->>useAddTable: click Finalize → click Generate XML
        useAddTable->>addTableSlice: dispatch(generate)
        addTableSlice->>Refs: getParsedDoc(parseId)
        loop for each staged table
            addTableSlice->>emitter: addEntityDMv9(doc, name, cols, domainMap)
        end
        addTableSlice->>addTableSlice: serializeDoc + generateNextFileName(pattern)
        addTableSlice->>User: download augmented XML<br/>(success appended to toast queue)
    end
```

### Data flow — Merge Models

Two DM 9.x files are loaded into separate slots, diffed in memory, picked over with an arrow-driven UI, then merged into a fresh parse of the target so the source is never trusted for object identity.

```mermaid
sequenceDiagram
    participant User
    participant FileDrop
    participant useMerge
    participant mergeSlice
    participant parser
    participant modelSvc as model<br/>(collectFullModel)
    participant diff
    participant execute as execute<br/>(executeMerge)

    Note over User: Step 1 — load source and target
    User->>FileDrop: drop source XML
    FileDrop->>mergeSlice: dispatch(loadSlot source)
    mergeSlice->>parser: parseFile
    parser-->>mergeSlice: doc + variant
    mergeSlice->>modelSvc: collectFullModel(doc)
    modelSvc-->>mergeSlice: FullModel (entities, domains)
    User->>FileDrop: drop target XML
    FileDrop->>mergeSlice: dispatch(loadSlot target)
    mergeSlice->>modelSvc: collectFullModel(doc)

    Note over User: Step 2 — compute the plan
    User->>useMerge: click Compute
    useMerge->>mergeSlice: dispatch(compute)
    mergeSlice->>diff: computePlan(source, target)
    diff-->>mergeSlice: tablesMissing + columnsMissing + conflicts

    loop arrow-driven picker
        User->>useMerge: move row pending to staged
        useMerge->>mergeSlice: dispatch(moveRow)
    end

    Note over User: Step 3 — execute the merge
    User->>useMerge: click Execute
    useMerge->>mergeSlice: dispatch(execute)
    mergeSlice->>execute: executeMerge(source, targetXml, staged)
    execute-->>mergeSlice: MergeReport (xml, actions, warnings)
    mergeSlice->>User: download XML + report
```

### Data flow — ERD Diagram

Single-file load. The slice runs three pure transforms in order — model projection, relationship extraction, dagre layout — and the panel renders the result as an interactive SVG.

```mermaid
sequenceDiagram
    participant User
    participant FileDrop
    participant useErd
    participant erdSlice
    participant parser
    participant modelSvc as model<br/>(collectFullModel)
    participant rel as relationships<br/>(collectRelationships)
    participant layout as layout<br/>(dagre adapter)
    participant ErdViewport

    User->>FileDrop: drop DM v9 XML
    FileDrop->>erdSlice: dispatch(loadFile)
    erdSlice->>parser: parseFile
    parser-->>erdSlice: doc + variant
    erdSlice->>modelSvc: collectFullModel(doc)
    modelSvc-->>erdSlice: entities + domains
    erdSlice->>rel: collectRelationships(doc)
    rel-->>erdSlice: relationship list (parent and child GUIDs)
    erdSlice->>layout: computeLayout(entities, relationships)
    layout-->>erdSlice: nodes (positions) + edges (routes)
    erdSlice-->>useErd: ErdData

    User->>ErdViewport: pan, zoom, hover an entity
    ErdViewport->>useErd: highlighted edge ids
    useErd-->>ErdViewport: re-render with edge highlights
```

### Why a ref store?

Three classes of artifact can't safely live in Redux state:

1. **`XMLDocument`** is mutated **in place** by the emitter so subsequent edits roll forward without losing formatting. Immer's auto-freeze would break this on the second edit.
2. **`File` handles** picked from a folder need to survive between scan-time and load-time but aren't structured-cloneable.
3. **`FileSystemDirectoryHandle`** (FS Access API) is the key to "Refresh folder" without re-prompting and is also non-cloneable.

The fix: keep all three in a module-scoped store at [src/store/refs.ts](src/store/refs.ts), keyed by stable ids the slice can reference. Redux holds only serializable metadata (filenames, variants, ids, `Map<string,string>` indexes). Immer's `enableMapSet()` lets the Map values live inside slice state safely.

---

## OFSAA Compliance

The OFSAA Data Model uploader is sensitive to a fixed set of structural rules in erwin DM v9 XML. Failing any of them produces silent misgeneration or `ORA-00904: invalid identifier` at upload time. The emitter enforces every rule; an independent validator can re-check any generated XML before it's handed to OFSAA.

| Rule | Enforced where | What it covers |
| ---- | -------------- | --------------- |
| 1 | [serialize.ts](src/services/xml/serialize.ts) | XML declaration `standalone="no"`, `<erwin>` root, namespace declarations |
| 2 | [emitter.ts](src/services/xml/emitter.ts) `newGuid()` | `Long_Id` format `{UUID}+00000000`, global uniqueness |
| 3 | emitter `addEntityDMv9` EntityProps | Required field set in prescribed order, ordering arrays match column count |
| 4 | emitter AttributeProps | All required fields, `Null_Option_Type` (no `<Nullable>`) |
| 5 | emitter `logicalDatatype()` | Logical/physical type mapping; throws on unknown |
| 6 | emitter `assertOfsaaIdentifier()` | 30-char cap, `[A-Za-z0-9_]`, no reserved words |
| 7 | emitter Key_Group | Exactly one PK group, `Key_Group_Type="PK"`, XPK&lt;table&gt; uniqueness |
| 8 | emitter | `Derived="Y"` / `ReadOnly="Y"` attribute presence |
| 9 | [validator.ts](src/services/xml/validator.ts) | Cross-reference integrity (ordering refs, `Attribute_Ref`, `Parent_Domain_Ref`) |
| 10 | emitter + validator | `Do_Not_Generate=false` for emitted entities |

The validator is callable independently:

```ts
import { validateOfsaaXml } from "@/services/xml/validator";

const result = validateOfsaaXml(xmlString);
if (!result.ok) {
  for (const v of result.violations) {
    console.error(`[${v.rule}] ${v.entity ?? ""} ${v.field ?? ""}: ${v.message}`);
  }
}
```

10 unit tests in [src/services/xml/\_\_tests\_\_/ofsaa.test.ts](src/services/xml/__tests__/ofsaa.test.ts) cover both happy-path emission and each individual rule violation. The full Vitest suite (57 tests at the time of writing) also exercises the DDL parser, the filename-pattern variants, the hotkeys modal, and the custom Select.

---

## Project Structure

```
src/
├── App.tsx · App.module.scss     # tab router · role=tabpanel routing
├── main.tsx                      # React root — Provider + enableMapSet
├── CONSTANTS/                    # i18n strings for every tab
├── store/
│   ├── index.ts                  # configureStore + typed hooks
│   └── refs.ts                   # XMLDocument · File · DirectoryHandle store
├── features/
│   ├── addTable/
│   │   ├── addTableSlice.ts      # folder + recents + load + DDL bulk
│   │   │                         #   + staging + finalize + validate + preview
│   │   │                         #   + generate + success queue + filenamePattern
│   │   ├── useAddTable.ts        # hook wrapper
│   │   └── validation.ts         # form-level Oracle identifier checks
│   ├── merge/
│   │   ├── mergeSlice.ts         # loadSlot thunk + compute/execute/validate
│   │   └── useMerge.ts
│   ├── erd/
│   │   ├── erdSlice.ts           # loadFile thunk
│   │   ├── useErd.ts
│   │   └── layout.ts             # dagre adapter
│   └── theme/useTheme.ts         # light/dark + prefers-color-scheme + localStorage
├── services/
│   ├── ddl/
│   │   ├── ddlParser.ts          # parseOracleDdl + parseOracleDdlMulti
│   │   │                         #   (quoted ids, named PK constraints, CHAR/BYTE)
│   │   ├── oracleParser.ts       # Oracle identifier + size/scale rules
│   │   └── __tests__/ddlParser.test.ts  # 18 parser cases
│   ├── folder/
│   │   ├── folderScan.ts         # pickDirectory · filter · sort · rescan
│   │   ├── db.ts                 # shared IndexedDB v2 (folders + files stores)
│   │   ├── recentFolders.ts      # IDB-backed recent folders (handle + name + ts)
│   │   └── recentFiles.ts        # IDB-backed recent files (folderId + filename)
│   └── xml/
│       ├── parser.ts             # DOMParser + variant detection
│       ├── emitter.ts            # OFSAA-compliant addEntityDMv9 (+ classic)
│       ├── validator.ts          # validateOfsaaXml — standalone rule checker
│       ├── serialize.ts          # OFSAA prolog + generateNextFileName(pattern)
│       ├── model.ts              # FullModel projection
│       ├── namespaces.ts         # dm / emx namespace URIs
│       ├── relationships.ts      # DM 9.x Relationship extraction
│       ├── __tests__/
│       │   ├── ofsaa.test.ts             # 10 OFSAA rule tests
│       │   └── generateNextFileName.test.ts  # 18 filename-pattern tests
│       └── merge/
│           ├── diff.ts           # computePlan
│           ├── execute.ts        # executeMerge (fresh-parse target)
│           └── types.ts
├── components/
│   ├── atoms/                    # Badge · Button · Card (collapsible · stepState)
│   │                             #   · ErwinLogo · Input (kind="text|code")
│   │                             #   · Select (combobox/listbox + type-ahead)
│   │                             #   · Textarea · ThemeToggle
│   ├── molecules/                # ConfirmModal · EmptyState · EntityPropertiesCard
│   │                             #   · Field · FileDrop · FolderPicker · HotkeysModal
│   │                             #   · MiniMap · StatTile · TabBar (id + aria-controls)
│   │                             #   · ValidationPanel · XmlPreviewModal
│   └── organisms/                # AddTablePanel · MergePanel · ErdPanel (+ ErdEntity
│                                 #   · ErdEdge · ErdViewport with keyboard pan/zoom)
├── layout/                       # AppShell (+ skip link) · TopBar (h1 + theme) · Footer
├── utils/download.ts             # Blob download helper
└── styles/                       # SCSS tokens, reset, mixins, global
                                  #   (interpolate-size + ::details-content animation)
```

---

## Getting Started

### Prerequisites

- **Node.js** 20 or newer (18 still works but is end-of-life)
- **npm** 9 or newer

### Install

```bash
npm install
```

### Run the dev server

```bash
npm run dev
```

Vite serves on `http://localhost:5173` by default.

### Type-check

```bash
npm run typecheck
```

### Run tests

```bash
npm run test        # watch mode
npm run test:run    # single CI-style run
```

### Production build

```bash
npm run build
npm run preview     # serve the built assets locally
```

---

## Supported XML Variants

The parser auto-detects which variant you uploaded:

| Variant         | Detection rule                                                       | Features supported            |
| --------------- | -------------------------------------------------------------------- | ----------------------------- |
| `erwin-dm-v9`   | Root `<erwin>` with `Format="erwin_Repository"` and `EMX:` namespace | Add Tables, Merge, ERD        |
| `erwin-classic` | Root has non-EMX `<Entity>` children                                 | Add Tables only               |
| `unknown`       | Neither pattern matches                                              | Rejected with a parse error   |

**Merge**, **ERD Diagram**, and **OFSAA-compliant emission** require `erwin-dm-v9` because they rely on `EMX:Domain`, `EMX:AttributeProps`, and `EMX:Relationship` nodes that only exist in the DM 9.x schema.

---

## Browser Support

| Browser | Drop a single XML | Pick a preferred folder | Refresh folder without re-prompt |
| ------- | :---------------: | :---------------------: | :------------------------------: |
| Chrome / Edge / Opera | ✅ | ✅ (FS Access API) | ✅ |
| Firefox | ✅ | ✅ (`<input webkitdirectory>` fallback) | — re-pick to refresh |
| Safari  | ✅ | ✅ (`<input webkitdirectory>` fallback) | — re-pick to refresh |

The fallback path is fully functional but can't refresh without re-prompting because Firefox/Safari don't yet expose persistent directory handles.

---

## Design Notes

- **Client-side only.** No server, no backend, no telemetry. The file never leaves the browser — `parseFile` reads it with the File API and all mutation happens on an in-memory `XMLDocument`.
- **Atomic design.** Components are split into atoms (primitive UI), molecules (composed primitives), and organisms (feature panels). Feature logic lives in the `features/` tree, not in components.
- **Pure services.** Everything under `services/` is framework-agnostic TypeScript — no React, no Redux. This keeps the XML/DDL logic independently testable and reusable.
- **Strict, layered validation.** [`oracleParser.ts`](src/services/ddl/oracleParser.ts) backs the form-level checks; [`emitter.ts`](src/services/xml/emitter.ts) re-validates with stricter OFSAA rules at emission time; [`validator.ts`](src/services/xml/validator.ts) re-checks the serialized output as a third gate.
- **Multi-table finalization gate.** "Generate XML" is intentionally disabled until the user explicitly finalizes the model, so accidental partial emissions are impossible.
- **No source-GUID reuse.** When merging, `executeMerge` mints fresh GUIDs for every copied attribute and resolves domain references by name against the target's library. The source is never trusted for identity.

---

## License

Unlicensed / internal. Contact the repository owner for use.
