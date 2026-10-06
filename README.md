# ward-wise-frontend

The public site for **Ward Wise Penlight** — a civic-data project built at
[Chi Hack Night](https://chihacknight.org/) that turns Chicago open data into neighborhood
wellbeing measures anyone can explore, weight, and compare. Live at
[penlight.wardwise.org](https://penlight.wardwise.org).

This repo is every reader-facing page of Penlight: the map, the reports, the metric dictionary,
the Support pages, and Connor Florczyk's sequenced K3 explorer. **Merging to `main` deploys it.**
The data, the pipeline, the API, and the signed-in pages (survey, account, admin) live in the
private [ward-wise-civic-tech](https://github.com/HarryBrisson/ward-wise-civic-tech) repo and are
reached on the same host.

| Page | Route | Template |
|---|---|---|
| Map view | `/` | `explorer.html` |
| K3 sequenced explorer | `/k3` (+ `/k3/dictionary`) | `k3.html` |
| Reports hub, and one page per report | `/reports`, `/report`, `/compare`, `/reports/term`, `/reports/comparison`, `/reports/deep-dive`, `/reports/data-years` | `reports_hub.html`, `report*.html`, `compare.html` |
| Index of fifty, Menu money, Metrics near you | `/index`, `/menu`, `/near`, `/near/change` | `index_page.html`, `menu.html`, `near*.html` |
| Metric dictionary, Data notes, API docs | `/dictionary`, `/data-notes`, `/api-docs` | |
| Support, visual signifiers, nominate / submit a photo / your city | `/about` (`/support`), `/signifiers`, `/suggest-metric`, `/suggest-photo`, `/your-city` | |

The full list, with each page's nav label and group, is `views.json` (a snapshot of the API's
`/api/views`); the route table is `penlight_site.PAGES`.

## Run it

```bash
./run.sh
```

A venv, Flask and Jinja2. Open <http://localhost:1837>: the real site with real Chicago data —
no AWS credentials, no data pipeline, no database. Edit a template or a file under `static/` and
reload.

| Variable | Default | Purpose |
|---|---|---|
| `PENLIGHT_API_BASE` | `https://penlight.wardwise.org` | Where `/api/*` is forwarded |
| `PENLIGHT_SITE_BASE` | `https://penlight.wardwise.org` | Where links to signed-in pages (survey, account) point |
| `PROXY_ALLOW_WRITES` | `0` | `1` forwards POSTs upstream instead of stubbing them |
| `GA_ID` | unset | Google Analytics id to render (production sets it as a repo variable) |
| `PORT` | `1837` | The year Chicago was incorporated |

**Writes are stubbed by default.** The map POSTs an analytics event on every metric toggle;
clicking around locally shouldn't write rows into production, so the proxy acknowledges those
without forwarding. Local dev is always signed out (`/api/me` → 401), by design.

## How it deploys

```
push to main ─┐
push to next ─┴► GitHub Actions: build main → dist/, build next → dist/next/ ──► GitHub Pages
                                                                                  ▲        ▲
penlight.wardwise.org ──► CloudFront (origin path /) ─── default: pages ─────────┘        │
new.wardwise.org      ──► CloudFront (origin path /next) ─ default: pages ─────────────────┘
                          both: /api/* /login /account /admin/* /survey* /request-access
                                /metric-submissions /metric-recommendations /app-static/*
                                ──► the private Flask app on AWS Lambda (the same production API)
```

- `scripts/build_static.py` renders every template in `penlight_site.PAGES` to `dist/<path>/index.html`
  with `?v=<content hash>` asset URLs, plus `404.html`, `build.json` and `.nojekyll`.
  `python server.py --built` serves `dist/` exactly as Pages will.
- `scripts/check_build.py` fails the PR if a page is missing, lacks the build marker
  (`<meta name="penlight-build">`), or references an asset that wasn't copied.
- `.github/workflows/pages.yml` builds on every PR and deploys on `main` and `next` (see CONTRIBUTING for the two channels). **There are no cloud
  credentials in this repo and none are needed.** If a change seems to need an AWS secret here,
  that's the wrong design — open an issue.
- CloudFront answers `/metrics` with a 301 to `/reports` and rewrites `/report/<slug>/<id>` to
  the report page; the build also writes fallbacks for both so plain Pages works.
- Pages caches HTML for up to ten minutes, so a merge is live within a few minutes.

## How the pages get their data

Everything comes from the same-origin API at runtime. The three things the server used to inject
at render time are gone:

| Was | Now |
|---|---|
| `url_for('ui.…')` link targets | `penlight_site.make_url_for` knows the Flask endpoint names, so templates didn't change |
| `nav_groups` for the Explore menu | `views.json`, refreshed from `GET /api/views` when a view is added upstream |
| `user` (avatar menu, admin flags) | `static/account.js` asks `GET /api/me` (cookie, never cached) and fills the menu in |
| signifier photos on Support / Signifiers | `GET /api/signifiers/examples`, `GET /api/signifiers/groups` |
| the report's area from the route | `report.html` reads `location.pathname` |

## Stack

There is no bundler. No npm, no framework.

- **Jinja2** templates, rendered once by the build (and live by `server.py` in dev)
- **Vanilla JS** in IIFEs attaching to `window` (`WardWiseExplorer`, `WardWiseIcons`, `WardWiseMetricDetails`, …)
- **`static/styles.css`** plus a few page sheets (`report_ui.css`, `editorial.css`, `k3*.css`)
- **Leaflet 1.9.4** from CDN, OpenStreetMap tiles

## Provenance

The pages were cut from the private repo's `apps/ward_wise_explorer/` (last synced 2026-10-06,
when they were removed there). This repo is now the only copy. The K3 explorer at `/k3` is
Connor Florczyk's redesign from PR #1; the classic explorer stays at `/`.
