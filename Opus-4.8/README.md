# CTBP Interactome Atlas — CTBP1 + CTBP2

An offline, single-page, provenance-first research console profiling the **combined STRING
interactome of the CtBP corepressor paralogs CTBP1 and CTBP2**. It makes plain **what the two hubs
share and where they diverge**, and lets you trace **how either hub (or both) connects to any
partner gene** — directly, or through intermediary genes.

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
   only) and runs it to fetch the full dual-hub interactome of CTBP1 + CTBP2 from the public sources,
   emitting `app-data.js`. Needs network (a few thousand API calls).
2. **`app_build_prompt.md` second.** It builds the front end (`index.html`, `app.js`, `engine.js`) and
   the test harness (`data/verify.js`), which read the `app-data.js` produced in step 1.

The front end has nothing to display until step 1 has produced `app-data.js`, so **the data prompt
must run before the app prompt**.

— HADDTS Foundation
