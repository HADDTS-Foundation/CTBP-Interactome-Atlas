# App Build Prompt — CTBP INTERACTOME ATLAS (CTBP1 + CTBP2)

> **Run order: `data/data_build_prompt.md` FIRST, then this.** The data prompt builds the pipeline and
> emits `app-data.js`; this prompt builds the front end (`index.html`, `app.js`, `engine.js`) and the
> test harness (`data/verify.js`) that read it. To reproduce the whole tool in a fresh project, copy
> only **`app_build_prompt.md` + `data/data_build_prompt.md` + `logos/`** and follow them in that order.
>
> Paste this whole document to Claude Code as the brief for building the app. It specifies the
> mission, the non-negotiable principles, the architecture, the data model (read side), the inference
> engine, the UI, the design system, and the test philosophy. Follow it exactly; where it gives
> formulas, thresholds or colour tokens, use them verbatim.

---

## 1. Mission

Build **CTBP Interactome Atlas** (the tool's name), a dual-subject atlas of the CtBP corepressor
pair. The header wordmark is a **two-tone logotype in one typeface (Hanken
Grotesk)**: the subject **`CTBP`** is bold (weight 700, `--on-surface` dark) and the product name
**`Interactome Atlas`** is the lighter accent (weight 400, `--secondary` teal); "Interactome" and
"Atlas" share **one** treatment (same font, weight and colour), never a different font from `CTBP`.
It is a self-contained, offline, single-page, mobile-first web app that profiles the combined
**top‑250 STRING interactors of *both* human paralogs, CTBP1 and CTBP2** (the CtBP corepressor pair),
and derives their biological / disease connections through a **transparent inference engine**. It
makes plain **what the two hubs share and where they diverge**, and it lets a reader trace **how
either hub, or both, connects to a chosen gene**, directly or through one or two intermediary genes
(see §1A). It is a research instrument for a working scientist, not a marketing demo: every number
shown must be traceable to a public source, and the engine must never special-case any partner gene.

Think "institutional modernist" bioinformatics console: dense, disciplined, authoritative.

---

## 1A. Dual subject hubs — CTBP1 + CTBP2

The subject is the **CtBP paralog pair, CTBP1 and CTBP2**, the two closely-related NAD(H)-sensing
transcriptional corepressors (CTBP2 is also CTBP1's single strongest STRING interactor). The tool
profiles the **combined interactome of both hubs** and makes the **shared vs. isolated** structure
legible. The two hubs are held in a `HUBS` list and the scoring is **symmetric** in them (§6); the
data model (§4) and pipeline (§5) carry both hubs plus a union node list with per-hub attribution.

### 1A.1 Hub selection (top-left of the left panel; **default Both**)

At the **top-left**, above every other control, a **hub selector** chooses the subject: **`CTBP1`**,
**`CTBP2`**, or **`Both`**. **The default is `Both`.** It is a single three-state segmented control
("Both" means the union, not a free-form multi-select). The whole app re-scopes to the choice:

- **`CTBP1`** or **`CTBP2`** alone: scopes to that hub's neighbourhood and that hub's STRING scores.
  Constellation centre, composite, connection type, fields and discoveries are all computed against
  the one selected hub.
- **`Both`** (default): the **union** of the two neighbourhoods. **Every interactor is attributed** to
  the hub(s) it actually connects to — **CTBP1-only**, **CTBP2-only**, or **shared (both)** — and that
  attribution is shown plainly: a per-node marker (e.g. a split/dual dot or a small `1`/`2`/`1+2`
  badge) plus a header roll-up ("‹s› shared · ‹a› CTBP1-only · ‹b› CTBP2-only"). The point of the
  combined view is that the user **can see which hub each interactor connects with**, and the
  shared set (genes both paralogs touch, i.e. the likely common corepressor core) stands out from the
  paralog-specific sets.

### 1A.2 Gene focus (directly under the hub selector)

**Directly under** the hub selector sits a **gene-focus selector**: pick **any one partner gene `G`**
from the (union) interactome. With nothing chosen, the views show the whole neighbourhood. Choosing
`G` enters **focus mode**, where the views answer **"how does the selected hub(s) connect to `G`?"**:

> **Focus applies the moment a valid gene is entered (input-driven, not blur-gated).** As soon as the
> typed text matches a partner gene (or one is picked from the datalist), the app enters focus mode and
> the focus-dependent views update **immediately**: the Network subgraph (re)draws, the dossier swaps to
> `G`, and the constellation highlights it. Bind this to the field's **`input`** event (which fires on
> every keystroke and on a datalist pick), **not** only to `change` (which a text input fires just on
> blur or Enter, leaving a found gene unreflected while the user is still in the field, a real usability
> bug). Keep `change` only as a redundant fallback. While the field is being edited, do **not** rewrite
> its value on re-render (guard on `document.activeElement`), so the cursor never jumps. Clearing the box
> (or pressing Escape) exits focus and restores the whole-neighbourhood view.

**Click model (single inspects, double traces).** A gene can also be reached **without** the selector:
**single-click** any gene (a Constellation/Network node, or a Table / Findings / Discoveries row) opens
its **dossier**; **double-click** the same gene **enters focus mode** (it becomes the focus gene and the
view jumps to the Network route subgraph). Double-click is the fast "trace this" shortcut and reuses the
same focus path as the selector; single-click stays non-destructive (dossier only). Wire it on every
gene element (both canvases and every row/card list), guarding against clicks on inner links.
**Keep the dossier-open gene and the focus gene as separate state** (e.g. `selected` vs `focus`):
opening a dossier (single-click) must **not** set the focus gene, or a real double-click, whose leading
click opens the dossier first, would clear the focus it is meant to set (the constellation highlight may
key off either). **Exiting focus must be obvious from inside the views:** give the Network view its own
visible **"Clear focus"** control (not only the focus box's `✕` and the drawer's `⌂ Hub`), and let
**double-clicking the already-focused gene toggle focus off**.

- **Direct** connection: `hub → G` (a direct STRING edge), shown whenever it exists, with its score.
- **Indirect** connection: when a hub does **not** directly neighbour `G`, surface the **mediated
  route(s)** `hub → M → G` — and, if no single intermediary exists, `hub → M → N → G` (**depth ≤ 3**) —
  through one or two **intermediary genes** `M`/`N` taken from the partner↔partner STRING graph
  (`edges`). Rank routes by path strength (max-product of edge scores) and show the few strongest, not
  every walk.
- With **`Both`** + a focused `G`, the view makes the **differential wiring** explicit. The worked
  example to support: *CTBP1 connects to `G` directly, while CTBP2 reaches `G` only via `Z`
  (CTBP2 → Z → G), and `Z` itself also links back to CTBP1.* That is the target picture: one hub binds
  the gene directly, the other is **mediated by a third (or fourth) gene**, and the intermediaries may
  **cross-link** back to either hub or to the chosen gene. Every edge on every route carries its STRING
  evidence and a source link (provenance rule §2.2 still applies, including the `↗` on linked values).

### 1A.3 The Network view

The **Network view** is the home for the focus-mode subgraph: it draws the **selected hub(s), the
focused gene `G`, and the intermediary genes `M`/`N` that bridge them**, with all the cross-links
between them. It is a force / graph layout; nodes are coloured by hub-attribution (CTBP1 / CTBP2 /
shared) and `G` is highlighted, and every bridging edge is labelled with its STRING score. Outside
focus mode with `Both` selected, the Network view can also render the **two-hub overview** (both
centres, the shared set between them, the two isolated sets to the sides) as an honest alternative to
the Constellation. While focused, the view shows a visible **"Clear focus"** control that returns it to
this overview (see the click-model note in §1A.2); a node's hit target should be a touch larger than its
drawn radius so small intermediaries are easy to click.

### 1A.4 Hub-independent biology

The per-gene biology is hub-independent: a gene's disease-area memberships, ClinVar,
HPO, Reactome, mechanism tags, literature and references describe **the gene itself**, so they render
identically regardless of which hub(s) it connects to. Only the **connection** (which hub, how strong,
direct or mediated) is hub-relative. The provenance-first, honest-about-limits, human-voice principles
(§2) apply verbatim to all the new copy.

---

## 2. Non‑negotiable principles (these override convenience)

1. **Offline‑first.** The app opens by double-clicking `index.html` (a `file://` page) with **no
   build step, no bundler, no framework, no network calls at load**. All data is bundled in a JS
   file. Links inside the app point to *live* sources for validation — **user-triggered, never at
   load** — but the app never needs them to run.
2. **Everything is sourced — and provenance comes first.** Every count, score, flag, interaction,
   pathway, phenotype and paper must carry a click-through to the exact live query/record that
   validates it. No unsourced numbers. No invented claims. State values plainly; never editorialise
   or round away precision. **Keep the provenance never more than one click away, not buried:** every
   shown value links directly to the live record that validates it. **Any value that is itself an
   outgoing link must carry a trailing `↗`** so the user can see it is clickable, including bare numbers
   (e.g. the ClinVar **P/LP / VUS / Total** counts render as `150 ↗`, `157 ↗`, `533 ↗`, not plain
   `150`). There is also a consolidated provenance strip
   (top, above the views) that gathers the gene IDs, *every* data source as a link, the snapshot/"Built"
   date, the "How was this built?" methods link, and the Export, all in one place. That strip is
   **collapsed by default** for a clean first paint but is **always one click away** via a persistent
   header **ⓘ Sources** toggle (it is never permanently removable). The deliberate trade: a clean
   initial view over forcing the sources in front of a first-time reader — acceptable only because the
   strip is one obvious click away and every individual number still carries its own source link.
3. **No gene is ever special-cased.** The engine receives only raw evidence and treats every gene
   identically. No partner symbol may appear in a scoring branch. The *only* gene-ish tokens
   allowed in the engine are: the **two subject hubs `CTBP1` and `CTBP2`** (held in a `HUBS` list and
   never special-cased against each other; the scoring is symmetric in the two), and a documented
   literature stop-list (`IMPACT, GAPDH, TBP, ACTB, B2M`).
4. **Editorial choice vs. data-driven membership.** It is legitimate to *choose which disease
   areas to display* (an editorial focus). It is **not** legitimate to decide *which genes* fall
   in them by hand. Area membership is 100% a function of the data, and the test suite proves it
   (see §9).
5. **Falsifiable tests.** The test harness asserts **generic invariants and data integrity**, never
   predetermined biological conclusions. It must be possible for the engine to disagree with the
   author's expectations and still pass.
6. **Substance over flash.** Prefer a table when a table is the right tool. Plain-language ⓘ
   definitions for every technical term. Provenance and real references over visual spectacle.
7. **Honest about its own limits (no false authority).** Every ⓘ glossary tooltip must **define the
   term *and* state plainly what it is not** — because much of what the tool shows is heuristic, not
   measured. Required framings, in the tooltips themselves: the **composite** is a *heuristic
   prioritisation score, not a probability or a measure of importance*, and its weights are an
   *editorial choice*; **STRING/IntAct** values are *confidence, not proof of direct binding*, so
   "Core complex"/"Physical interactor" are labels of strong support, not proven complexes;
   **co-mention / Literature** is *correlation, biased toward well-studied genes — not interaction*;
   **Network context** is *topology, not functional proof*; **mechanism tags** are *keyword matches,
   suggestive not evidential*; **Reactome/HPO** are *the gene's own annotations, not a shared-with-CTBP1
   or patient-specific claim*; **ClinVar P/LP and VUS** are *gene-level database tallies — not a
   clinical interpretation of any individual, and not medical advice*; and the **Fields** are
   *editorial rules the data is then filtered by, not objective facts*. The **AI-context** tip must warn
   that an LLM can over-interpret and that answers should be checked against the linked sources. This
   principle overrides any temptation to make a number look more authoritative than it is.
8. **Human voice in all user-facing copy.** No spaced em dash (` — `) as a sentence connector anywhere
   a user reads it (tooltips, notes, captions, labels, button titles, dropdown text, the AI-context
   dump, the README). The spaced em dash is a tell that reads as machine-written; use a comma,
   semicolon, colon, period, or parentheses instead, whichever fits the sentence. Keep the en dash in
   numeric ranges (`0–100`, `0–1`) and hyphens in compound words; a lone `—` as a table "no value"
   glyph is fine. (This applies to user-facing text; the dashes in source-code comments and in this
   spec document are not user-facing.)

---

## 3. Tech & architecture

Vanilla HTML/CSS/JS. No dependencies. Four front-end files + a stdlib-Python data pipeline + a Node
test harness.

The design system is defined **inline in this brief** (§10) — there is no external design export.

The file roles:

| File | Responsibility |
|---|---|
| `index.html` | UI shell, all CSS (the design system lives here, §10), font stacks with system fallback. |
| `app.js` | Rendering, interaction, the drawer, views, discoveries, export. **Reads** `window.CTBP_DATA` + `window.CTBP_ENGINE`. Wrapped in an IIFE. Owns the **hub selection** (`CTBP1` / `CTBP2` / `Both`, default `Both`) and the **focus-gene** state. (No live-network probe / "how to read" modal; methods live in this brief; the composite weights are fixed constants, not a live control.) |
| `engine.js` | The **pure inference engine** (no DOM, no hard-coded genes; the only allowed tokens are the two hubs + the stop-list). Exposes `window.CTBP_ENGINE`. All scoring/classification/paths live here, **hub-parameterised** (§6). |
| `app-data.js` | **Input (read, not built here).** The evidence snapshot `window.CTBP_DATA = {…}` (two hubs + union nodes), produced by `data/data_build_prompt.md`. |
| `data/*.py` | The fetch/build pipeline that produces `app-data.js` — **specified and built by `data/data_build_prompt.md`** (run first), not by this prompt. |
| `data/verify.js` | Node test harness this prompt produces — `eval`s `app-data.js` + `engine.js` and asserts invariants (§9). |
| `fonts/` *(optional)* | Not present by default. To pin the exact families (Hanken Grotesk, Inter, JetBrains Mono) offline, drop their woff2 here and add `@font-face` rules in `index.html`; otherwise the CSS falls back to system fonts (§10). |
| `logos/` | The HADDTS Foundation brand marks; the theme-aware vertical pair is wired into the header (§10). |
| `README.md` | The project front page — a short intro plus the **"Reproducing it from the build prompts"** workflow: copy `README.md` + `app_build_prompt.md` + `data/data_build_prompt.md` + `logos/`, then run the data prompt, then this app prompt. |

Open with `?noboot` in the URL to skip the intro animation (used by the headless tests).

**Headless-testing note:** verify the DOM/computed-state via the DevTools protocol (Brave/Chrome
`--headless=new --remote-debugging-port=…`, driven by Node's built-in `WebSocket` + `Runtime.evaluate`).
The central `<canvas>` may render blank in some `--disable-gpu` screenshot captures — that is a
capture quirk, not a bug; assert state via the protocol, not pixels.

---

## 4. Data model (`window.CTBP_DATA`)

Bundle a single JSON object, minified (`json.dumps(data, separators=(',',':'))`). The global is
**`window.CTBP_DATA`**. The model holds **two hubs** plus a **union** node list with **per-hub
attribution**.

> **`app-data.js` is produced by `data/data_build_prompt.md`, which you run FIRST.** This section is
> the read-side contract the front end relies on; treat `app-data.js` as a provided input. The full
> fetch/build pipeline and sources live in that data prompt (§5 here is just a pointer to it).

```
{
  hubs:{                          // BOTH subject hubs
    CTBP1:{ sym:'CTBP1', name, summary, uniprotFunc, cofactor, subunit:[…],
            go:{MF:[…],BP:[…],CC:[…]}, reactome:[…],
            ids:{ ensembl:'ENSG00000159692', entrez:'1487', uniprot:'Q13363', string:'…' },
            litTotal, diseaseCount, dis:[{n,s},…], tract:[…],
            clinvar:{plp,vus,total}, phenotypes:[…], phenoCount,
            refs:[{pmid,t,a,y,j,c},…], agingRefs:[…], mim },
    CTBP2:{ sym:'CTBP2', name, summary, …same shape…,
            ids:{ ensembl:'ENSG00000175029', entrez:'1488', uniprot:'P56545', string:'…' },
            note:'CTBP2 also encodes RIBEYE (retinal ribbon-synapse protein) via an alt promoter' }
  },
  hubEdge:{ s:{c,e,d,t,a,p,n,f} },  // the CTBP1↔CTBP2 STRING interaction itself (each is the other's top partner)
  nodes:[ {                       // UNION of CTBP1's + CTBP2's top-N partners, deduped by gene:
    sym, name, ensembl, entrez, uniprot, mim,
    hubs:['CTBP1','CTBP2'],       // which hub(s) it connects to: ['CTBP1'] | ['CTBP2'] | both
    rank1, rank2,                 // rank within each hub's neighbourhood (null if not that hub's neighbour)
    s1:{ c,e,d,t,a,p,n,f }|null,  // STRING channels to CTBP1 (null if not a CTBP1 neighbour)
    s2:{ c,e,d,t,a,p,n,f }|null,  // STRING channels to CTBP2 (null if not a CTBP2 neighbour)
    // Co-mention is HUB-INDEPENDENT literature (a property of the papers, NOT the STRING
    // graph), so it is computed and present for EVERY gene against BOTH hubs and both
    // together, regardless of which hub(s) the gene STRING-neighbours. (Only rank/s are
    // structural; see below.) A gene can be discussed with a paralog it does not neighbour.
    lit1, lit2,                   // co-mention count with each hub = comention{1,2}.all (synonym-aware, §8)
    comention1:{title,abs,all}, comention2:{title,abs,all},  // per-hub co-mention, NESTED scopes:
                                  //   title ⊆ title+abstract ⊆ full text (so title ≤ abs ≤ all).
    comentionB:{title,abs,all}, litB,  // BOTH-hub co-mention (gene named with CTBP1 AND CTBP2
                                  //   together), same nested tiers. litB = comentionB.all.
    // ── hub-independent per-gene biology (identical whichever hub it connects to) ──
    dz, tract:[…], areas:{ "<EFO therapeutic area>": score, … }, dis:[{n,s},…],
    func, funcRefs:[…], refs:[…], syn:[…],
    intact:{type,direct,miscore,methods:[…],pmids:[…],count},
    biogrid:{count,methods:[…],pmids:[…]}|absent,  // BioGRID curated PHYSICAL interactions with the
                                  //   hub(s): HUMAN only, yeast-two-hybrid EXCLUDED (release id in meta).
                                  //   Combined across hubs like `intact`; present only when count ≥ 1.
    clinvar:{plp,vus,total}, pathways:[…], phenotypes:[…], phenoCount,
    aging:{ genage:bool, longevity:bool, why, id, pmids:[…] }   // present only if a member
  }, … ],
  edges:[ {a,b,s}, … ],           // partner↔partner STRING edges over the UNION (context + path-finding)
  meta:{ date, species, hubs:['CTBP1','CTBP2'],
         neighborhood:{ CTBP1:n1, CTBP2:n2, shared:k, union:N },
         sources:[…], channelLegend, edgeCount, nodeCount }
}
```

STRING channel keys (inside `s1` / `s2`): `c`=combined, `e`=experiments, `d`=databases,
`t`=text-mining, `a`=co-expression, `p`=fusion, `n`=neighborhood, `f`=co-occurrence. A node carries
`s1` **and/or** `s2`; its `hubs` array is exactly the set of hubs for which the score is non-null
(this is what drives the **shared / CTBP1-only / CTBP2-only** attribution in §1A). **Two kinds of
per-hub field, and they behave differently:** `s1`/`s2` and `rank1`/`rank2` are **structural** (STRING
neighbourhood) and are present **iff** the node neighbours that hub. `comention1`/`comention2`,
`lit1`/`lit2` and `comentionB`/`litB` are **hub-independent literature** (co-occurrence in papers, which
has nothing to do with the STRING top-250) and are therefore present for **every** node, both hubs,
whether or not it neighbours them. So a `CTBP1-only` gene still carries its `CTBP2` (and both-hub)
co-mention, and the dossier shows all of it (flagging the non-neighboured hub as "literature only");
hiding it would be inaccurate, since the gene genuinely appears with that paralog in the literature. A
STRING score may carry the full channel set or, where only the combined confidence is on record, just
`c` (other channels null); the engine reads whatever channels are present (`num()` treats a missing
channel as 0) and the UI marks a combined-only edge as such. A co-mention tier may still be `null` only
if that query genuinely failed to fetch; the dossier then says so.

---

## 5. Data sources & pipeline → `data/data_build_prompt.md`

The data fetch/build pipeline and the full source list are specified in **`data/data_build_prompt.md`**,
which you **run first**. It builds the `data/` pipeline (Python standard library only), fetches both
hubs' STRING neighbourhoods symmetrically from the public sources (STRING, Open Targets, IntAct,
Europe PMC, UniProtKB, NCBI ClinVar, HPO, Reactome, GenAge / LongevityMap, MyGene, BioGRID), merges
them, and emits `app-data.js` matching §4. Build the front end against the resulting `app-data.js`.

Two cross-cutting rules the front end must honour so its links reproduce the pipeline's counts:
- **Europe PMC co-mention** — the in-app query builder must be **byte-identical** to the pipeline's
  (the synonym-aware, tiered, lncRNA-excluded rules in §8). Same query string → same count.
- **ClinVar** — the in-app P/LP · VUS · Total count links must use the exact `[Filter]` tokens the
  pipeline used (`clinsig_pathogenic`, `clinsig_likely_path`, `clinsig_vus`), never `[Clinical significance]`.

---

## 6. The inference engine (`engine.js`)

A pure module. Receives only `CTBP_DATA`. Same logic for every gene, and **symmetric in the two hubs**.
Every hub-relative computation takes a hub argument (`'CTBP1'` | `'CTBP2'`) and reads that hub's
fields: `s` below means **`s1` for CTBP1, `s2` for CTBP2**, and `node.lit` means `lit1`/`lit2`
accordingly. In the **`Both`** view the engine computes each value **for each hub the node connects to**
and combines as noted at §6.1. A node is only scored against a hub it actually neighbours (`s1`/`s2`
non-null).

### 6.1 Connection score (weights are **fixed constants** `phys 0.5 / lit 0.3 / ctx 0.2`, no UI sliders; computed **per hub**)
- **Physical** `phys = clamp(s.e + 0.5·s.d)`, STRING **experiment + curated-DB channels only** (`s` =
  the active hub's `s1`/`s2`). The combined score `s.c` is **deliberately excluded** (it folds in
  text-mining and would double-count literature, e.g. inflating a text-only pair to a fake "physical").
- **Literature** `lit = log10(litEff+1) / log10(MAXLIT+1)`, where `litEff = 0` for stop-listed
  symbols (`IMPACT, GAPDH, TBP, ACTB, B2M`), else the node's co-mention with **that hub** (`lit1`/`lit2`).
- **Network context** `ctx = clamp(CTXRAW / MAXCTX)`, `CTXRAW` = summed partner↔partner edge
  weight (excluding **both** hubs).
- **Composite** `= 100 · (W.phys·phys + W.lit·lit + W.ctx·ctx) / (W.phys+W.lit+W.ctx)`, computed per
  hub. **`Both` view:** a node's headline composite is the **max** of its two per-hub composites (a
  gene prominent with *either* paralog ranks high), with **both** per-hub values kept and shown; the
  shared / CTBP1-only / CTBP2-only attribution rides alongside the number, never folded into it. (Max
  is a stated, tunable choice, like the weights.)

