# CTBP Interactome Atlas — CTBP1 + CTBP2

An offline, single-page, provenance-first research console profiling the **combined STRING
interactome of the CtBP corepressor paralogs CTBP1 and CTBP2**. It makes plain **what the two hubs
share and where they diverge**, and lets you trace **how either hub (or both) connects to any
partner gene**, directly or through intermediary genes.

Every number shown links to the live record that validates it. The inference engine never
special-cases a partner gene; all area memberships are decided by the data and proven by the test
harness.

## Reproducing it from the build prompts

The whole tool is generated from **two build prompts plus the logos**. To recreate it in a fresh
project, copy:

- `README.md` (this file)
- `app_build_prompt.md`
- `data/data_build_prompt.md`
- `logos/`

then ask your AI to build the project, by building the files **in this order**:

1. **`data/data_build_prompt.md` first.** It builds the `data/` pipeline (Python standard library
   only) and runs it to fetch the full dual-hub interactome of CTBP1 + CTBP2 from the public sources
   (STRING, Open Targets, IntAct, Europe PMC, UniProt, ClinVar, HPO, Reactome, GenAge, BioGRID),
   emitting `app-data.js`. Needs network (a few thousand API calls, plus a one-time ~171 MB BioGRID
   download that is filtered to a small committed extract and otherwise gitignored).
2. **`app_build_prompt.md` second.** It builds the front end (`index.html`, `app.js`, `engine.js`) and
   the test harness (`data/verify.js`), which read the `app-data.js` produced in step 1.

The front end has nothing to display until step 1 has produced `app-data.js`, so **the data prompt
must run before the app prompt**.

## Deploying (optional)

The app is offline-first: open `index.html` directly and it runs with no server. To publish it on the
web, a GitHub Actions workflow (`.github/workflows/deploy-pages.yml`, at the repository root) serves
this `Opus-4.8/` folder via GitHub Pages (branch deploy only allows the repo root or `/docs`, so the
nested folder is published through Actions instead). Set **Settings → Pages → Source** to **GitHub
Actions**; to switch which version folder is published, change the `APP_DIR` variable in that workflow.

— HADDTS Foundation
