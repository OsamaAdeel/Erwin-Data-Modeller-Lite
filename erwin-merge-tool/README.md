# erwin Model Merge

A local web tool that merges tables and columns from a **source** `erwin-dm-v9`
XML model into a **target** `erwin-dm-v9` XML model by clicking arrows on the
items you want moved across.

The merge is **one-way and additive**: nothing in the target is removed, and
existing target columns are only modified when you explicitly opt in on the
conflicts panel.

## Run it

```bash
pip install -r requirements.txt
python app.py
```

Then open <http://localhost:5055>.

Binds to `127.0.0.1` only. Max upload size is 256 MB.

## File layout

```
erwin-merge-tool/
├── app.py              # Flask app: routes, session store, downloads
├── merge_core.py       # lxml-based parse / diff / merge for erwin-dm-v9
├── templates/
│   └── index.html      # Single-page UI
├── static/
│   ├── app.js          # Drop-zones, arrow-picker, keyboard shortcuts
│   └── styles.css      # Offline styles (system fonts, no CDN)
├── requirements.txt    # flask, lxml, pyyaml
└── README.md           # You are here
```

## How it works

1. **Load** — drop a SOURCE and TARGET XML. Each file is POSTed to
   `/api/load` and parsed with `lxml.etree` using
   `XMLParser(remove_blank_text=False, huge_tree=True)` so 100 MB+ models
   round-trip intact. Variant detection follows the `erwin-xml-merge`
   skill's rule: root `<erwin Format="erwin_Repository">` → `erwin-dm-v9`.
   Non-v9 files are refused with an inline error.
2. **Compute plan** — `/api/plan` diffs the models case-insensitively and
   returns three lists:
   - `tables_missing_in_target`
   - `columns_missing_in_target` (for tables present in both)
   - `conflicts` — column datatype/nullability/domain/PK disagreement,
     table name case mismatch, or source column referencing a domain name
     the target's domain library doesn't have.
3. **Pick** — the arrow-picker has PENDING on the left, STAGED on the
   right. Click a row and press **→** / **Enter** (or use the row's arrow
   button) to stage it; **←** / **Shift+Enter** to move it back. A table
   row carries its columns implicitly; column rows in the PENDING pane
   belong only to tables that already exist in the target.
   - Conflicts live in a yellow panel at the bottom and are disabled until
     you tick *Show conflicts (advanced)*. "Override target" requires a
     confirmation dialog.
4. **Execute** — `/api/merge` re-parses the target from bytes (never from
   the cached dict), appends new entities/columns with fresh GUIDs, and
   resolves source domain references by NAME against the target's domain
   map. Fallback when the name doesn't match: `NUMBER*` → `Amount`,
   `VARCHAR*`/`CHAR*` → `Code_Alphanumeric_Long`, `DATE*` → `DATE`, else
   `<default>` — every fallback is logged in the report.
   - Duplicate-table collision raises the exact error the skill does:
     `Table <name> already exists in the ERwin model` — the whole merge
     aborts and the target is untouched.
   - Output is serialized and re-parsed before being returned, so a
     broken tree can't be downloaded.
5. **Download** — merged XML + `MERGE_REPORT.txt`. Filename rule:
   `target_V<N>.xml` → `target_V<N+1>.xml`, else `updated_<target>`.

## Session state

A cookie (`emerge_sid`, `httponly`, `samesite=Lax`) indexes a
module-level dict. Entries are evicted after **1 hour** of inactivity by a
background thread. No database.

## Acceptance tests — manual walkthrough

1. **No-op.** Drop the same file on both sides. Expect the green banner
   *"✓ Target already contains everything in source — nothing to merge"*
   and Execute disabled.
2. **New table.** Source has one extra entity. PENDING shows one table
   row. Click →, Execute. Download the merged XML — entity count = old
   target + 1.
3. **New column.** Source has one extra column on a shared entity. Stage
   just that column. Download and open the XML — the attribute is present
   with a fresh `{UUID}+00000000` id and the three order arrays
   (`Attributes_Order_Ref_Array`, `Physical_Columns_Order_Ref_Array`,
   `Columns_Order_Ref_Array`) reference it.
4. **Conflict.** A shared column with a different datatype appears in
   the yellow CONFLICTS section only. It's ignored unless you tick
   *Show conflicts (advanced)* and choose *Override target with source*.
5. **Non-v9 file.** Dropping a non-erwin XML shows an inline error and
   does not update state.
6. **Well-formedness.** Open the downloaded XML with any XML validator —
   it re-parses cleanly. (The server also re-parses before returning.)