### 6.2 Connection type (keys off **physical** evidence, never the DB channel alone)
```
Core complex          if s.c ≥ 0.9 AND (s.e ≥ 0.5 OR IntAct direct)
Physical interactor   else if s.e ≥ 0.2 OR IntAct (direct|physical association) OR BioGRID physical
Literature-linked     else if lit ≥ 0.6 AND phys < 0.45
Functional neighbour  else if ctx ≥ 0.45 AND phys < 0.45
Associated            otherwise
```
A DB-only pair must **never** be typed as a physical complex member. **BioGRID physical** = `node.biogrid`
present with `count ≥ 1`; because that layer is already curated to **human, physical, yeast-two-hybrid-
excluded** experimental evidence (§8), it is admitted to the **Physical interactor** tier alongside
IntAct (it is experimental support, not the STRING DB channel, so the "never DB-only" rule still holds).
**Core complex** stays stricter (IntAct *direct* or strong experiments), so BioGRID alone does not
promote a pair to Core.

### 6.3 The fields — five SECTOR fields + cross-cutting overlay/filter fields (read §2.4)
Ten **fields** (biology/disease lenses), in this order, each shown as a lens, a per-gene flag, and a
findings row. The **first five are SECTOR fields** (oncology, metabolic, neurodegeneration, CNS,
neurodevelopment) — these, and only these (`sector:true`), are the constellation's angular wedges and
decide a node's colour (its *dominant* field). The rest are **cross-cutting overlay/filter fields**:
they never own a wedge — they filter *every* view, and **Aging** additionally paints a gold halo on
its members. In the left panel all ten sit in one flat **"Fields"** list (no divider). **Which**
fields to show is editorial; **which genes** belong is decided only by the data via the field's
`kind` (`ot` = EFO area-sum > 0.15, `name` = OT disease-name match, `aging` = GenAge ∪ LongevityMap).
Adding/removing an `ot` field is just a `THEMES` entry (EFO key + threshold) — no engine logic.

