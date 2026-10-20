"""Open every page in headless Chromium at phone and desktop width and check the two things a
visitor notices first: the page does not scroll sideways, and no script crashes. Data comes from
the live API through server.py's proxy, so these need network; run `pytest -m "not browser"` offline."""

from __future__ import annotations

import pytest

from conftest import ALL_PATHS

pytestmark = pytest.mark.browser

VIEWPORTS = {"phone": {"width": 390, "height": 844}, "desktop": {"width": 1440, "height": 900}}

# Pages that scroll sideways on dev today. strict: once a fix lands the xfail itself fails, so the
# entry has to come out with the fix.
KNOWN_OVERFLOW: dict[tuple[str, str], str] = {
    ("/k3/dictionary", "phone"): "k3 shell has no phone layout",
}


def _cases():
    for path in ALL_PATHS:
        for name in VIEWPORTS:
            reason = KNOWN_OVERFLOW.get((path, name))
            marks = [pytest.mark.xfail(reason=reason, strict=True)] if reason else []
            yield pytest.param(path, name, id=f"{path}-{name}", marks=marks)


@pytest.mark.parametrize("path,viewport", list(_cases()))
def test_page_loads_without_sideways_scroll_or_script_errors(browser, site_url, path, viewport):
    context = browser.new_context(viewport=VIEWPORTS[viewport])
    page = context.new_page()
    crashes: list[str] = []
    page.on("pageerror", lambda error: crashes.append(str(error)))
    page.goto(site_url + path, wait_until="load")
    page.wait_for_timeout(1500)  # let the first API responses render
    overflow = page.evaluate(
        "() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
    context.close()
    assert not crashes, f"{path} ({viewport}): uncaught script errors: {crashes}"
    assert overflow <= 1, f"{path} ({viewport}): page is {overflow}px wider than the screen"
