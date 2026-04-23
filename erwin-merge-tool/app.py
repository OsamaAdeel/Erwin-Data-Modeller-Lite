"""
erwin model merge tool — local Flask app.

Run:
    pip install -r requirements.txt
    python app.py
    # then open http://localhost:5055
"""

from __future__ import annotations

import io
import os
import secrets
import threading
import time
import uuid
from typing import Dict, Optional

from flask import (
    Flask,
    abort,
    jsonify,
    make_response,
    render_template,
    request,
    send_file,
)

import merge_core as mc


# ---------------------------------------------------------------------------
# App + session store
# ---------------------------------------------------------------------------
app = Flask(__name__, static_url_path="/static", static_folder="static")

# Accept large uploads. erwin models can be 100 MB+; cap at 256 MB.
app.config["MAX_CONTENT_LENGTH"] = 256 * 1024 * 1024

SESSION_COOKIE = "emerge_sid"
SESSION_TTL = 60 * 60  # 1 hour idle timeout

# { session_id: {
#       "touched": <unix_ts>,
#       "source": Model or None,
#       "source_bytes": bytes or None,
#       "target": Model or None,
#       "target_bytes": bytes or None,
#       "downloads": { token: (filename, bytes, mimetype) },
#   } }
_STORE: Dict[str, dict] = {}
_STORE_LOCK = threading.Lock()


def _get_or_create_session(req, resp) -> str:
    sid = req.cookies.get(SESSION_COOKIE)
    if not sid:
        sid = secrets.token_urlsafe(24)
        resp.set_cookie(SESSION_COOKIE, sid, httponly=True, samesite="Lax")
    with _STORE_LOCK:
        entry = _STORE.get(sid)
        if entry is None:
            entry = {
                "touched": time.time(),
                "source": None,
                "source_bytes": None,
                "target": None,
                "target_bytes": None,
                "downloads": {},
            }
            _STORE[sid] = entry
        else:
            entry["touched"] = time.time()
    return sid


def _evictor():
    while True:
        time.sleep(300)
        cutoff = time.time() - SESSION_TTL
        with _STORE_LOCK:
            stale = [sid for sid, e in _STORE.items() if e["touched"] < cutoff]
            for sid in stale:
                _STORE.pop(sid, None)


threading.Thread(target=_evictor, daemon=True).start()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    resp = make_response(render_template("index.html"))
    _get_or_create_session(request, resp)
    return resp


@app.post("/api/load")
def api_load():
    resp = make_response()  # placeholder; replaced below
    role = (request.form.get("role") or "").strip().lower()
    if role not in ("source", "target"):
        return jsonify({"ok": False, "error": "role must be 'source' or 'target'."}), 400

    file = request.files.get("file")
    if file is None or not file.filename:
        return jsonify({"ok": False, "error": "No file uploaded."}), 400

    data = file.read()
    if not data:
        return jsonify({"ok": False, "error": "Uploaded file is empty."}), 400

    # Quick cheap variant probe so we can return a clean error before
    # streaming the whole summary.
    try:
        model = mc.load_model(data, file.filename)
    except mc.MergeError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:  # pragma: no cover — lxml parse errors, etc.
        return jsonify({"ok": False, "error": f"Could not parse XML: {exc}"}), 400

    resp = make_response(jsonify({"ok": True, **mc.model_summary_json(model, role)}))
    sid = _get_or_create_session(request, resp)
    with _STORE_LOCK:
        entry = _STORE[sid]
        entry[role] = model
        entry[f"{role}_bytes"] = data
    return resp


@app.post("/api/plan")
def api_plan():
    resp = make_response()
    sid = _get_or_create_session(request, resp)
    with _STORE_LOCK:
        entry = _STORE[sid]
        source = entry.get("source")
        target = entry.get("target")
    if source is None or target is None:
        return jsonify({
            "ok": False,
            "error": "Load both a source and a target file first.",
        }), 400
    plan = mc.compute_plan(source, target)
    payload = {"ok": True, **plan,
               "source_filename": source.filename,
               "target_filename": target.filename}
    out = make_response(jsonify(payload))
    _get_or_create_session(request, out)
    return out


