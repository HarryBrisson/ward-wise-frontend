"""Shared fixtures: one static build per test session, and the same dist/ served the way
`python server.py --built` serves it, so the browser tests see exactly what Pages will."""

from __future__ import annotations

import socket
import sys
import threading
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import penlight_site as site  # noqa: E402


@pytest.fixture(scope="session")
def built_site(tmp_path_factory) -> Path:
    """Run the real build into a throwaway directory. A template that fails to render fails here."""
    import build_static

    out = tmp_path_factory.mktemp("dist")
    assert build_static.main(["--out", str(out), "--sha", "test"]) == 0
    return out


def page_file(dist: Path, path: str) -> Path:
    return dist / "index.html" if path == "/" else dist / path.strip("/") / "index.html"


@pytest.fixture(scope="session")
def site_url(built_site: Path) -> str:
    """Serve the build through server.py's own routes (the /api proxy included) on a free port.
    The module reads BUILT and DIST at request time, so pointing them at the fixture build is
    the same as starting it with --built from a checkout whose dist/ is that build."""
    from werkzeug.serving import make_server

    import server

    server.BUILT = True
    server.DIST = built_site
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    httpd = make_server("127.0.0.1", port, server.app, threaded=True)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{port}"
    httpd.shutdown()


ALL_PATHS = [page.path for page in site.PAGES]