| key | label | colour (`--area-<key>`) | sector? | `kind` & membership rule |
|---|---|---|---|---|
| `oncology` | **Oncology** | `#e11d48` | ✓ | `ot` — EFO sum `"cancer or benign tumor" > 0.15` |
| `metabolic` | **Metabolic disease** | `#0d9488` | ✓ | `ot` — EFO `"nutritional or metabolic disease" + "endocrine system disease" > 0.15` |
| `neurodegen` | **Neurodegeneration** | `#d97706` | ✓ | `name` — OT disease names match Alzheimer/Parkinson/ALS/Huntington/dementia/… |
| `cns` | **CNS / neuroscience** | `#7c3aed` | ✓ | `ot` — EFO `"nervous system disease" + "psychiatric disorder" > 0.15` |
| `neurodev` | **Neurodevelopment (incl. ASD)** | `#2563eb` | ✓ | `name` — OT names match autism/ASD + intellectual disability + developmental delay + DEE |
| `aging` | **Aging / longevity** | `#ca8a04` | — | `aging` — `node.aging` present (GenAge ∪ LongevityMap); also a gold halo |
| `immunity` | **Immunity** | `#16a34a` | — | `ot` — EFO `"immune system disease" > 0.15` |
| `cardiovascular` | **Cardiovascular** | `#db2777` | — | `ot` — EFO `"cardiovascular disease" > 0.15` |
| `hematologic` | **Hematologic (blood)** | `#c2410c` | — | `ot` — EFO `"hematologic disease" > 0.15` |
| `eye` | **Eye / vision** | `#0891b2` | — | `ot` — EFO `"disorder of visual system" > 0.15` |

