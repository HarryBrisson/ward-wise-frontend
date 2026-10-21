"""The top bar on a phone: "More" must be reachable without discovering a hidden swipe, and a
signed-out visitor must not see an empty account circle."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.browser


def _phone_page(browser, site_url):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    page.goto(site_url + "/", wait_until="load")
    page.wait_for_timeout(1000)
    return context, page


def test_more_button_is_inside_the_phone_viewport(browser, site_url):
    context, page = _phone_page(browser, site_url)
    box = page.locator(".gn-more-toggle").bounding_box()
    context.close()
    assert box is not None
    assert box["x"] >= 0 and box["x"] + box["width"] <= 390, f"More is off-screen: {box}"


def test_phone_nav_links_have_a_finger_sized_tap_area(browser, site_url):
    context, page = _phone_page(browser, site_url)
    heights = page.evaluate(
        "() => [...document.querySelectorAll('.gn-links > a, .gn-more-toggle')]"
        ".map(el => el.getBoundingClientRect().height)")
    context.close()
    assert heights and min(heights) >= 43, heights


def test_account_circle_is_hidden_when_signed_out(browser, site_url):
    context, page = _phone_page(browser, site_url)
    visible = page.locator("#nav-account").is_visible()
    context.close()
    assert not visible, "the empty account circle is showing to a signed-out visitor"
