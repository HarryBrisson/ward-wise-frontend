"""Analytics: every count reaches both tools with the ward, and the private alert-settings token in
/alerts?m=<token> never reaches either. Runs against a build with a fake GA id and PostHog key.
Both tools' scripts are blocked, so gtag leaves its calls in window.dataLayer and the PostHog
stub keeps its calls in window.posthog, which is exactly what the tools would have read."""

from __future__ import annotations

import functools
import http.server
import json
import threading

import pytest

pytestmark = pytest.mark.browser

SECRET = "SECRETtoken123"


@pytest.fixture(scope="module")
def tracked_site(tmp_path_factory) -> str:
    """A second build, with both tools switched on, served as plain static files (no /api proxy:
    tests stub the few API calls they need)."""
    import build_static

    out = tmp_path_factory.mktemp("dist-tracked")
    assert build_static.main(["--out", str(out), "--sha", "test", "--ga-id", "G-TEST", "--posthog-key", "phc_test"]) == 0
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    handler = functools.partial(Quiet, directory=str(out))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


@pytest.fixture
def page(browser):
    context = browser.new_context()
    # The tools' own scripts never load: what they would send is what's queued in the page.
    context.route("**/*googletagmanager.com/**", lambda route: route.abort())
    context.route("**/*posthog.com/**", lambda route: route.abort())
    page = context.new_page()
    yield page
    context.close()


def sent(page) -> dict:
    """Everything queued for Google Analytics and PostHog, plus the address bar."""
    return page.evaluate("""() => ({
        ga: (window.dataLayer || []).map((entry) => Array.from(entry)),
        posthog: Array.from(window.posthog || []).filter(Array.isArray),
        init: (window.posthog && window.posthog._i) || [],
        href: location.href,
    })""")


def events(page, name):
    data = sent(page)
    ga = [entry[2] for entry in data["ga"] if entry[:2] == ["event", name]]
    ph = [entry[2] for entry in data["posthog"] if entry[:2] == ["capture", name]]
    return ga, ph


def stub_manage_api(page, calls):
    def handle(route):
        calls.append(route.request.url)
        route.fulfill(status=200, content_type="application/json", body=json.dumps({
            "email": "resident@example.org", "topics": [], "frequency": "weekly",
            "urgent_zoning": False, "status": "active", "ward": "05",
        }))
    page.route("**/api/alerts/preferences**", handle)


def test_leak_manage_token_reaches_neither_tool(page, tracked_site):
    page.goto(f"{tracked_site}/alerts?m={SECRET}&alerts=confirmed", wait_until="load")
    page.wait_for_timeout(500)
    data = sent(page)
    assert SECRET not in data["href"], data["href"]
    assert "alerts=confirmed" in data["href"], "only the token comes off the address"
    assert SECRET not in json.dumps(data, default=str), "the token reached an analytics queue"
    assert data["init"], "PostHog was not set up on a build with a key"


def test_leak_other_pages_keep_their_m_parameter(page, tracked_site):
    # On /k3 and /report, m= is the chosen measures, and it must stay in the link.
    page.goto(f"{tracked_site}/k3?m=abc", wait_until="load")
    assert "m=abc" in page.evaluate("location.href")


def test_manage_mode_still_works_after_the_token_is_lifted(page, tracked_site):
    calls = []
    stub_manage_api(page, calls)
    page.goto(f"{tracked_site}/alerts?m={SECRET}", wait_until="load")
    page.wait_for_function("document.querySelector('#fd-alert-form').elements.email.value !== ''")
    assert calls and f"m={SECRET}" in calls[0], calls
    assert page.evaluate("document.querySelector('#fd-alert-form').elements.email.value") == "resident@example.org"
    # A reload in the same tab keeps manage mode, though the address bar no longer has the token.
    page.reload(wait_until="load")
    page.wait_for_function("document.querySelector('#fd-alert-form').elements.email.value !== ''")
    assert len(calls) == 2 and f"m={SECRET}" in calls[1], calls


def test_civic_step_goes_to_both_tools_with_ward(page, tracked_site):
    page.goto(f"{tracked_site}/alerts", wait_until="load")
    page.evaluate("""() => {
        localStorage.setItem("wardwise:ward", "05");
        // Keep the test page in place: stop the links from opening, after the count has run.
        document.addEventListener("click", (event) => event.preventDefault());
        for (const href of ["mailto:alder@example.org", "tel:3125550100", "https://311.chicago.gov", "https://example.com/"]) {
            const link = Object.assign(document.createElement("a"), { href, textContent: href });
            document.body.append(link);
            link.click();
        }
    }""")
    ga, ph = events(page, "civic_step")
    expected = [{"step": "email", "ward": "05"}, {"step": "call", "ward": "05"}, {"step": "311", "ward": "05"}]
    for got in (ga, ph):
        assert [{k: e[k] for k in ("step", "ward")} for e in got] == expected, got
    assert all("alder@example.org" not in json.dumps(e) for e in ga + ph), "the link target was sent"


def test_alert_signup_started_is_counted_once(page, tracked_site):
    page.goto(f"{tracked_site}/alerts", wait_until="load")
    form = page.locator("#fd-alert-form")
    form.locator("input[name=email]").focus()
    page.locator("body").click(position={"x": 1, "y": 1})
    form.locator("input[name=email]").focus()
    ga, ph = events(page, "alert_signup_started")
    assert len(ga) == 1 and len(ph) == 1, (ga, ph)


def test_ward_pick_is_counted(page, tracked_site):
    page.goto(f"{tracked_site}/alerts", wait_until="load")
    page.evaluate("window.WardWiseMyWard.set('12', 'picker')")
    ga, ph = events(page, "ward_selected")
    assert ga == ph == [{"ward": "12", "how": "picker", "page": "alerts"}], (ga, ph)


def test_topic_section_open_is_counted(page, tracked_site):
    page.goto(f"{tracked_site}/alerts", wait_until="load")
    page.evaluate("""() => {
        document.body.insertAdjacentHTML("beforeend",
          '<details class="wardreport-accordion" data-domain="health"><summary><span class="wardreport-domain">Health</span></summary>x</details>');
        document.querySelector("details[data-domain]").open = true;
    }""")
    page.wait_for_timeout(100)
    ga, ph = events(page, "topic_opened")
    assert [e["topic"] for e in ga] == [e["topic"] for e in ph] == ["Health"], (ga, ph)
