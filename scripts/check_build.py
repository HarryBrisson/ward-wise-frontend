#!/usr/bin/env python3
"""Sanity-check a built dist/: every page exists, carries the build marker, and references only
assets that were actually copied. Runs in CI after the build; a broken link fails the PR."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import penlight_site as site  # noqa: E402


def parse_presets_js(source: str) -> list[dict]:
    """Mirror of shared/civic_data/presets.py in the API repo: keep the two in step."""
    marker = "window.WardWisePresets = "
    body = source[source.index(marker) + len(marker):]
    body = body[: body.index("];") + 1]
    body = re.sub(r"//[^\n]*", "", body)
    body = re.sub(r"^(\s*)(\w+):", r'\1"\2":', body, flags=re.M)
    body = re.sub(r",\s*([}\]])", r"\1", body)
    presets = json.loads(body)
    for preset in presets:
        for key in ("id", "name", "short", "tagline", "metric_ids"):
            if key not in preset:
                raise ValueError(f"preset {preset.get('id')!r} lacks {key}")
    return presets


def main(argv: list[str]) -> int:
    out = Path(argv[1] if len(argv) > 1 else "dist")
    problems: list[str] = []
    asset_ref = re.compile(r'(?:src|href)="/static/([^"?]+)')
    for page in site.PAGES:
        for path in (page.path, *page.aliases):
            html_path = out / "index.html" if path == "/" else out / path.strip("/") / "index.html"
            if not html_path.exists():
                problems.append(f"missing page {path}")
                continue
            html = html_path.read_text(encoding="utf-8")
            if 'name="penlight-build"' not in html:
                problems.append(f"{path}: no build marker")
            for asset in set(asset_ref.findall(html)):
                if not (out / "static" / asset).exists():
                    problems.append(f"{path}: references missing asset static/{asset}")
    # static/presets.js is a contract: the API repo's pipeline reads the published copy (the curated
    # lists feed the ward narratives), so it must stay a plain array literal that this parse accepts.
    try:
        presets = parse_presets_js((out / "static" / "presets.js").read_text(encoding="utf-8"))
        if len(presets) < 5 or len({p["id"] for p in presets}) != len(presets):
            problems.append("static/presets.js: too few presets or duplicate ids")
    except Exception as error:  # noqa: BLE001
        problems.append(f"static/presets.js: not parseable as the pipeline parses it ({error})")
    for required in (".nojekyll", "404.html", "build.json", "CNAME"):
        if not (out / required).exists():
            problems.append(f"missing {required}")
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 1
    manifest = json.loads((out / "build.json").read_text())
    print(f"ok: {len(manifest['pages'])} pages, build {manifest['sha']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
