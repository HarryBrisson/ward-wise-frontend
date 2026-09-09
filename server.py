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

# One keep-alive session for every upstream call. Reusing the TCP and TLS
# connection saves a few hundred milliseconds per request, which is the
# difference between autocomplete feeling live and feeling laggy.
HTTP = requests.Session()

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


@app.get("/report")
def report():
    return render_template("k3.html", embedded=request.args.get("embedded") == "1")


@app.get("/classic")
def classic():
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


# --- Geocoding ---------------------------------------------------------------

# Chicago bounding box for Nominatim, so "Clark St" resolves here and not Iowa.
CHICAGO_VIEWBOX = "-87.95,42.03,-87.50,41.62"

# The same box in Photon's order (min lon, min lat, max lon, max lat).
CHICAGO_BBOX = "-87.95,41.62,-87.50,42.03"


# The City of Chicago's own address locator, the authority on what addresses
# exist here. Free public ArcGIS endpoint, no key.
CHICAGO_GEOCODER = (
    "https://gisapps.chicago.gov/arcgis/rest/services/Chicago_Addresses/GeocodeServer"
)

GEOCODER_HEADERS = {
    "User-Agent": "ward-wise-frontend (https://github.com/HarryBrisson/ward-wise-frontend)",
}


@app.get("/geocode/suggest")
def geocode_suggest():
    """Address autocomplete from the City of Chicago's own geocoder.

    The city's locator knows every address point in Chicago, so 550 N Saint
    Clair completes on the first try, which the OSM geocoders could not do.
    Suggestions return a text plus a magicKey; /geocode/resolve turns the
    picked one into coordinates.
    """
    query = (request.args.get("q") or "").strip()
    if len(query) < 3:
        return jsonify({"suggestions": []})
    try:
        response = HTTP.get(
            f"{CHICAGO_GEOCODER}/suggest",
            params={"text": query, "f": "json", "maxSuggestions": 6},
            headers=GEOCODER_HEADERS,
            timeout=6,
        )
        raw = response.json().get("suggestions", [])
    except requests.RequestException as error:
        return jsonify({"error": f"Suggestions failed: {error}"}), 502
    suggestions = [
        {"label": item["text"], "key": item["magicKey"]}
        for item in raw
        if item.get("text") and not item.get("isCollection")
    ]
    return jsonify({"suggestions": suggestions[:6]})


@app.get("/geocode/resolve")
def geocode_resolve():
    """Turn a picked suggestion into WGS84 coordinates via the city locator."""
    text = (request.args.get("text") or "").strip()
    key = (request.args.get("key") or "").strip()
    if not text:
        return jsonify({"error": "Missing text."}), 400
    params = {"SingleLine": text, "outSR": 4326, "maxLocations": 1, "f": "json"}
    if key:
        params["magicKey"] = key
    try:
        response = HTTP.get(
            f"{CHICAGO_GEOCODER}/findAddressCandidates",
            params=params,
            headers=GEOCODER_HEADERS,
            timeout=6,
        )
        candidates = response.json().get("candidates", [])
    except requests.RequestException as error:
        return jsonify({"error": f"Address lookup failed: {error}"}), 502
    if not candidates:
        return jsonify({"match": None})
    top = candidates[0]
    return jsonify(
        {
            "match": {
                "lat": top["location"]["y"],
                "lon": top["location"]["x"],
                "label": top.get("address", text),
            }
        }
    )


@app.get("/geocode")
def geocode():
    """Resolve a street address to coordinates via OpenStreetMap's Nominatim.

    Proxied server-side rather than called from the browser so the request
    carries a proper User-Agent per the Nominatim usage policy, and so the
    frontend stays same-origin. The ward lookup itself happens client-side
    against the ward boundaries the page already holds.
    """
    query = (request.args.get("q") or "").strip()
    if not query:
        return jsonify({"error": "Missing query."}), 400
    try:
        response = HTTP.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": f"{query}, Chicago, Illinois",
                "format": "jsonv2",
                "limit": 1,
                "viewbox": CHICAGO_VIEWBOX,
                "bounded": 1,
            },
            headers={
                "User-Agent": "ward-wise-frontend (https://github.com/HarryBrisson/ward-wise-frontend)",
            },
            timeout=8,
        )
        results = response.json()
    except requests.RequestException as error:
        return jsonify({"error": f"Geocoding failed: {error}"}), 502
    if not results:
        return jsonify({"match": None})
    top = results[0]
    return jsonify(
        {
            "match": {
                "lat": float(top["lat"]),
                "lon": float(top["lon"]),
                "label": top.get("display_name", query),
            }
        }
    )


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
        response = HTTP.request(
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