**Field colour palette (light mode — pinned, canonical).** Tuned for visibility on the light
design-system surface (§10) (saturated Tailwind-scale tones, spaced for mutual distinctness on white).
Define each in `index.html :root` as `--area-<key>` (e.g. `--area-oncology:#e11d48`). Apply per the §10
component notes:
- **Constellation node fill & angular wedge** (the 5 `sector` fields only) = the solid `--area-<key>`.
- **Gene-category chips & flags** = a solid dot in `--area-<key>` + a pale tint background
  `color-mix(in srgb, var(--area-<key>) 12%, var(--surface-container-lowest))` + a `color-mix(… 30% …)`
  hairline + **dark text** (`--on-surface` `#0b1c30`) — never coloured text (the §10 chip spec).
  All chip text (gene-category chips, **Clinical-phenotype terms**, mechanism tags, GO terms) is set in
  the **body sans** (`--sans`, Inter) — the same family used everywhere — **never the mono face**;
  monospace is reserved for numbers/IDs (`numbers in tabular/mono for alignment`), so natural-language
  term labels like phenotype names must not render in JetBrains Mono.
- **Discovery-card top-border** and **Findings row left-border** = the solid `--area-<key>`.
- **Aging** is the only **gold** (`#ca8a04`) and the only overlay that paints a soft halo on its members —
  `color-mix(in srgb, var(--area-aging) 55%, transparent)` glow — and it never fills a wedge.
- Distinctness guards: gold is reserved for aging; amber `#d97706` = neurodegeneration and deep-orange
  `#c2410c` = hematologic are kept clear of it. `color-mix` is supported by the Chromium target; if you
  avoid it, precompute the 12 % / 30 % tints to static hexes.

Rules:
- **Disease-name floor** (applied uniformly, suppresses noise): a disease counts if `s ≥ 0.18`,
  **or** it is in the gene's top‑3 associations **and** `s ≥ 0.10`.
- For `ot` areas, `re` (a disease-name regex) is used **only** to list example diseases as
  provenance; membership is the area-sum.
- **Strength** (0–1, for ranking/colour): `ot` = area-sum / total-area-burden; `name` = top
  matching association score; `aging` = 0.6 (GenAge) / 0.45 (LongevityMap-only).
- **Dominant area** (drives the node colour) = the strongest **disease** area. **Aging is an
  overlay** and is excluded from the dominant choice unless the gene belongs to no disease area
  (so e.g. a curated-ageing cancer gene still colours by cancer).
- Each membership ("flag") carries `{key,label,theme,source,sev,top,matches}` where `top` is the
  exact sourced evidence (an OT disease + score, or a GenAge/LongevityMap reference). `sev =
  clamp(round(strength·3),1,3)`. **Flags ARE memberships** — no separate hand-picked severity list.

### 6.4 Mechanism tags (separate from disease areas)
Match function text uniformly: `redox` (NAD⁺/NADH/oxidoreductase/dehydrogenase/sirtuin), `chromatin`,
`repress` (co-repression), `wnt` (Wnt/EMT), `synaptic`, `apoptosis`. **NAD⁺/redox is a mechanism
tag — it is NOT the Aging area**.

### 6.5 Paths, discoveries, synthesis, roll-ups
- `path(hub, to)` / `routes(hub, to, {maxDepth:3, top:k})`, the engine of §1A.2:
  - **hub → a gene in its own neighbourhood:** return the **direct edge** (the common case).
  - **hub → a gene it does NOT directly neighbour** (possible because `nodes` is the *union* of
    both hubs, so a CTBP2-only gene has no `s1` edge to CTBP1, and vice-versa): return the strongest
    **mediated route** `hub → M → to` over `edges`, or `hub → M → N → to` when no single intermediary
    exists (**depth ≤ 3**), ranked by **max-product of edge scores**; return the few strongest routes,
    not every walk.
  - **focus mode:** for a focused gene `G` and the active hub selection, run this from **each** selected
    hub, so the **differential wiring** is explicit (one hub direct, the other mediated by `M`/`N`,
    intermediaries cross-linking back to a hub or to `G`). Each edge on each route carries its STRING
    score and source link.
  - **Avoid spurious detours:** a direct edge always wins — never route a pair through the ~0.999
    corepressor-hub clique when a direct edge exists. A mediated route is shown when (and only when)
    the direct edge is absent, where it is real evidence of how the two hubs reach a gene differently.
- `discoveries(W, hubSel)`: a blended, de-duplicated, diversity-capped feed (strongest connections,
  best exemplar per disease area, most co-mentioned, under-explored hypotheses = high physical + thin
  literature). One gene appears at most once. In **`Both`** mode it additionally surfaces **paralog
  contrasts**: genes that are **shared** (both hubs) vs. **divergent** (strong with one hub, absent or
  weak with the other), since those are the most interesting CtBP-family leads.
- `synthesis(W, hubSel)`: a data-derived lead+body (factual; CtBP1 and CtBP2 are paralogous
  NAD(H)-sensing transcriptional corepressors). In `Both` mode it states the shared-vs-divergent
  headline counts.
- `themeSummary(W, hubSel)`: membership per area (`themes[key] > 0`), exposure ranked by **gene count**.
- `findings(W, hubSel)`: one row per (gene × area membership), each fully sourced.

Export: `HUBS, THEMES, THEME_ORDER, MECH, classify, connection, analyse, path, routes, discoveries,
themeSummary, themeExposure, synthesis, findings, …`. Hub-relative functions take the hub / hub-selection
argument; `analyse(W, hubSel)` returns the scoped, attributed node list (with each node's `hubs` set and
its per-hub composites).

---

## 7. The UI (`app.js` + `index.html`)

The **header + insight bar** form a *provenance strip* — *what* the data is, *where* it comes
from (every source linked), and *how it was built* — sitting above the views and **one click away**
via the header **ⓘ Sources** toggle (collapsed by default; see the Insight-bar bullet).

