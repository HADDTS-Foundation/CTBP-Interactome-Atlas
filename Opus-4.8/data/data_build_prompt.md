# Data Build Prompt — CTBP INTERACTOME ATLAS (data pipeline)

> **Run this FIRST, before `app_build_prompt.md`.** It builds the `data/` pipeline and runs it to emit
> the bundled snapshot `../app-data.js` (`window.CTBP_DATA = {…}`). The app build then reads that file.
>
> To reproduce the whole tool in a fresh project, copy only **`app_build_prompt.md` +
> `data/data_build_prompt.md` + `logos/`**, then: (1) follow this prompt to build + run the pipeline,
> (2) follow `app_build_prompt.md` to build the front end.
>
> Paste this whole document to Claude Code as the brief for building the data pipeline. Follow it
> exactly; where it gives endpoints, tokens, thresholds or query rules, use them verbatim.

---

## 1. Mission

Build a reproducible, dependency-free pipeline under `data/` (Python **standard library only**) that
fetches the **full combined interactome of the CtBP paralog pair, CTBP1 and CTBP2**, from public,
key-free sources, and emits a single minified snapshot `app-data.js` at the project root
(`window.CTBP_DATA = {…}`).

**Both hubs are fetched and scored symmetrically** — each one's **top-250 STRING neighbours by
combined score** — and then **merged** into one deduped **union** node list with **per-hub
attribution**. The result is a complete dual-hub dataset: a node that neighbours both paralogs is
`shared`; a node that neighbours only one is `CTBP1-only` or `CTBP2-only`; and every node carries the
full STRING channel breakdown and the per-hub literature counts for **each** hub it touches.

Every value the app will show must be traceable to a public record, so the pipeline stores the exact
identifiers and query strings needed to revisit each source. No gene is special-cased; the two hubs
are the only fixed symbols.

---

## 2. Non-negotiable principles

1. **Standard library only** — `urllib`, `json`, `csv`, `zipfile`, `re`, `time`, `os`, `sys`. No keys,
   no third-party packages, no API tokens.
2. **Idempotent + resumable.** Each step parses `app-data.js`, mutates the object, and rewrites it.
   Re-running a step must not corrupt or double-count. `run_all.py` drives the steps in order with a
   snapshot backup and a `--from <step>` resume flag.
3. **Symmetric in the two hubs.** Hold the hubs in a list (`HUBS = ['CTBP1','CTBP2']`); fetch/score
   each identically. Nothing may be hard-coded to one hub except the documented IDs used to *start*
   each hub's fetch.
4. **Sourced, never invented.** Only write a value you fetched. Where a source is unreachable,
   **degrade gracefully** (preserve any existing value), never crash the run and never wipe data.
5. **Honest coverage.** If a particular signal cannot be fetched for a hub or gene, leave it `null`
   (the engine/UI treat `null` as "not in snapshot" and say so) rather than substituting a 0 or a
   guess.

---

## 3. Output: the data model

Emit `window.CTBP_DATA` exactly as specified in **`app_build_prompt.md` §4** (the read-side contract).
That section is authoritative for field names and shape. The pipeline-specific requirements on top of
it:

