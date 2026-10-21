"""Reports pages that ask the API for the whole metric catalog in one go. The API rejects a GET URL
past ~8 KB with 414, so common.js splits those lists into chunks; these tests fail if a page goes
back to sending one over-long request. Data comes from the live API, so they need network."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.browser


def _open(browser, url: str):
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    api_statuses: list[tuple[int, str]] = []
    page.on("response", lambda r: api_statuses.append((r.status, r.url)) if "/api/" in r.url else None)
    page.goto(url, wait_until="load")
    page.wait_for_timeout(4000)  # let the chunked API calls come back and render
    return context, page, api_statuses


def test_deep_dive_renders_and_sends_no_uri_too_long(browser, site_url):
    context, page, api = _open(browser, site_url + "/reports/deep-dive")
    text = page.inner_text("#deepdive-content")
    rows = page.locator(".deepdive-row").count()
    context.close()
    assert "Couldn't load metric" not in text
    assert rows > 0, f"deep dive drew no ranked rows: {text[:200]!r}"
    assert not [u for s, u in api if s == 414], "an /api/ request was rejected as too long (414)"


def test_report_history_requests_are_not_too_long(browser, site_url):
    context, _page, api = _open(browser, site_url + "/report?area_type=ward&area_id=01")
    context.close()
    timeline = [(s, u) for s, u in api if "/api/metrics/timeline" in u]
    assert timeline, "/report never asked for history, so this test no longer covers the timeline call"
    assert not [u for s, u in api if s == 414], "an /api/ request was rejected as too long (414)"