- **Header**: kept deliberately minimal — the controls (☰) icon, the brand lock-up (the **CTBP
  Interactome Atlas** wordmark **first** — bold dark **`CTBP`** + lighter teal **`Interactome Atlas`**,
  one typeface, two tones (the lighter weight-400 `--secondary` treatment covers the whole product
  name "Interactome Atlas") — then a **smaller** HADDTS Foundation logo as the trailing secondary
  mark, separated by a hairline divider — never the logo first). The **wordmark is a "home"
  control**: clicking the **`CTBP Interactome Atlas` wordmark** behaves exactly like the drawer's
  **⌂ Hub** button (`goHub()`), clearing any gene/lens/focus selection and returning the drawer to the
  current hub selection (CTBP1, CTBP2, or the paired view in `Both`). The trailing **HADDTS Foundation
  logo links to the foundation website** (`https://www.haddtsfoundation.org`, new tab) — it must
  `stopPropagation()` so clicking the logo opens the site rather than also firing `goHub()`. Neither is
  a link to `app_build_prompt.md` (the "How it was built" methods link lives in the insight strip's
  `Method →` pair). The header also carries the sources toggle, an **icon-only `ⓘ` button** (the
  "Sources" label is dropped; the `title`/`aria-label` still name it), the
  dossier (▤) icon, and, pinned at the **top-right**, a **dark-mode toggle** (☾ in light / ☀ in
  dark). The toggle flips `<html data-theme="dark">`; **light mode is the canonical design and stays
  exactly as specified** (the `:root` tokens), while **dark mode is a token-override-only theme**
  (`[data-theme="dark"]` re-defines the surface / text / accent custom properties — the pinned
  `--area-<key>` functional-area hues are left identical). The choice **persists** in `localStorage`
  (`ctbp-theme`, offline-safe, default **light**), `initTheme()` sets it before first paint to avoid a
  flash, and the canvas constellation re-themes its two light-assuming colours (selected-node ring, hub
  fill) off the active theme. The few elements with **hardcoded translucent-white backgrounds** — the
  constellation **legend** (bottom-left) and the **hint** card (top-right "click a node …") — are
  overridden to a dark translucent card in dark mode (`rgba(16,24,40,…)`) so they don't glow bright.
  (The hint text reads "click a node for its dossier · double-click to trace its route · gold halo =
  aging-linked" — it must **not** mention "drag weights", since the weight sliders were removed.) Unlike the desktop-only `.iconbtn`s
  (hidden ≥1024px), the theme toggle is
  its own always-visible control (shown in both the mobile and desktop layouts). The build-date,
  Export, and "How was this built?" actions are **not** in the
  header — they live in the closable insight strip below, which the **ⓘ Sources** button opens/closes
  (the strip is **closed by default** — see next bullet). (Methods/glossary live in the build prompt now;
  the composite weights are fixed, so there is no Evidence-weighting control and no separate
  Re-analyze/Live-data/How-to-read button. Per-block AI copy stays on every drawer's `<pre>`; the
  copy-all hook also backs the Export action.)
- **Insight bar (the closable meta/provenance strip)**: a compact, link-first strip. Its first row is
  the gene **IDs + dataset meta**, and below it a one-line **"what it profiles + sources" caption**.
  - **First row — a list of named source links, each with a trailing `↗`, styled exactly like the gene
    dossier's "Open in databases" block (NOT `LABEL→value` mono pairs, NOT boxed pills, NOT a
    middot-separated band of label+value items).** Each source is shown as its **name** as a small
    **outlined pill** (`.links` style: `--sc-low` background, `--outline-variant` hairline, muted
    `--on-surface-variant` text, **cyan border on hover**) with a trailing external-link `↗` glyph — e.g.
    `STRING ↗ · Open Targets ↗ · UniProt ↗ · NCBI Gene ↗ · Ensembl ↗ · OMIM ↗` — the **same `.links`
    pill identity** the dossier's **Open in databases** section uses, so the strip row and the dossier
    block read as one family (reuse the same `.links` CSS class; do not invent a parallel style). Each
    link points to a hub's live record in that source. **Dual-hub:** the strip shows the ID pills for
    the **selected hub**, and for **both CTBP1 and CTBP2** when `Both` is active (grouped/labelled per
    hub). The IDs live **here, not in the header**.
    The **literal ID strings are no longer printed** in the strip — the row no longer reads
    `ENSEMBL ENSG00000159692 · ENTREZ 1487 · …`; the named pill *carries* the ID (it resolves to that
    record), so the bare ID value is dropped for a cleaner band. One treatment for the whole row: pill +
    `↗`, same size, **no per-item small-caps field labels and no `LABEL→value` pairs**. `Method ↗`
    (the "How it was built" link to this `app_build_prompt.md`) renders in the **same named-link-with-`↗`
    style** as the sources. The **Export** action is the one deliberate exception to the uniform pill
    row: it reads **`⧉ Export AI Context of all Interactions`** with the **copy (`⧉`) glyph, not a `↗`**
    (it copies to the clipboard rather than opening a link), so it stands out as a clearly-labelled
    call-to-action.
    The dataset **meta** that used to sit in the header — `Built ‹date›`, `Genes ‹n›`, `Edges ‹m›` — are
    static counts (not links, so they take no `↗`); keep them as plain small-caps `LABEL value` items,
    visually subordinate, set **after** the link list (or fold them into the caption's lead line) so they
    never break the link row's rhythm.
  - **Caption**: a bold **lead line** ("‹n› STRING interactors of human CTBP1 — the top-250 by combined
    score…", snapshot date) above a labelled **Sources** line (STRING / Open Targets / Europe PMC /
    IntAct / ClinVar / HPO / Reactome / GenAge, each linked, middot-separated).
  - **Closed by default, toggleable.** The strip starts **collapsed** on load (class `hidden`); the
    header **ⓘ Sources** button toggles it open/closed and reflects state via `aria-pressed`, and the
    strip's own ✕ closes it. (It is a one-click reveal, not a one-way permanent dismiss — there must
    always be a way to bring it back.) No persistence: it reopens collapsed on the next load. (No
    synthesis sentence in the bar — `synthesis()` still feeds the hub AI block.)
  - **Export** copies the *entire* sourced AI context (**both hubs**, all ten fields, every interactor
    with its per-hub attribution and connection, via the `copyAllContext()` / `aiForAll()` dump) to the
    clipboard as plain text for
    pasting into an LLM. The button reads **`⧉ Export AI Context of all Interactions`** with the copy
    glyph; the size (~500,000 tokens) and the full "hub + all fields + every interactor" explanation
    live in its `title` tooltip.
  - **Offline recommendation.** The strip carries a clean, **neutral** notice card (`.offline-note`,
    `--sc-low` background with an `--outline-variant` hairline — **not** red): a **heading line**
    ("Consider running this tool offline", display font, on-surface) above a **muted body**: *"This page
    is served over the internet via GitHub Pages. For a permanent, fully self-contained copy that works
    anywhere with no connection, download it from the HADDTS Foundation on GitHub ↗"* (the link, cyan,
    points at the foundation's GitHub repo). (It currently lives inside the desktop-only,
    collapsed-by-default strip; promote it to an always-visible bar if every visitor must see it.)
  - **Desktop-only.** This closable strip is a **desktop affordance**: on viewports `< 1024px` it is
    **never opened/shown at all** (`@media(max-width:1023px){ .insight{display:none} }`), and the
    header **ⓘ Sources** toggle is hidden there too. The meta actions (Export especially) and the
    source links are therefore desktop-only; mobile keeps the header + views uncluttered.