- **Fetch both neighbourhoods fully.** `s1` **and** `s2` must each carry the full 8 STRING channels
  (`c,e,d,t,a,p,n,f`) for every hub a node neighbours — not a combined-only score. Populate `lit1` /
  `comention1` **and** `lit2` / `comention2` (per-hub co-mention), and `rank1` / `rank2` (the node's
  rank within each hub's own top-250).
- **`hubs` is exactly the set of hubs the node scores against** (`['CTBP1']`, `['CTBP2']`, or both).
  A real symmetric build will contain genuine **CTBP2-only** nodes.
- **`hubEdge`** is the CTBP1↔CTBP2 STRING interaction itself, with all 8 channels.
- **`edges`** is the partner↔partner STRING graph over the **union** of both neighbourhoods — complete
  enough to support the indirect `hub → M → G` path-finding the app does (depth ≤ 3).
- **Per-gene biology is hub-independent** and fetched **once per gene** (not per hub): `dz`, `tract`,
  `areas`, `dis`, `func`, `funcRefs`, `refs`, `syn`, `intact`, `clinvar`, `pathways`, `phenotypes`,
  `phenoCount`, `aging`.
- **`meta`**: `date`, `species`, `hubs:['CTBP1','CTBP2']`,
  `neighborhood:{CTBP1,CTBP2,shared,union}`, `sources:[…]`, `channelLegend`, `edgeCount`, `nodeCount`
  (= union partners + 2 hubs). Minify with `json.dumps(data, separators=(',',':'))`.

Each step parses the file via `^\s*window\.CTBP_DATA\s*=\s*(\{.*\})\s*;\s*$` (`re.S`), mutates, and
writes `'window.CTBP_DATA = ' + json.dumps(data, separators=(',',':')) + ';\n'`.

The hub seed IDs (the only fixed gene tokens): CTBP1 = Ensembl `ENSG00000159692`, Entrez `1487`,
UniProt `Q13363`; CTBP2 = Ensembl `ENSG00000175029`, Entrez `1488`, UniProt `P56545`.

---

## 4. Sources & endpoints (all key-free)

| Source | Provides | Notes / gotchas |
|---|---|---|
| **STRING v12** (`string-db.org/api`) | each hub's ~250-gene neighbourhood, 7 channel scores + combined, and the partner↔partner edges | top‑250 by combined score is a stated curation choice; drop nodes lacking a resolvable Ensembl+Entrez (so each hub holds ≤250). Fetch the **hub edge** CTBP1↔CTBP2 explicitly. |
| **Open Targets v4** (GraphQL, `api.platform.opentargets.org/api/v4/graphql`) | per-gene disease associations (top‑20), EFO therapeutic-area aggregation, tractability, function descriptions | `areas` = **sum of association score per `therapeuticAreas` entry**. Keep the EFO area labels verbatim (the engine keys off them, see §7). |
| **IntAct** (EBI REST: `ebi.ac.uk/intact/ws/interaction/findInteractions/<HUB>`) | curated experimental interactions per hub: type (incl. *direct interaction*), detection method, PMID, MI-score | PSICQUIC is retired — use this REST ws; keep **human–human** only. Run **per hub** so each hub's `intact`-style evidence is its own. |
| **Europe PMC** (`ebi.ac.uk/europepmc/webservices/rest/search`) | tiered, synonym-aware co-mention counts (title / title+abstract / full-text) **per hub**, + the actual papers | see §6 for the exact query rules. Build `comention1`/`comention2` and `lit1`/`lit2`. |
| **UniProtKB** (`rest.uniprot.org`, e.g. `Q13363`) | function, NAD cofactor, complex membership, function-evidence PMIDs | |
| **NCBI ClinVar** (eutils esearch, `retmode=json`) | per-gene P/LP · VUS · total variant counts | **Must** use the `[Filter]` tokens `clinsig_pathogenic`, `clinsig_likely_path`, `clinsig_vus` — **NOT** `[Clinical significance]` (Entrez maps that to free text → wrong counts). Store so the app's count links can mirror these exact tokens. |
| **HPO** (`ontology.jax.org/api/network/annotation/NCBIGene:<entrez>`) | clinical-phenotype terms + count | `hpo.jax.org` deep links hard‑404 (client SPA). Link the count to the API response; also keep a **Monarch** (`monarchinitiative.org/NCBIGene:<entrez>`) browse link. |
| **Reactome ContentService** (`reactome.org/ContentService/data/mapping/UniProt/<acc>/pathways?species=9606`) | specific leaf pathways per gene | **Preferred** (specific leaves) but **fail-fast** — the endpoint can 5xx, so don't retry-storm it. MyGene's `pathway.reactome` is flat/arbitrary-order and surfaces broad umbrellas, so use it **only as a last-resort fallback, umbrella-filtered**. |
| **GenAge + LongevityMap** (HAGR, `genomics.senescence.info`) | the data-driven **Aging / longevity** membership | GenAge human ageing genes + LongevityMap *significant* longevity-association genes; write `node.aging = {genage, longevity, why, id, pmids}`. HAGR can hard-block these zips (415) — **degrade gracefully** (preserve any existing `node.aging`), never crash or wipe aging. |
| **MyGene.info / NCBI Gene / GeneCards / Ensembl / PubMed / AlphaFold / PDBe / OMIM** | IDs, GO, deep links, structure models | watch for HGNC renames (symbol-scope lookups can `notfound`) and non-primary-assembly Ensembl IDs. |

Be a polite client: a small `time.sleep` between calls, a bounded retry-with-backoff helper, a
descriptive `User-Agent`, and generous timeouts. Cache raw responses to `data/*.json` so re-runs and
debugging don't re-hit the network needlessly.

---

## 5. Pipeline steps & order

Each step is its own `data/<step>.py`, parses `app-data.js`, mutates, rewrites; **network steps must be
idempotent**. `data/run_all.py` runs them in order with a snapshot backup and a `--from <step>` resume.
The neighbourhood size is `TOPN = 250` **per hub** (so the union can exceed 250, with a shared overlap
in the middle). Suggested step breakdown (names map to the realised pipeline):

1. **`fetch_core`** — for **each hub**: STRING top‑250 neighbours (8 channels) + the CTBP1↔CTBP2 hub
   edge; resolve every partner to Ensembl + Entrez + UniProt (MyGene / NCBI), dropping unresolvable.
2. **`enrich`** — Open Targets associations (top‑20) per gene → `dis` and the EFO `areas` sums;
   tractability; function text.
3. **`topup`** — fill ID / association gaps; reconcile HGNC renames.
4. **`netfetch`** — the partner↔partner STRING `edges` graph over the **union** of both neighbourhoods.
5. **`build_data`** — assemble/merge: union the two neighbourhoods, dedupe by gene, set each node's
   `hubs`, `s1`/`s2`, `rank1`/`rank2`; build `hubs.CTBP1` / `hubs.CTBP2` hub blocks; write `meta`.
6. **`refs`** — Europe PMC citation-ranked co-mention papers per gene (`refs`), and the hub-level
   ortholog-aware aging reading lists (`hubs.<HUB>.agingRefs`, §6).
7. **`diseases`** — deepen `node.dis` (top‑20 OT disease names + scores) so disease-name fields are complete.
8. **`evidence`** — IntAct curated interactions per hub; Europe PMC co-mention **tiers**
   (`comention1`/`comention2` = title / title+abstract / full-text) and `lit1`/`lit2`.
9. **`annotate`** — UniProt function/cofactor; Reactome leaf pathways (umbrella-filtered); HPO
   `phenotypes` + `phenoCount`; GO terms.
10. **`genage`** — GenAge ∪ LongevityMap → `node.aging` with provenance (`why`/`id` or PubMed `pmids`).
11. **`fix-ups`** — small, documented, idempotent corrections.

Run with `python3 data/run_all.py` (needs network, a few thousand live API calls). **Both hubs must be
fetched and merged before the snapshot is valid.**

---

## 6. Provenance & literature rules (exact)

These govern how counts and references are built. They must match `app_build_prompt.md` §8 **byte for
byte**, because the app re-builds the same query strings for its in-app source links — identical query
⇒ identical count.

- **Co-mention is synonym-aware and tiered:** in title / in title+abstract / anywhere in full text.
  Build, per hub × gene, the three Europe PMC queries and store the counts (`comention{1,2}.{title,abs,all}`)
  and `lit{1,2}` (the full-text count). Store enough that the app can reconstruct the exact query.
- **Exclude the CTBP1 lncRNA loci** from every co-mention query: append
  `NOT "CTBP1-AS2" NOT "CTBP1-DT" NOT "CTBP1-AS1"`. Do **not** exclude `"CTBP1-AS"` — "AS" is a stopword
  that nukes the result set.
- **Synonyms:** include real aliases but **drop ambiguous homographs** that name an unrelated gene
  (curated blocklist, e.g. `GLP1, P18, PC2, PH1, C21, DC42, IRA1`) — they cannot be detected
  syntactically. Store the kept synonyms in `node.syn` (blocklist already applied).
- **References** are the synonym-aware, **citation-ranked** co-mention papers (prefer title/abstract,
  fall back to full text), not a bare strict-symbol query. Store as `refs:[{pmid,t,a,y,j,c}]`.
- **Stop-listed / housekeeping symbols** (`IMPACT, GAPDH, TBP, ACTB, B2M`) still get co-mention counts,
  but the app flags them "ambiguous / house-keeping" and excludes them from the literature *score*; you
  need not special-case them in the data beyond storing the counts.
- **Each hub's aging/longevity literature is ortholog-aware.** A human-only `"CTBP1"` co-mention search
  structurally misses model-organism orthologue work, so curate `hubs.<HUB>.agingRefs` (for CTBP1:
  CtBP1 / CTBP‑1 / ctbp‑1; CTBP2 gets its own list, or none if there is no comparable orthologue work).
  CTBP1's list **must include** the landmark *C. elegans* `ctbp‑1` life-span paper: Chen S, Whetstine JR,
  Ghosh S, Hanover JA, Gali RR, Grosu P, Shi Y. "The conserved NAD(H)-dependent corepressor CTBP‑1
  regulates *Caenorhabditis elegans* life span." *Proc Natl Acad Sci U S A.* 2009;106(5):1496‑1501.
  **PMID 19164523 · PMCID PMC2635826 · DOI 10.1073/pnas.0802674106.** (Curation directive for the data,
  not a test assertion — the test harness never pins a paper.)

---

## 7. Raw fields the engine depends on (fetch faithfully, classify never)

The app's engine derives disease-area memberships, mechanism tags and connection types **from the raw
fields below** — the pipeline only fetches them; it must **not** decide membership (that would bias the
data, which the app's test harness forbids). Populate, per node:

- **`areas`** — a map `{ "<EFO therapeutic area>": summed-association-score }`. Keep the EFO labels
  **verbatim** from Open Targets `therapeuticAreas`; the engine keys on these exact strings:
  `"cancer or benign tumor"`, `"nutritional or metabolic disease"`, `"endocrine system disease"`,
  `"nervous system disease"`, `"psychiatric disorder"`, `"immune system disease"`,
  `"cardiovascular disease"`, `"hematologic disease"`, `"disorder of visual system"`, etc.
- **`dis`** — top‑20 OT disease associations `[{n,s}]` (name + score); the engine's disease-name fields
  (neurodegeneration, neurodevelopment) match regexes against `dis[].n`.
- **`aging`** — `{genage, longevity, why, id, pmids}` for GenAge ∪ LongevityMap members; absent otherwise.
- **`clinvar`** `{plp,vus,total}`, **`pathways`** (Reactome leaves, no umbrellas), **`phenotypes`** +
  **`phenoCount`** (HPO), **`intact`** `{type,direct,miscore,methods,pmids,count}`, **`func`** +
  **`funcRefs`**, **`syn`**, and the IDs (`ensembl,entrez,uniprot,mim`).

The engine's field thresholds (EFO sum > 0.15, disease-name floor 0.18 / 0.10, etc.) and the exact area
keys live in `app_build_prompt.md` §6.3 — keep the fetched `areas`/`dis` consistent with them, but do
not apply them here.

---

## 8. Data-integrity self-test (`data/verify_data.js`)

Ship a Node check that loads **only** `app-data.js` (no engine dependency) and asserts the snapshot is
well-formed, so the data build can be verified before the app exists:

- schema shape: `hubs.CTBP1` + `hubs.CTBP2` present; `hubEdge.s.c` numeric; `nodes`, `edges`, `meta` present;
- every node has a well-formed Ensembl (`/^ENSG\d+$/`) + Entrez (`/^\d+$/`);
- `hubs` is non-empty and **exactly** matches which of `s1`/`s2` are non-null; per-hub `rank`/`lit`/`comention`
  are present iff that hub's score is, and absent otherwise;
- co-mention tiers monotonic per node (`title ≤ abs ≤ all`), both hubs;
- ClinVar present and `plp ≤ total` (nodes and both hubs); no Reactome **umbrella** terms in `pathways`;
  ambiguous-homograph aliases dropped from `syn`;
- `meta.neighborhood.union == nodes.length` and `shared + CTBP1-only + CTBP2-only == union`;
  `meta.nodeCount == nodes.length + 2`; both hubs declared.

(The **falsifiable membership** tests — engine members == recomputation from raw data, no pinned genes —
live in `app_build_prompt.md` §9 / `data/verify.js`, which also loads `engine.js`. Run those after the
app build.)

---

## 9. Run

```bash
python3 data/run_all.py          # full fresh build (network; a few thousand API calls) → ../app-data.js
python3 data/run_all.py --from build_data   # resume from a step
node data/verify_data.js         # data-only integrity check (no engine needed)
```

When `app-data.js` exists and `verify_data.js` passes, proceed to **`app_build_prompt.md`**.

Build it to be correct and honest first: every value sourced, no gene special-cased, both hubs fetched
symmetrically and fully.
