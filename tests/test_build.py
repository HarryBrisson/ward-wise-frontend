"""The static build: every page renders, the CI sanity check passes, and links between pages
point at pages that exist. No network, no browser; runs in a few seconds."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

import check_build
from conftest import ALL_PATHS, page_file, site

# Served by the private API on the same host in production (CONTRIBUTING.md, "Where things live"),
# so the build never contains them and a link to one is not broken.
BACKEND_PREFIXES = ("/api", "/login", "/logout", "/account", "/admin", "/survey", "/request-access",
                    "/submissions", "/metric-submissions", "/auth")
# server.py's /report/<slug>/<area_id>; CloudFront rewrites it to /report/ in production.
AREA_REPORT = re.compile(r"^/report/[^/]+/[^/]+$")

HREF = re.compile(r'href="(/[^"#?]*)')


def test_ci_sanity_check_passes(built_site: Path):
    assert check_build.main(["check_build.py", str(built_site)]) == 0


KNOWN_BAD_TITLE = {"/signifiers": "title block never closed, swallows the page script"}


@pytest.mark.parametrize("path", [
    pytest.param(p, marks=pytest.mark.xfail(reason=KNOWN_BAD_TITLE[p], strict=True)) if p in KNOWN_BAD_TITLE else p
    for p in ALL_PATHS])
def test_page_has_title_and_zoomable_viewport(built_site: Path, path: str):
    html = page_file(built_site, path).read_text(encoding="utf-8")
    title = re.search(r"<title>(.*?)</title>", html, re.S)
    assert title and title.group(1).strip(), f"{path}: empty <title>"
    # Browsers print everything inside <title> as text, so markup there means a block ran on.
    assert "<" not in title.group(1), f"{path}: markup inside <title> (unclosed title block?)"
    viewport = re.search(r'<meta name="viewport" content="([^"]*)"', html)
    assert viewport, f"{path}: no viewport meta"
    assert "user-scalable=no" not in viewport.group(1), f"{path}: blocks pinch zoom"


@pytest.mark.parametrize("path", ALL_PATHS)
def test_no_template_syntax_leaks_into_page(built_site: Path, path: str):
    # An unclosed {% block %} swallows what follows it; a stray {{ or {% means Jinja never saw it.
    html = page_file(built_site, path).read_text(encoding="utf-8")
    body = re.sub(r"<script\b.*?</script>", "", html, flags=re.S)
    assert "{%" not in body and "{{" not in body, f"{path}: raw template syntax in the page"


def test_internal_links_resolve(built_site: Path):
    known = {p.path for p in site.PAGES} | {a for p in site.PAGES for a in p.aliases}
    broken = []
    for path in ALL_PATHS:
        html = page_file(built_site, path).read_text(encoding="utf-8")
        for target in set(HREF.findall(html)):
            target = target.rstrip("/") or "/"
            if target.startswith("/static/") or target.startswith(BACKEND_PREFIXES) or AREA_REPORT.match(target):
                continue
            if target in known or (built_site / target.strip("/")).exists():
                continue
            broken.append(f"{path} -> {target}")
    assert not broken, "links to pages the build does not contain:\n" + "\n".join(sorted(broken))