- **Left panel**, top to bottom:
  1. **Hub** (§1A.1, **the very top-left control**): a three-state segmented control
     **`CTBP1` / `CTBP2` / `Both`**, **default `Both`**. It re-scopes the entire app and, in `Both`,
     turns on the shared / CTBP1-only / CTBP2-only attribution.
  2. **Focus gene** (§1A.2, **directly under Hub**): a searchable selector over the union interactors.
     Pick a gene `G` to enter **focus mode** (how the selected hub(s) reach `G`, directly or through
     one or two intermediary genes); clear it to return to the whole neighbourhood. This **subsumes the
     old "Trace connection"** control: tracing a gene is now this selector, and it can present mediated
     routes, not only a direct edge. **It reacts on `input`** (every keystroke and datalist pick), so
     focus engages the instant the typed symbol matches a gene and the views update immediately; it must
     **not** wait for a blur/Enter `change` event (see the focus-immediacy note in §1A.2).
  3. **Fields (lenses):** one flat list of all ten fields (five sector fields, then aging / immunity /
     cardiovascular / hematologic / eye). Click a field to focus it (every view filters to just that
     field; click the focused lens again to reset; the Findings area-chips mirror this).
  4. **Display limit:** how many top interactors to draw, its own section with a one-line note.

  **There is no Evidence-weighting control** (the §6.1 weights are fixed constants; the former three
  physical/literature/network sliders are dropped, re-weighting moved genes only marginally). There is
  **no Layout toggle** for the Constellation (a single canonical **sector** layout). The left panel has
  **no footer** (the former bottom **⚙ Methods / ◎ Sources** links are removed; methods live in the
  insight strip's `Method →` link and the sources in the **ⓘ Sources** strip).
- **Center — five views** (Constellation · Table · Findings · Discoveries · **Network**, see §1A.3):
  1. **Constellation** — the **selected hub at centre** (in `Both`, CTBP1 and CTBP2 share the centre as
     a paired hub); interactors placed by dominant area (angular sector + colour) and connection
     strength (radius); pulse = strong area assoc. In **`Both`**, each node also shows its **hub
     attribution** (a dual/split marker or `1`/`2`/`1+2` badge) so shared vs. paralog-specific genes are
     legible at a glance. Placement is **always by sector** (no alternative radial layout). (No
     "druggable" indicator:
     Open Targets *tractability* measures whether a molecule could engage a protein, not whether one
     should — e.g. a tumour suppressor like p53 would be *restored*, not inhibited — and it flags
     ~half the neighbourhood, so it carries little signal. The full tractability data stays one click
     away via the gene's Open Targets link.) Because **aging is an overlay** (never a gene's dominant
     area), the constellation has only the **five disease sectors** — aging gets no sector of its own.
     Instead, the genes that *are* aging members carry a soft **gold longevity halo** wherever they
     sit — an honest overlay (a property of genes); gold denotes aging only. Papers are **never**
     placed as nodes in the gene map: each hub's curated ortholog-aware reading list
     (`hubs.<HUB>.agingRefs`; CTBP1's includes the landmark *C. elegans* `ctbp‑1` life-span paper,
     PMID 19164523) lives in the
     Aging/longevity lens dossier (§8), where literature belongs.
  2. **Table** — sortable evidence table. In `Both` it gains a **Hub** column (CTBP1 / CTBP2 / shared)
     and **per-hub** connection columns (each node's composite, physical, literature against each hub it
     touches), so the differential strength is sortable.
  3. **Findings** — every (gene × area) membership, filterable by area chip (the chips mirror the
     left-panel lens focus, and vice-versa), each row sourced
     (OT disease+score, or GenAge/LongevityMap for aging). Area memberships are hub-independent; in
     `Both` a row still notes which hub(s) the gene connects to.
  4. **Discoveries** — the blended, de-duplicated, diversity-capped lead feed (`discoveries(W, hubSel)`)
     as a **first-class view alongside Findings**, rendered as a responsive card grid; click a card to
     focus that gene. In `Both` it foregrounds **paralog contrasts** (shared vs. divergent genes).
  5. **Network** (§1A.3) — the force / graph view. **Outside focus mode** it can render
     the **two-hub overview** (both centres, the shared set between them, the two isolated sets to the
     sides), nodes coloured by hub attribution. **In focus mode** it draws the **focus subgraph**: the
     selected hub(s), the focused gene `G`, and the intermediary genes `M`/`N` from the mediated routes
     (§6.5), with every bridging edge shown and labelled by its STRING score, and `G` highlighted. This
     is the view that makes *"CTBP1 binds `G` directly, CTBP2 reaches it via `Z`, and `Z` links back to
     CTBP1"* visible. Lay it out as described in §1A.3.
- **Right drawer** — three context-aware modes: gene dossier, disease-lens panel, and **hub dossier**.
  The hub dossier reflects the **hub selection**: a CTBP1 or CTBP2 dossier when one is chosen, and a
  **paired CtBP1 + CtBP2** dossier in `Both` (the two hubs side by side, with their shared-vs-divergent
  roll-up). The drawer opens on the hub dossier by default; selecting a gene (any view) or a field-lens
  swaps the drawer to that dossier. Because the hub no longer shows automatically once you drill in, the
  **drawer header carries a `⌂ Hub` button** that appears **only when a gene/lens dossier is open** and
  returns the drawer to the current hub selection (clears the gene/lens selection), so there is always a
  one-click way back to the subject. A **disease-lens panel** shows the area's membership rule, its
  member genes ranked by strength, and, for the **Aging/longevity** lens only, the curated,
  ortholog-aware reading list (`hubs.<HUB>.agingRefs`, §8) clearly labelled as such. A **gene dossier**
  shows that gene's hub-independent biology in this order: IntAct, **BioGRID** (when present, directly
  after IntAct: a curated **human physical, yeast-two-hybrid-excluded** interaction count with methods,
  PMIDs and a `thebiogrid.org` link, labelled with the release id), **Literature** co-mention,
  **Area memberships**, top
  disease associations, Pathways (Reactome), Clinical variants (ClinVar), Clinical phenotypes (HPO),
  mechanism tags, "Open in databases" deep links, then — **at the very bottom, just above the AI
  context block** — the **collapsible Connection** section and the **collapsible STRING channels**.
  - **Connection** and **STRING channels** are **de-emphasised** — useful but not prominent — so they
    are pushed to the **bottom of the dossier (directly above the AI context `<pre>`)** and each is a
    **collapsible `<details>` section ("zum aufklappen"), closed by default**. The collapsed summary
    still carries the **headline value** (Connection → `Composite ‹n›/100`; STRING channels →
    `Combined ‹s.c›`); expanding **Connection** reveals the three sub-scores (Physical / Literature /
    Network context) the rank is **built from** — that breakdown, plus the `composite` ⓘ glossary tip
    (which spells out the fixed `0.5 / 0.3 / 0.2` weighting), is the explanation of *what the rank is
    based on*. (An ⓘ inside a `<summary>` shows its tooltip on hover/focus without toggling the section.)
    **Dual-hub:** a gene that connects to **both** hubs shows **one Connection block per hub** (its
    CTBP1 connection and its CTBP2 connection), each with its own headline; a paralog-specific gene
    shows the single block for the hub it touches.
  - **Literature** co-mention is pulled **up — above Area memberships** — because the tiered,
    synonym-aware co-mention + the actual papers are a primary signal here; it is tiered rows linking
    to the exact Europe PMC query + the papers (no sub-heading over the paper list).
  - **Pathways (Reactome)** sits **before Clinical variants (ClinVar)**.
  - **Area memberships** = disease areas + aging, with provenance, area-coloured, no alarm icon.
