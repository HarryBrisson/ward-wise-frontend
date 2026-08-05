#!/usr/bin/env python3
"""Regenerate templates/_ward_outline.svg, the map's loading skeleton.

The explorer's map box is 420px of nothing until the boundary GeoJSON and the
basemap tiles arrive. This traces the same 50 ward polygons into a small inline
SVG that renders on the first paint, so the box shows the shape of the city
while the real map loads.

Run it whenever the ward boundaries change (they move every ten years, after a
remap):

    python3 scripts/build_outline.py

It reads the live API, so no local data file is needed. Output lands at
templates/_ward_outline.svg and is inlined by k3.html.
"""

from __future__ import annotations

import json
import math
import sys
import urllib.request
from pathlib import Path

SOURCE = "https://penlight.wardwise.org/api/wards.geojson"
OUT = Path(__file__).resolve().parent.parent / "templates" / "_ward_outline.svg"

# Douglas-Peucker tolerance, in units of a 1000-tall projection. Bigger means a
# coarser silhouette and a smaller file; 3.2 lands around 14KB, which is small
# enough to inline and still reads as Chicago.
TOLERANCE = 3.2


def rings(geometry: dict) -> list:
    kind = geometry.get("type")
    if kind == "Polygon":
        return geometry["coordinates"]
    if kind == "MultiPolygon":
        return [ring for polygon in geometry["coordinates"] for ring in polygon]
    return []


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


def main() -> int:
    with urllib.request.urlopen(SOURCE, timeout=30) as response:
        features = json.load(response)["features"]

    lons = [x for f in features for r in rings(f["geometry"]) for x, _ in r]
    lats = [y for f in features for r in rings(f["geometry"]) for _, y in r]
    west, east, south, north = min(lons), max(lons), min(lats), max(lats)

    # Equirectangular with an x-scale of cos(latitude) — at Chicago's latitude
    # that is within a pixel of Web Mercator over this small an extent, and it
    # keeps the city from looking squashed.
    stretch = math.cos(math.radians((south + north) / 2))
    scale = 1000.0 / (north - south)

    def project(lon: float, lat: float) -> tuple:
        return ((lon - west) * stretch * scale, (north - lat) * scale)

    paths = []
    for feature in sorted(features, key=lambda f: str(f["properties"].get("ward_id"))):
        pieces = []
        for ring in rings(feature["geometry"]):
            simplified = simplify([project(x, y) for x, y in ring], TOLERANCE)
            if len(simplified) >= 3:
                pieces.append("M" + " ".join(f"{x:.0f},{y:.0f}" for x, y in simplified) + "Z")
        if pieces:
            paths.append(" ".join(pieces))

    width = (east - west) * stretch * scale
    svg = (
        f'<svg class="k3-skel-svg" viewBox="0 0 {width:.0f} 1000" fill="none" '
        f'stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" aria-hidden="true">'
        + "".join(f'<path d="{d}"/>' for d in paths)
        + "</svg>"
    )
    OUT.write_text(svg, encoding="utf-8")
    print(f"{OUT.relative_to(Path.cwd())}: {len(paths)} wards, {len(svg):,} bytes")
    return 0


if __name__ == "__main__":
    sys.setrecursionlimit(10000)
    raise SystemExit(main())
