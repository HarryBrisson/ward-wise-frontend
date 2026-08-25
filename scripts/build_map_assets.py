#!/usr/bin/env python3
"""Regenerate the two static assets derived from the ward boundaries.

    templates/_ward_outline.svg   the map's loading skeleton
    static/ward-neighbors.js      which wards share a border

Both come from the same GeoJSON the map already draws, so they only need
rebuilding when the boundaries change, which happens after a remap. Run:

    python3 scripts/build_map_assets.py

It reads the live API, so there is no local data file to keep in sync.

Why precompute rather than derive in the browser: the outline has to be on
screen before any fetch resolves, and the adjacency pass densifies 50 polygon
boundaries to 20m spacing, which is a few hundred thousand points. Neither
belongs on the page's critical path.
"""

from __future__ import annotations

import json
import math
import sys
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

SOURCE = "https://penlight.wardwise.org/api/wards.geojson"
ROOT = Path(__file__).resolve().parent.parent
OUTLINE_OUT = ROOT / "templates" / "_ward_outline.svg"
NEIGHBORS_OUT = ROOT / "static" / "ward-neighbors.js"

# Douglas-Peucker tolerance, in units of a 1000-tall projection. Bigger means a
# coarser silhouette and a smaller file; 3.2 lands around 14KB, which is small
# enough to inline and still reads as Chicago.
TOLERANCE = 3.2

# Adjacency: walk each boundary at 20m intervals, drop the points into 35m
# cells, and call two wards neighbors when they land in at least four of the
# same cells. Densifying first is what makes this work at all, because adjacent
# wards were digitized separately and often share no vertices. Four cells is
# about 140m of common border, enough to rule out a corner touch.
STEP_METERS = 20.0
CELL_METERS = 35.0
MIN_SHARED_CELLS = 4

CHICAGO_LAT = 41.85
METERS_PER_DEGREE_LAT = 111_320.0
METERS_PER_DEGREE_LON = METERS_PER_DEGREE_LAT * math.cos(math.radians(CHICAGO_LAT))


def rings(geometry: dict) -> list:
    kind = geometry.get("type")
    if kind == "Polygon":
        return geometry["coordinates"]
    if kind == "MultiPolygon":
        return [ring for polygon in geometry["coordinates"] for ring in polygon]
    return []


def ward_id(feature: dict) -> str:
    props = feature["properties"]
    raw = props.get("ward_id") or props.get("ward") or props.get("ward_num")
    return str(int(raw)).zfill(2)


# --- the loading skeleton -----------------------------------------------------

def perpendicular(point, start, end) -> float:
    (px, py), (ax, ay), (bx, by) = point, start, end
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def simplify(points: list, tolerance: float) -> list:
    if len(points) < 3:
        return points
    worst, index = 0.0, 0
    for i in range(1, len(points) - 1):
        distance = perpendicular(points[i], points[0], points[-1])
        if distance > worst:
            worst, index = distance, i
    if worst <= tolerance:
        return [points[0], points[-1]]
    return simplify(points[: index + 1], tolerance)[:-1] + simplify(points[index:], tolerance)


def build_outline(features: list) -> str:
    lons = [x for f in features for r in rings(f["geometry"]) for x, _ in r]
    lats = [y for f in features for r in rings(f["geometry"]) for _, y in r]
    west, east, south, north = min(lons), max(lons), min(lats), max(lats)

    # Equirectangular with an x-scale of cos(latitude). Over an extent this
    # small that is within a pixel of Web Mercator, and it keeps the city from
    # looking squashed.
    stretch = math.cos(math.radians((south + north) / 2))
    scale = 1000.0 / (north - south)

    def project(lon: float, lat: float) -> tuple:
        return ((lon - west) * stretch * scale, (north - lat) * scale)

    paths = []
    for feature in sorted(features, key=ward_id):
        pieces = []
        for ring in rings(feature["geometry"]):
            reduced = simplify([project(x, y) for x, y in ring], TOLERANCE)
            if len(reduced) >= 3:
                pieces.append("M" + " ".join(f"{x:.0f},{y:.0f}" for x, y in reduced) + "Z")
        if pieces:
            paths.append(" ".join(pieces))

    width = (east - west) * stretch * scale
    return (
        f'<svg class="k3-skel-svg" viewBox="0 0 {width:.0f} 1000" fill="none" '
        f'stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" aria-hidden="true">'
        + "".join(f'<path d="{d}"/>' for d in paths)
        + "</svg>"
    )


# --- who borders whom ---------------------------------------------------------

def densify(ring: list) -> list:
    points = []
    for i in range(len(ring) - 1):
        (x0, y0), (x1, y1) = ring[i], ring[i + 1]
        span = math.hypot((x1 - x0) * METERS_PER_DEGREE_LON, (y1 - y0) * METERS_PER_DEGREE_LAT)
        steps = max(1, int(span // STEP_METERS))
        for k in range(steps):
            points.append((x0 + (x1 - x0) * k / steps, y0 + (y1 - y0) * k / steps))
    return points


def build_neighbors(features: list) -> dict:
    cells = defaultdict(set)
    for feature in features:
        ward = ward_id(feature)
        for ring in rings(feature["geometry"]):
            for lon, lat in densify(ring):
                key = (
                    int(lon * METERS_PER_DEGREE_LON // CELL_METERS),
                    int(lat * METERS_PER_DEGREE_LAT // CELL_METERS),
                )
                cells[key].add(ward)

    shared = defaultdict(Counter)
    for wards in cells.values():
        if len(wards) < 2:
            continue
        for a in wards:
            for b in wards:
                if a != b:
                    shared[a][b] += 1

    return {
        ward: sorted(
            (other for other, hits in counts.items() if hits >= MIN_SHARED_CELLS),
            key=int,
        )
        for ward, counts in sorted(shared.items(), key=lambda kv: int(kv[0]))
    }


def main() -> int:
    with urllib.request.urlopen(SOURCE, timeout=30) as response:
        features = json.load(response)["features"]

    svg = build_outline(features)
    OUTLINE_OUT.write_text(svg, encoding="utf-8")
    print(f"{OUTLINE_OUT.name}: {len(features)} wards, {len(svg):,} bytes")

    neighbors = build_neighbors(features)
    body = json.dumps(neighbors, separators=(",", ":"), sort_keys=False)
    js = (
        "// Generated by scripts/build_map_assets.py. Which wards share a border,\n"
        "// used by the compare view so \"next to you\" is one tap. Rebuild after a\n"
        "// remap; do not hand-edit.\n"
        f"window.K3_NEIGHBORS = {body};\n"
    )
    NEIGHBORS_OUT.write_text(js, encoding="utf-8")
    counts = [len(v) for v in neighbors.values()]
    print(
        f"{NEIGHBORS_OUT.name}: {len(neighbors)} wards, "
        f"{min(counts)}-{max(counts)} neighbors each, {len(js):,} bytes"
    )
    return 0


if __name__ == "__main__":
    sys.setrecursionlimit(10000)
    raise SystemExit(main())