- **AI block** — every drawer + the hub dossier has a copy-to-clipboard `<pre>` dumping *all shown
  values + source URLs* as plain text, ready to paste into an LLM. The AI-block heading carries an
  **ⓘ glossary tip** (`aictx`) that explains the workflow in plain, professional language: *the export
  is everything shown here — values, scores and the source links — so copy it with ⧉ Copy, paste it
  into your preferred AI assistant as context, then ask your question; the model can read the figures
  and follow the links to verify them.* The gene dump is **the shown values only** — it must **not**
  include the de-emphasised scoring internals: **no** `Composite ‹n›/100 (weights …) · physical … ·
  literature … · network …` line and **no** `STRING channels: combined … | experiments … | …` line
  (rank and connection type still appear; the gene's STRING-network link is kept). The **per-drawer
  copy buttons share one recognisable identity** — the same **⧉ clipboard icon** + a short **"Copy"**
  label + a cyan accent — so a user can spot them at a glance. The button is just **⧉ Copy** (its
  AI-block heading, "AI context — ‹gene / lens / hub›", already supplies the scope; the scope is repeated
  in the `title` tooltip). Every AI dump is headed `CTBP INTERACTOME ATLAS: …`. The global counterpart
  is the insight-strip **Export** button, **`⧉ Export AI Context of all Interactions`**, which copies
  *everything*; it keeps the shared **⧉ copy glyph** and cyan accent but is fully labelled (it is a
  call-to-action, not a uniform pill).
- **Discoveries feed** — its own **view/tab** (a responsive card grid, not a bottom strip), click to focus.
- **Tooltips** — ⓘ glossary tooltips must be **instant** (a custom body-level tooltip, NOT the
  native `title=` attribute, which has a ~0.5–1 s browser delay). Position above the icon, flip
  below near the top, clamp to the viewport, ~70 ms fade, also show on keyboard focus.
- **Intro** — a brief boot animation; `?noboot` skips it.

### 7A. Mobile layout (≤ 1023px) — precise behaviour

Desktop (≥ 1024px) is the **canonical** design and must stay **byte-for-byte unchanged** by everything
below; every mobile rule is gated behind `@media (max-width:1023px)` (or a JS `isMobile` check) and only
*adds* mobile-only DOM/CSS. The goal: the most-used controls are always in reach, and there is one
obvious way into and out of every panel.

1. **Primary controls stay visible (no digging).** The **Hub** segmented control (`CTBP1 / CTBP2 /
   Both`) and the **Focus-gene** input sit in a **persistent control bar pinned directly under the
   header**, always on screen, **never** hidden behind the ☰ panel. This bar is a mobile **mirror** of
   the desktop left-panel controls: it drives the *same* state and the *same* handlers (do not fork the
   logic) and is kept in sync (active hub, focus value, roll-up counts). The ☰ panel on mobile then
   holds only the **secondary** controls: the **Fields** lenses, the **Display limit**, and a
   **Sources & export** block (point 6).
2. **Bottom navigation for the five views.** Replace the top tab strip (which overflows and hides
   "Network") with a **fixed bottom navigation bar** spanning the width, one thumb-sized item per view
   (Constellation · Table · Findings · Discoveries · Network), the active view marked. Hide the top tab
   strip on mobile and inset the centre view area so nothing is hidden behind the bottom bar.
3. **One clear way in and out of each panel.** Both overlays carry an explicit **✕ close** (not only a
   scrim tap). The **right dossier becomes a bottom sheet**: it slides up from the bottom, full width,
   ~88vh tall, rounded top with a grab-handle + ✕, dismissed by the ✕, a downward swipe, or a scrim tap.
   The ☰ controls panel slides in from the left with its own ✕. A scrim dims the rest and also closes on
   tap.
4. **Header fits, logo never clips.** The narrow bar can't hold both, so on mobile the **wordmark is the
   brand** and the secondary HADDTS logo is **hidden** (it must never render clipped); its
   `www.haddtsfoundation.org` link relocates to the ☰ **Sources** block (point 6). Keep the icon
   buttons that remain.
5. **Touch ergonomics + iOS-Safari gotchas (must handle).** Tap targets are **≥ 44 × 44px** (icon
   buttons, bottom-nav items, the ⓘ glossary hit area). Glossary tooltips are tap-to-open and **dismiss
   on a tap anywhere else** (or a second tap on the ⓘ), since touch has no hover-out. Three specific
   iOS-Safari fixes are required: (a) **all inputs use ≥ 16px font** or iOS zooms the page on focus;
   (b) the gene picker is a **custom, filtered, tappable autocomplete**, **not** a native `<datalist>`
   (which ghost-opens the entire list and is unstyleable on iOS); (c) the layout height uses **`100dvh`**
   (with a `100vh` fallback) plus `env(safe-area-inset-bottom)` so the **bottom nav clears Safari's
   dynamic toolbar** instead of hiding behind it.
6. **Provenance on mobile.** Because the desktop insight strip is hidden ≤ 1023px, the ☰ panel carries a
   **Sources & export** block: the per-hub source links, the **⧉ Export** action, the build date, the
   offline-download note, and the HADDTS Foundation + GitHub links, so provenance, export and the
   foundation link are all reachable on a phone.
7. **Tables.** The evidence table scrolls horizontally inside its own container with an obvious cue (the
   dual-hub per-hub columns are reachable by swipe); the gene dossier stays the full-detail view. On
   mobile prefer a lower default **Display limit** and larger node hit areas on the canvases so taps land.

---

## 8. Provenance & literature rules (exact)

- **Co-mention** is synonym-aware and tiered across three **nested scopes**, broadest last:
  **in title** (both terms in the title) ⊆ **title+abstract** (in the title *or* abstract, so it
  includes the title hits) ⊆ **full text** (anywhere in the full text). Because the scopes nest, the
  counts are monotonic (title ≤ title+abstract ≤ full text); the middle tier is labelled
  "title+abstract", not "in abstract", precisely because it includes the title. Each count links to the
  **exact** Europe PMC query that produced it (the in-app and pipeline query builders must be
  byte-identical so counts reproduce). State this nesting in the UI (a one-line note and the glossary)
  so a reader is not surprised that "in title" is small while "full text" is large.
- **Per-hub vs both-hub co-mention (all hub-independent).** Every node carries `comention1` (gene ×
  CTBP1), `comention2` (gene × CTBP2) **and** `comentionB` (gene × CTBP1 × CTBP2, the same nested
  tiers), because co-mention is a property of the literature, not the STRING graph. The dossier's
  Literature section therefore shows **all three** blocks for **every** gene, not only the hubs it
  neighbours: a hub the gene does **not** STRING-neighbour is flagged "literature only; not a top-250
  STRING neighbour" so the count reads correctly, but it is still shown (a 0 or small count is itself
  information, and hiding it contradicts the Network view, which shows the gene reaching that hub via a
  mediated route). The both-hub query is `(CTBP1 group) AND (CTBP2 group) AND (gene group)` with the
  same lncRNA exclusions; build it identically in the pipeline and the app.
- **Exclude the CTBP1 lncRNA loci** from every co-mention query: append
  `NOT "CTBP1-AS2" NOT "CTBP1-DT" NOT "CTBP1-AS1"`. Do **not** exclude `"CTBP1-AS"` — "AS" is a
  stopword that nukes the result set.
- **Synonyms**: include real aliases but **drop ambiguous homographs** that name an unrelated gene
  (curated blocklist, e.g. `GLP1, P18, PC2, PH1, C21, DC42, IRA1`) — they cannot be detected
  syntactically.
- **References** are the synonym-aware, **citation-ranked** co-mention papers (prefer
  title/abstract, fall back to full text), not a bare strict-symbol query.
- **Stop-listed / housekeeping symbols** (`IMPACT, GAPDH, TBP, ACTB, B2M`) show an "ambiguous /
  house-keeping" caveat and are excluded from the literature score.
- **Each hub's aging/longevity literature is ortholog-aware** (for CTBP1: CtBP1 / CTBP‑1 / ctbp‑1;
  CTBP2 gets its own curated list, or none if there is no comparable orthologue work), bundled as
  `hubs.<HUB>.agingRefs`, and **rendered inside the Aging/longevity lens dossier** (the disease‑lens
  panel in the right drawer), clearly labelled as a *curated reading list, not a discovery claim*. It is
  the one place a partner-gene lens carries hub-level CTBP1 papers, because a human‑only `"CTBP1"`
  co-mention search structurally misses the model-organism orthologue work. The list **must include**
  the landmark *C. elegans* `ctbp‑1` life‑span paper: Chen S, Whetstine JR, Ghosh S, Hanover JA,
  Gali RR, Grosu P, Shi Y. "The conserved NAD(H)-dependent corepressor CTBP‑1 regulates
  *Caenorhabditis elegans* life span." *Proc Natl Acad Sci U S A.* 2009;106(5):1496‑1501.
  **PMID 19164523 · PMCID PMC2635826 · DOI 10.1073/pnas.0802674106.** (This is a curation directive
  for the data/UI, not a test assertion — §9 still forbids the harness from pinning any paper.)
- **BioGRID curated interactions (a second physical layer beside IntAct).** Source the key-free bulk
  `BIOGRID-ALL-<release>.tab3.zip` (release pinned in `meta.sources`; the REST webservice is **not** used,
  it needs a key, §2.1). **Researcher-directed filters, applied verbatim:** keep only **human–human**
  (both `Organism ID` = 9606), **`Experimental System Type = physical`**, and **exclude yeast two-hybrid**
  (`Experimental System` = `Two-hybrid`); **no cross-organism data and no conservation view** (the
  consulted CtBP researcher's guidance: only human data is trustable, physical only, everything except
  yeast two-hybrid, BioGRID as the sole source). Store `node.biogrid = {count, methods, pmids}` for each
  partner's interaction with the hub(s) (combined across hubs, like `intact`); show it in the dossier
  right after IntAct with the methods, PMIDs and a `thebiogrid.org` link, and feed it into the
  connection type (§6.2, Physical-interactor tier). The 171 MB raw archive is **gitignored**; commit only
  a small CtBP extract for reproducibility.

---

## 9. Test harness (`data/verify.js`) — falsifiable, no pinned conclusions

Run the **exact** `engine.js` against `app-data.js` and assert **generic invariants only**:
- **Anti-bias core**: recompute each area's membership *straight from the raw data* (using the
  same EFO areas / disease-name regex / GenAge bundle) and assert it **equals** the engine's
  members. If a gene were hand-placed, this fails.
- Exactly the 10 chosen field keys exist (exactly 5 are `sector` fields); removed/renamed keys gone.
- Per-gene **displayed areas == lens membership == flags** (consistent everywhere).
- Every disease-area flag cites a real OT disease from the gene's own associations; every aging
  flag cites GenAge/LongevityMap evidence.
