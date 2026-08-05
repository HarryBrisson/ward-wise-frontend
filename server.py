"""Ward Wise Penlight — frontend shell.

This app renders the three views and nothing else. Every byte of data comes from the
Penlight API, which lives in another repo and is reached through the `/api/*` proxy
below. Proxying (rather than calling the API cross-origin from the browser) keeps every
request same-origin, so there is no CORS to configure and no API key to hand out.

Environment:
  PENLIGHT_API_BASE   where /api/* is forwarded   (default: https://penlight.wardwise.org)
  PENLIGHT_SITE_BASE  where out-of-scope links go (default: https://penlight.wardwise.org)
  PROXY_ALLOW_WRITES  1 to forward POSTs upstream (default: 0, stubbed — see proxy())
  PORT                default 1837, the year Chicago was incorporated
"""

from __future__ import annotations

import os
from pathlib import Path

import requests
from flask import Flask, Response, jsonify, redirect, render_template, request, url_for

API_BASE = os.environ.get("PENLIGHT_API_BASE", "https://penlight.wardwise.org").rstrip("/")
SITE_BASE = os.environ.get("PENLIGHT_SITE_BASE", "https://penlight.wardwise.org").rstrip("/")
ALLOW_WRITES = os.environ.get("PROXY_ALLOW_WRITES", "0") == "1"

# Headers that describe the *hop*, not the payload — forwarding them would corrupt the
# response (a re-chunked body carrying the upstream's Content-Length, say).
HOP_BY_HOP = {"content-encoding", "content-length", "transfer-encoding", "connection"}

app = Flask(__name__)

STATIC_DIR = Path(app.static_folder)

# Cache-bust static assets: one version per change = newest mtime among css/js, so editing
# any stylesheet or script forces a refetch. Templates pass `v=asset_version`.
ASSET_VERSION = int(max(
    (path.stat().st_mtime for path in STATIC_DIR.iterdir() if path.suffix in (".css", ".js")),
    default=0,
))


@app.context_processor
def inject_globals():
    return {
        "asset_version": ASSET_VERSION,
        # Features that stayed behind in the monorepo — nominate a metric, submit a photo,
        # the reports page, the API docs. They link out to the live site rather than 404.
        "live_url": lambda path: f"{SITE_BASE}{path}",
    }


# --- Views -------------------------------------------------------------------

@app.get("/")
def index():
    return render_template("explorer.html")


@app.get("/dictionary")
def dictionary():
    return render_template("dictionary.html")


@app.get("/metrics")
def metrics_redirect():
    # Upstream 301s /metrics to the page carrying the dictionary; keep the habit.
    return redirect(url_for("dictionary"), 301)


@app.get("/support")
@app.get("/about")
def about():
    return render_template("about.html")


# --- API proxy ---------------------------------------------------------------

@app.route("/api/<path:api_path>", methods=["GET", "POST"])
def proxy(api_path: str):
    """Forward to the Penlight API, streaming bytes through untouched.

    Bytes, not JSON: /api/civic-assets/... serves the signifier JPEGs that the map view
    and Support page render, so the proxy has to stay content-type agnostic.
    """
    if request.method == "POST" and not ALLOW_WRITES:
        # The map view POSTs an analytics event on every metric toggle. Clicking around
        # locally shouldn't write rows into production, so acknowledge without forwarding.
        return jsonify({"ok": True, "stubbed": True})

    upstream = f"{API_BASE}/api/{api_path}"
    try:
        response = requests.request(
            request.method,
            upstream,
            params=request.args,
            data=request.get_data(),
            headers={"Content-Type": request.content_type} if request.content_type else {},
            timeout=30,
        )
    except requests.RequestException as error:
        return jsonify({"error": f"Upstream request failed: {error}"}), 502

    headers = [
        (key, value)
        for key, value in response.headers.items()
        if key.lower() not in HOP_BY_HOP
    ]
    return Response(response.content, status=response.status_code, headers=headers)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 1837)), debug=True)
