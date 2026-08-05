# ward-wise-frontend

The frontend for **Ward Wise Penlight** — a civic-data project built at
[Chi Hack Night](https://chihacknight.org/) that turns Chicago open data into neighborhood
wellbeing metrics anyone can explore, weight, and compare. Live at
[penlight.wardwise.org](https://penlight.wardwise.org).

This repo is the **UX half** of Penlight. It holds the three main views and nothing else:

| View | Route | What it is |
|---|---|---|
| **Map** | `/` | The landing page. A Leaflet choropleth of Chicago by ward, neighborhood, or χGRID, with a metric picker that rescores the map live. |
| **Metric dictionary** | `/dictionary` | Every measure: what it counts, its source, its coverage years, how it enters the composite. Grouped by wellbeing domain. |
| **Support** | `/support` (`/about`) | How residents contribute — nominate a metric, submit a photo, bring Penlight to another city. |

The data, the ETL pipeline, and the API live in
[HarryBrisson/ward-wise-civic-tech](https://github.com/HarryBrisson/ward-wise-civic-tech), and
will eventually move into their own APIs repo.

## Run it

```bash
./run.sh
```

That's the whole setup: a venv, Flask, and `requests`. Then open
<http://localhost:1837>. You get the real site with real Chicago data — no AWS credentials,
no data pipeline, no database.

## How it works

`server.py` is a ~120-line shell that does two things: render the three templates, and proxy
`/api/*` to the live Penlight API. Proxying (rather than calling the API cross-origin from the
browser) keeps every request same-origin, so there's no CORS to configure and no API key.

```
GET /dictionary  ->  templates/dictionary.html
GET /api/metrics ->  https://penlight.wardwise.org/api/metrics
```

The live API is the only backend you need; it's public and unauthenticated for these reads.

| Variable | Default | Purpose |
|---|---|---|
| `PENLIGHT_API_BASE` | `https://penlight.wardwise.org` | Where `/api/*` is forwarded |
| `PENLIGHT_SITE_BASE` | `https://penlight.wardwise.org` | Where out-of-scope links point |
| `PROXY_ALLOW_WRITES` | `0` | `1` forwards POSTs upstream instead of stubbing them |
| `PORT` | `1837` | The year Chicago was incorporated |

**Writes are stubbed by default.** The map view POSTs an analytics event on every metric toggle;
clicking around locally shouldn't write rows into production, so the proxy acknowledges those
without forwarding.

### Links that leave

Penlight has pages this repo deliberately doesn't carry — the reports page, metric nomination,
photo submission, the API docs, the submissions admin. Links to them resolve against
`PENLIGHT_SITE_BASE` and open on the live site rather than 404ing.

## Stack

There is no build step. No npm, no bundler, no framework.

- **Flask + Jinja2** for the shell and three templates
- **Vanilla JS** in IIFEs attaching to `window` (`WardWiseExplorer`, `WardWiseIcons`, `WardWiseMetricDetails`)
- **One hand-written stylesheet**, `static/styles.css`
- **Leaflet 1.9.4** from CDN, OpenStreetMap tiles

Edit a file, reload the page. `server.py` runs in debug mode, so templates and Python reload
themselves; static assets are cache-busted by mtime.

```
server.py               views + /api/* proxy
templates/
  base.html             layout: header, nav, stylesheet
  explorer.html         map view
  dictionary.html       metric dictionary
  about.html            support page
static/
  common.js             WardWiseExplorer — the API client, formatters, shared year math
  explorer.js           the map view (2,100 lines: Leaflet, choropleth, weights, modals)
  metric_details.js     renders the dictionary
  metric_icons.js       one inline SVG per metric
  about.js              support page
  dictionary.js         dictionary deep-links
  styles.css            everything
```

See [CONTRIBUTING.md](CONTRIBUTING.md) — including a list of good first issues.

## Provenance

Cut from `HarryBrisson/ward-wise-civic-tech` (private) at commit `b5ba7e4`
(`apps/ward_wise_explorer/`). Most files here are byte-identical copies, so fixes still port
cleanly in either direction. The deliberate differences:

- `base.html` drops Google Analytics and the whole auth branch — no login, no accounts.
- The Support page's rotating signifier photos moved from server-rendered Jinja into `about.js`,
  which fetches them from the area endpoints. That removed the last server-side data dependency
  in these three views (and, upstream, an S3 read on every page render).
- The dictionary was a subtab of `/reports` behind an `i` toggle; here it's a page of its own.
  `metric_details.js` is unchanged — it self-initializes on `#metrics-content`.