@app.post("/api/merge")
def api_merge():
    resp = make_response()
    sid = _get_or_create_session(request, resp)
    with _STORE_LOCK:
        entry = _STORE[sid]
        source = entry.get("source")
        target_bytes = entry.get("target_bytes")
        target_filename = entry.get("target").filename if entry.get("target") else None
    if source is None or target_bytes is None:
        return jsonify({
            "ok": False,
            "error": "Load both a source and a target file first.",
        }), 400

    body = request.get_json(silent=True) or {}
    staged_tables = [str(n).upper() for n in body.get("tables", [])]
    staged_columns = [
        {"table": str(x.get("table", "")), "column": str(x.get("column", ""))}
        for x in body.get("columns", [])
        if x.get("table") and x.get("column")
    ]
    staged_overrides = [
        {"table": str(x.get("table", "")), "column": str(x.get("column", ""))}
        for x in body.get("overrides", [])
        if x.get("table") and x.get("column")
    ]
    unresolved = body.get("unresolved_conflicts") or []

    try:
        merged_bytes, out_name, actions, warnings, _ = mc.execute_merge(
            source,
            target_bytes,
            target_filename,
            staged_tables,
            staged_columns,
            staged_overrides,
        )
    except mc.DuplicateTableError as exc:
        return jsonify({"ok": False, "error": str(exc), "kind": "duplicate_table"}), 409
    except mc.MergeError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:  # pragma: no cover
        return jsonify({"ok": False, "error": f"Merge failed: {exc}"}), 500

    report_text = mc.build_report(
        source.filename, target_filename, out_name,
        actions, warnings, unresolved,
    )
    report_bytes = report_text.encode("utf-8")

    xml_token = uuid.uuid4().hex
    rpt_token = uuid.uuid4().hex
    with _STORE_LOCK:
        entry["downloads"][xml_token] = (out_name, merged_bytes, "application/xml")
        entry["downloads"][rpt_token] = ("MERGE_REPORT.txt", report_bytes, "text/plain")

    out = make_response(jsonify({
        "ok": True,
        "output_filename": out_name,
        "report_filename": "MERGE_REPORT.txt",
        "xml_download_url": f"/download/{xml_token}",
        "report_download_url": f"/download/{rpt_token}",
        "counts": {
            "tables_added": len(staged_tables),
            "columns_added": len(staged_columns),
            "overrides": len(staged_overrides),
            "unresolved": len(unresolved),
        },
        "actions": actions,
        "warnings": warnings,
    }))
    _get_or_create_session(request, out)
    return out


@app.get("/download/<token>")
def download(token):
    sid = request.cookies.get(SESSION_COOKIE)
    if not sid:
        abort(404)
    with _STORE_LOCK:
        entry = _STORE.get(sid)
        if not entry:
            abort(404)
        item = entry["downloads"].get(token)
        if not item:
            abort(404)
        filename, data, mime = item
    return send_file(
        io.BytesIO(data),
        mimetype=mime,
        as_attachment=True,
        download_name=filename,
    )


@app.post("/api/reset")
def api_reset():
    """Clear both loaded files from the current session (but keep the
    session itself). Handy for the UI's "start over" button."""
    resp = make_response(jsonify({"ok": True}))
    sid = _get_or_create_session(request, resp)
    with _STORE_LOCK:
        entry = _STORE[sid]
        entry["source"] = None
        entry["source_bytes"] = None
        entry["target"] = None
        entry["target_bytes"] = None
        entry["downloads"] = {}
    return resp


if __name__ == "__main__":
    # Bind loopback only — this is a local dev tool, not a public service.
    port = int(os.environ.get("PORT", "5055"))
    # debug=False because we mutate module-level state and reloader spawns
    # two processes, losing sessions between them.
    app.run(host="127.0.0.1", port=port, debug=False)
