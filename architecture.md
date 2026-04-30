# Erwin Data Modeller — Lite: Architecture

## 1. Problem

Working with [erwin Data Modeler](https://www.erwin.com/products/erwin-data-modeler/) XML exports is heavier than it needs to be for everyday tasks:

- **Licence + install friction.** Just to add a table or look at an ER diagram, a teammate needs the full erwin desktop app, a paid licence, and a Windows machine.
- **OFSAA upload failures.** The OFSAA Data Model uploader is strict about XML structure. Models edited by hand or by ad-hoc scripts often fail with `ORA-00904: invalid identifier` or — worse — load silently with missing tables.
- **No quick "look-and-pick" workflow.** Comparing two model versions, picking which new tables/columns to copy across, or grabbing the latest model from a shared folder all required a full round-trip through the desktop tool.
- **No model visualisation outside erwin.** Understanding an unfamiliar model meant either opening it in erwin or reading raw XML.

## 2. Purpose

Build a small, browser-only tool that handles the **80% of erwin XML tasks** that don't need the full desktop app, and that produces XML the OFSAA uploader will accept on the first try.

Concrete outcomes:

- A reviewer can drop an XML file into a browser tab and see the model.
- An engineer can queue several new tables and export an OFSAA-compliant XML in one click.
- A modeller can merge two model versions through a visible, controllable diff.
- The output XML never has the structural defects that cause OFSAA `ORA-00904` errors.

## 3. Solution

### Legacy approach (what we replaced)

| Concern | Legacy state |
| --- | --- |
| Adding a table | Open erwin Data Modeler → make change → export XML → hope OFSAA accepts it |
| Looking at an ERD | Open erwin Data Modeler |
| Merging two models | Manual XML editing or erwin's own merge dialog |
| OFSAA compliance | Caught only at upload time, by an opaque error |
| Validating output | No deterministic check before upload |
| Sharing the tool | Each user needs an erwin install + licence |

### Current approach: Erwin Data Modeller — Lite

A single-page React app that runs entirely in the browser.

| Concern | Lite |
| --- | --- |
| Adding a table | A web form. Queue several tables, finalize, download a fresh XML |
| Looking at an ERD | Drop the XML on the ERD tab. Auto-laid-out interactive diagram |
| Merging two models | Two-slot drop zone, plan computed in memory, arrow-driven picker, executed against a fresh re-parse of the target |
| OFSAA compliance | Enforced in three layers: form-level checks, emitter rules, and a standalone validator |
| Validating output | `validateOfsaaXml(xml)` is a pure function. 10 unit tests cover the rule set |
| Sharing the tool | Open a URL — no install, no licence, no upload to a third party |

### Why this approach was chosen

- **No backend.** The XML never leaves the user's browser. Easier deployment (any static host), no data-handling concerns, fast response.
- **No install for users.** Lowest possible friction for occasional contributors.
- **Deterministic, testable XML output.** Every OFSAA rule is enforced by code that is unit-tested. New rules become new tests, not tribal knowledge.
- **Layered architecture.** UI, state, and XML services are independent — the OFSAA emitter and validator are reusable from any other tool.
- **Cheap to extend.** Adding a fourth tab (e.g. a domain editor) is a self-contained slice + panel pair. No central registry to fight.

## 4. Architecture

### Diagram

```mermaid
flowchart TB
    User([User])

    subgraph UI["UI — React Components"]
        Tabs[Tab router]
        AddPanel[Add Tables panel]
        MergePanel[Merge Models panel]
        ErdPanel[ERD Diagram panel]
        Picker[FolderPicker · FileDrop]
    end

    subgraph State["State — Redux Toolkit"]
        Hooks[useAddTable · useMerge · useErd]
        Slices[addTableSlice · mergeSlice · erdSlice]
    end

    subgraph Services["Services — pure TypeScript"]
        Folder[folder/folderScan<br/>pick + filter + sort .xml]
        Parser[xml/parser<br/>read XML]
        Model[xml/model + merge/diff<br/>structure model and compute plan]
        Emitter[xml/emitter<br/>OFSAA-compliant writer]
        Validator[xml/validator<br/>validateOfsaaXml]
        Layout[erd/layout<br/>auto-layout via dagre]
        Oracle[ddl/oracleParser<br/>identifier rules]
    end

    Refs[(Ref Store<br/>XMLDocument · File · DirectoryHandle)]

    Browser[Browser download]

    User --> Tabs
    Tabs --> AddPanel & MergePanel & ErdPanel
    AddPanel --> Picker
    MergePanel --> Picker
    ErdPanel --> Picker

    AddPanel --> Hooks
    MergePanel --> Hooks
    ErdPanel --> Hooks
    Hooks --> Slices

    Slices --> Folder
    Slices --> Parser
    Slices --> Model
    Slices --> Emitter
    Slices --> Layout
    Slices -.parseId / fileId.-> Refs
    Emitter --> Oracle
    Emitter -.optional check.-> Validator

    Slices --> Browser
```

### Components

- **UI (React).** Pure presentation. The three feature panels render Redux state and call hook actions. No XML or business logic lives here.
- **Feature hooks (`useAddTable`, `useMerge`, `useErd`).** Thin wrappers around Redux selectors and dispatchers. Components import these instead of touching the store directly.
- **Slices (Redux Toolkit).** One per feature. Hold serializable state, expose actions and async "thunks" (functions that orchestrate side-effects like parsing or downloading).
- **Services (pure TypeScript).** Framework-agnostic logic:
  - `folder/folderScan` — pick a directory, list files, sort newest-first.
  - `xml/parser` — turn a file into a parsed XML document.
  - `xml/model` and `merge/diff` — extract a structured model and compute what differs between two of them.
  - `xml/emitter` — write OFSAA-compliant XML for a new entity.
  - `xml/validator` — re-check serialized XML against the OFSAA rule set.
  - `erd/layout` — turn entities + relationships into node positions and edge routes via the `dagre` library.
  - `ddl/oracleParser` — Oracle identifier and column-size rules.
- **Ref store (`src/store/refs.ts`).** A small in-memory map for things Redux can't safely hold: the XML `Document` (mutated in place by the emitter), `File` objects from a folder pick, and the `DirectoryHandle` for the "Refresh folder" button.
- **Browser download.** Final XML is offered to the user via a generated `Blob` URL — no server is involved.

### How they interact (concrete example)

1. User picks a folder. The slice asks `folderScan` to list `.xml` files newest-first, stores the `File` objects in the ref store, and parses the latest one.
2. User queues two new tables in the form. Each one is validated and pushed to a `stagedTables` array in the slice.
3. User clicks **Finalize Model**. The slice flips an `isFinalized` flag; the form locks; **Generate XML** unlocks.
4. User clicks **Generate XML**. The slice retrieves the `Document` from the ref store, walks `stagedTables`, calls `emitter.addEntityDMv9` for each, then serializes and downloads the file.

## 5. Use Cases

- **Add several tables to a model and ship to OFSAA.** Pick the model folder, queue tables one at a time, finalize, download the augmented XML.
- **Merge a dev branch's model into prod.** Drop dev as source and prod as target, click Compute, move the new tables and columns into the staged pane, click Execute, download the merged XML and report.
- **Spot-check an unfamiliar model.** Drop the XML into the ERD tab. Pan, zoom, and hover to see relationships.
- **Verify that a third-party pipeline produced OFSAA-valid XML.** Call `validateOfsaaXml(xml)` from a Node script or test, get back a structured violation list with rule, entity, column, and message.
- **Always work against the latest export.** Use the preferred-folder picker so the latest `.xml` file is auto-selected on each visit.
- **Catch reserved-word column names before upload.** Typing `SELECT` as a column name fails at form submit, not at OFSAA upload time.

## 6. Weaknesses & Limitations

- **No cross-session persistence.** Closing the tab loses the picked folder handle and any staged tables. Every visit starts blank.
- **In-memory only.** Very large XMLs (hundreds of MB) may slow the browser since the whole `Document` lives in memory.
- **DM v9 only for advanced features.** Merge and ERD require the `erwin-dm-v9` schema. Classic erwin XML can only use the basic Add Tables flow.
- **No drag-to-reposition in the ERD.** Layout is fully automatic via `dagre`; users can't tweak positions or save a custom view.
- **No undo / redo.** Deleting a staged table or unfinalizing the model is one-way.
- **Subject area / description is UI-only.** The optional description field is shown in the staged-tables list but never written to the XML.
- **Refresh-without-reprompt is Chrome/Edge only.** Firefox and Safari fall back to an HTML directory input that can't be re-iterated; users have to re-pick the folder to refresh.
- **Single-user.** No live collaboration, no shared model registry, no comments or review trails.
- **Validator runs on demand, not in CI.** The OFSAA validator is callable from tests but isn't wired into a pre-commit or pre-deploy gate by default.
- **No backend means no integrations.** Cannot push to a model repository, post a Slack notification, or pull from a versioned model store.

## 7. Future Improvements

- **Persistence.**
  - Remember the last preferred folder via IndexedDB (FS Access API handles are structured-cloneable).
  - Auto-save staged tables and the form draft to local storage; restore on reopen.
- **Performance.**
  - Move XML parsing and validation off the main thread into a Web Worker so very large models stay responsive.
- **ERD usability.**
  - Manual repositioning of entities with persisted positions.
  - "Focus on entity" mode that hides unrelated tables.
  - Search-and-zoom by entity name.
- **Emission gaps.**
  - Write the description field into a real `EMX:Subject_Area` element (or as a comment) so it survives a round-trip back to erwin.
  - Support emission of foreign-key relationships, not just entity blocks.
- **Validation surface.**
  - Live "what will be generated" preview in the UI, with the validator running in the background.
  - A CLI wrapper around `validateOfsaaXml` so it can run in CI against build artifacts from other tools.
- **Workflow features.**
  - Undo / redo for staging actions.
  - Per-table edit history visible in the staged-tables card.
  - Side-by-side diff of the generated XML against the source.
- **Reach.**
  - Backend-optional mode: optionally save sessions to a small server so a team can pick up where another teammate left off.
  - Full classic-erwin support in Merge and ERD, not just DM v9.
