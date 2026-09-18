# BNEF Summit London — site foundation

A static HTML/CSS/JS foundation for a redesigned BNEF Summit London registration
page. No build step, no dependencies — open `index.html` directly or serve the
folder with any static host.

## What's in here

- `index.html`, `assets/css/styles.css`, `assets/js/main.js` — the site shell:
  nav, hero, at-a-glance info, overview, venue, registration form, footer.
- `assets/js/agenda.js` — renders the Agenda and Speakers sections live from
  three BNEF event-platform APIs (schedule, speaker registrations, and the
  session ↔ speaker relationship graph). See the comment block at the top of
  that file for exactly how the data join works.
- `data/*.json` — a same-origin snapshot of those three APIs, kept fresh by
  the GitHub Action below. `agenda.js` tries the live API first and only
  falls back to these files when the live call fails (which it always will
  from any origin other than bbgevent.app — see the CORS note below).
- `.github/workflows/refresh-data.yml` — a scheduled GitHub Action that
  fetches the three APIs server-side every ~15 minutes and commits the
  results into `data/`. Server-side fetches aren't subject to browser CORS,
  so this is what lets the site show real, near-live data when hosted
  anywhere (GitHub Pages included) other than bbgevent.app itself.

## The CORS situation

The three bbgevent.app APIs this site reads from only send CORS headers that
allow `bbgevent.app` itself to read them. A browser fetch from any other
origin fails outright. Two real fixes exist for that (ask whoever owns the
API to allow-list this site's origin, or run a server-side proxy), but
neither was practical to set up as part of this static template, so instead
this repo carries its own workaround: the GitHub Action above refreshes
`data/*.json` on a schedule, and the site reads from those files whenever the
live call fails. That means:

- The demo works anywhere you host it, with data that's at most ~15 minutes
  stale.
- If the CORS policy is ever opened up (or this ends up hosted on
  bbgevent.app itself), the live fetch just starts succeeding and the
  snapshot becomes an unused safety net — no code changes needed.

## One-time setup after pushing to GitHub

1. **Enable Actions to write back to the repo.** Settings → Actions →
   General → Workflow permissions → "Read and write permissions" (Actions
   defaults to read-only, which would let the workflow fetch data but not
   commit it back).
2. **Enable Pages** (if you want a live URL): Settings → Pages → Source:
   Deploy from a branch → `main` / `/ (root)`.
3. **Run the workflow once** so `data/*.json` is populated immediately
   instead of waiting for the first scheduled run: Actions tab → "Refresh
   live event data" → Run workflow. After that it keeps itself fresh every
   ~15 minutes on its own.

## Known gaps before this goes live

- The registration form has no backend — `assets/js/main.js` has a stub
  `submit` handler marking where to wire in the real endpoint.
- Avenir Next P for BBG (Bloomberg's licensed corporate typeface) needs its
  actual font files added via `@font-face` — see the comment block at the
  top of `assets/css/styles.css`. It currently falls back to the system
  sans-serif stack.
- The venue image is an illustrated placeholder — swap in real photography
  when available.
- Only the "Main" agenda tab is built; the "Side Agenda" (1-1 meeting slots)
  isn't fetched — flagged with a note in the agenda section.