- `findings()` = sum of memberships, each sourced + scored.
- Structural: `analyse(W, hubSel)` returns all in-scope nodes sorted by composite; every node has a
  valid connection type; Core/Physical never from DB channel alone.
- **Dual-hub invariants:** every node's `hubs` set is **non-empty** and **exactly matches** which of
  `s1`/`s2` are non-null (no node claims a hub it has no score for, and vice-versa); `rank1` is present
  **iff** `s1` is, same for `rank2`/`s2` (rank and score are structural). Co-mention is **hub-independent
  literature**, so `comention1`/`comention2`/`comentionB` (and `lit1`/`lit2`/`litB`) are **not** tied to
  `s1`/`s2`: assert instead that they are present for **(nearly) every** node and that their tiers are
  monotonic; do **not** assert they are absent for a non-neighboured hub. Every node is a **direct**
  STRING neighbour of **at least one** hub (its own hub(s)); a node need **not** be a direct neighbour of
  a hub it is not attributed to. `routes(hub, to)` returns a **direct** edge when one exists and only otherwise a
  mediated route (depth ≤ 3) whose every hop is a real `edges` entry. `meta.neighborhood.union ==
  nodes.length` and `shared + CTBP1-only + CTBP2-only == union`.
- Data integrity: no unresolved ID stubs (every node has Ensembl + Entrez); ClinVar present &
  `P/LP ≤ total`; pathways have no broad umbrellas; ambiguous aliases dropped; co-mention tiers
  monotonic; references present with valid PMIDs; HPO counts consistent; where `node.biogrid` exists,
  `count ≥ 1`, PMIDs valid, and `methods` contain **no** yeast-two-hybrid term (the physical/non-Y2H
  filter held).
- **Forbidden**: any assertion pinning a named gene to a rank/area/type, or requiring a specific
  disease/paper to appear.

Also keep `node --check app.js engine.js` clean.

---

## 10. Design system (defined inline)

The design system lives in `index.html` as CSS custom properties on `:root`, with a token-override
dark theme. **Light mode is canonical**; dark mode re-defines only surface / text / accent tokens and
leaves the pinned `--area-<key>` hues (§6.3) identical. Posture: **institutional-modernist, dense,
provenance-first**, with numbers in tabular/mono for alignment.

### Typography — system-fallback stacks (no web fonts)
The app runs from `file://` with no network, so the named families are listed first and fall back to
platform fonts. **No `@font-face` / `@import` / Google-Fonts `<link>`**, so there are no failed font
requests. Three roles:
- `--display`: `'Hanken Grotesk','Inter',system-ui,-apple-system,BlinkMacSystemFont,…` — headings + brand wordmark.
- `--sans`: `'Inter',system-ui,-apple-system,'Segoe UI',Roboto,…` — body + **all chip / term text**.
- `--mono`: `'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,…` — **numbers / IDs only**.

To pin the exact typefaces offline, drop their woff2 into `fonts/` and add `@font-face` rules at the top of the `<style>`.

### Colour tokens (`:root`, light = canonical)
- surfaces: `--surface #eef1f6`, `--surface-container-lowest #ffffff`, `--surface-container-low` / `--sc-low #f5f7fb`, `--surface-container #e9edf4`, `--surface-container-high #e0e6f0`.
- text: `--on-surface #0b1c30`, `--on-surface-variant #516074`.
- lines: `--outline #c0cad8`, `--outline-variant #dbe2ec`.
- brand / accents: `--brand-navy #002255`, `--brand-cyan #03e2f2`, `--primary #0e7490`, `--primary-bright #06b6d4`, `--secondary #0f766e` (the "Interactome Atlas" teal), `--tertiary #7c3aed`, `--danger #b42318`, `--ok #067647`.
- geometry: `--radius 10px`, `--radius-sm 7px`, `--hdr-h 54px`, soft two-layer shadows, `--constellation-bg` (near-white light / near-black dark).

### Dark theme (`[data-theme="dark"]`, token override only)
`--surface #080d15`, `--surface-container-lowest #0f1726`, `--surface-container #141e2e`,
`--on-surface #e6edf6`, `--on-surface-variant #93a3b8`, `--outline #2a3a50`, `--outline-variant #1f2c3e`,
`--primary #22d3ee`, `--secondary #2dd4bf`, `--constellation-bg #0a111c`. The `--area-<key>` hues are
**unchanged** from light. The two hardcoded translucent-white overlay cards (constellation legend +
hint) flip to a dark translucent card (`rgba(16,24,40,…)`), and the canvas re-themes its hub-fill and
selected-node ring off the active theme.

### Components
Apply the rules pinned elsewhere in this brief: the **gene-category chip / flag** recipe (solid
`--area-<key>` dot + a `color-mix(... 12% ...)` tint background + a `color-mix(... 30% ...)` hairline +
dark `--on-surface` text, body sans never mono), the **constellation node fill / wedge**, the
**discovery-card top-border** and **findings-row left-border** (all §6.3); the **header / insight strip /
left panel / five views / right drawer** layout (§7); and the **instant body-level tooltips** (§7).
Outlined `.links` pills (`--sc-low` background, `--outline-variant` hairline, muted text, **cyan border
on hover**, trailing `↗`) are the one shared identity for every source / database link, used in both the
insight strip and the dossier. The Constellation has a single canonical **sector** layout (no
Layout/Radial toggle).

### Logos (`logos/`)
Use the supplied HADDTS Foundation lockups. In the header the **CTBP Interactome Atlas** wordmark comes
**first** and the **compact** HADDTS Foundation lockup follows at a **smaller** size (a secondary "by"
mark, ~22 px, after a hairline divider) — never the logo first. The lockup is **theme-aware**: two
`<img>`s of the *same* artwork/geometry are wired in —
`logo-vert-colored.svg` (navy `#002255` wordmark + cyan `#03e2f2` icon) for **light** mode and
`logo-vert-white.svg` (white `#ffffff` wordmark + the same cyan icon) for **dark** mode — toggled by CSS
(`.logo-dark` hidden by default; `[data-theme="dark"]` hides `.logo-light` and shows `.logo-dark`). The
two SVGs are pixel-identical except for the wordmark fill so the swap is seamless. **Put the show/hide
`display` on the `.logo-light` / `.logo-dark` classes themselves; do not set `display` on a shared
`.by img` rule** (its `class + element` specificity, e.g. `0,1,1`, outranks `.logo-dark{display:none}`
at `0,1,0` and leaks the white-wordmark logo into light mode, where it is invisible on white except for
its cyan icon). Size the imgs on `.by img`, but switch visibility on the theme classes only. The folder also ships
the other marks (`logo-horiz-*`, `HADDTS Foundation*.svg`, white and white-mono variants) for any
dark-surface use; only the vertical pair is wired into the header.

**Functional area colours** are **pinned** in §6.3 as light-mode hexes (`--area-<key>`), with the full
chip / tint / halo recipe spelled out there. Apply those exactly; nothing is left to the builder's
judgement.

---

## 11. Acceptance criteria

- Opens offline from `file://` with no console errors; no network needed to function.
- The five disease areas (+ the aging/longevity overlay) render as lenses/flags/findings; membership
  is provably data-driven (`verify.js` membership==recomputation checks pass).
- Every shown value has a working source link; the per-drawer AI blocks produce complete, sourced
  plain text.
- `data/verify.js` passes with **generic invariants only** (no pinned-gene assertions).
- The design-system type hierarchy renders (the named families if installed, else the system fallback;
  offline-clean, no web-font requests), with its documented display / sans / mono roles.
- The engine contains no partner-gene special-casing (grep-clean per §2.3), and is **symmetric in the
  two hubs** (swapping CTBP1/CTBP2 throughout the data would swap the outputs, never break them).
- **Dual-hub (§1A):** the **hub selector** (`CTBP1` / `CTBP2` / `Both`, default `Both`) and the
  **focus-gene** selector both work; in `Both` every interactor is correctly attributed
  (shared / CTBP1-only / CTBP2-only) and the roll-up counts are right; selecting a focus gene shows the
  direct edge where it exists and the strongest **mediated route(s)** (`hub → M → G`, depth ≤ 3) where
  it does not, from each selected hub, with every hop sourced.
- **Network view** renders the focus subgraph (hubs + focused gene + intermediaries + edges) and the
  `Both` two-hub overview; it is a real, used view.

Build it to be correct and honest first, beautiful second, but it should be both.
