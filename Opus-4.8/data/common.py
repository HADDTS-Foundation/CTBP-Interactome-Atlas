"""
common.py — shared helpers for the CTBP INTERACTOME ATLAS data pipeline.

Standard library only (urllib, json, csv, zipfile, re, time, os, sys, hashlib).
No keys, no third-party packages.

Design (the realised pipeline):
  * data/_work.json   — the rich working store. Fetch/enrich steps read it,
                        mutate a per-gene map + per-hub blocks, and write it back.
                        This is the resumable source of truth during a build.
                        It is NOT shipped to the browser.
  * data/cache/*.json — raw HTTP response cache (keyed by method+url+body) so
                        re-runs and `--from` resumes never re-hit the network.
  * ../app-data.js    — the shipped, minified snapshot `window.CTBP_DATA = {…}`.
                        emit_appdata() assembles it from _work.json (the union of
                        both hubs' neighbourhoods, with per-hub attribution) and is
                        called at the end of every step, so app-data.js always
                        reflects the latest working state (§3 of the data prompt:
                        each step rewrites app-data.js).

Everything here is symmetric in the two hubs; the only fixed gene tokens are the
two subject hubs (HUBS) and the documented literature stop-list.
"""

import csv
import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

# ── paths ────────────────────────────────────────────────────────────────────
DATA_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(DATA_DIR)
CACHE_DIR = os.path.join(DATA_DIR, "cache")
WORK_PATH = os.path.join(DATA_DIR, "_work.json")
APPDATA_PATH = os.path.join(ROOT_DIR, "app-data.js")

os.makedirs(CACHE_DIR, exist_ok=True)

# ── the two subject hubs (the ONLY fixed gene tokens) ──────────────────────────
HUBS = ["CTBP1", "CTBP2"]

HUB_IDS = {
    "CTBP1": {"ensembl": "ENSG00000159692", "entrez": "1487", "uniprot": "Q13363"},
    "CTBP2": {"ensembl": "ENSG00000175029", "entrez": "1488", "uniprot": "P56545"},
}

# Hub display names + the synonym groups used to build co-mention queries.
# Ambiguous homographs are deliberately excluded.
HUB_NAME = {
    "CTBP1": "C-terminal binding protein 1",
    "CTBP2": "C-terminal binding protein 2",
}
HUB_SYNONYMS = {
    "CTBP1": ["CTBP1", "CtBP1"],
    "CTBP2": ["CTBP2", "CtBP2"],
}
# Ortholog-aware terms for the curated aging/longevity reading lists (§6 data prompt).
HUB_ORTHO_TERMS = {
    "CTBP1": ['"CtBP1" OR "CTBP-1" OR "ctbp-1" OR "CtBP/BARS"'],
    "CTBP2": ['"CtBP2"'],
}

# Literature stop-list / housekeeping symbols (§2.3 / §6.1). Counts are still
# fetched; the engine zeroes their literature contribution.
STOPLIST = ["IMPACT", "GAPDH", "TBP", "ACTB", "B2M"]

# Ambiguous-homograph aliases to drop from node.syn (§8). They name an unrelated
# gene and cannot be disambiguated syntactically.
SYN_BLOCKLIST = {"GLP1", "P18", "PC2", "PH1", "C21", "DC42", "IRA1"}

# The CTBP1 lncRNA loci excluded from every co-mention query (§8). "CTBP1-AS" is
# deliberately NOT excluded ("AS" is a stopword that nukes the result set).
LNCRNA_EXCLUDE = ['CTBP1-AS2', 'CTBP1-DT', 'CTBP1-AS1']

# STRING v12 channel column -> our compact key.
#   c=combined e=experiments d=databases t=text-mining
#   a=co-expression p=fusion n=neighborhood f=co-occurrence
STRING_CHANNEL_MAP = {
    "score": "c",
    "escore": "e",
    "dscore": "d",
    "tscore": "t",
    "ascore": "a",
    "fscore": "p",
    "nscore": "n",
    "pscore": "f",
}
CHANNEL_LEGEND = {
    "c": "combined", "e": "experiments", "d": "databases", "t": "text-mining",
    "a": "co-expression", "p": "fusion", "n": "neighborhood", "f": "co-occurrence",
}

# Reactome top-level "umbrella" pathways to drop (we want specific leaves, §93/§7).
REACTOME_UMBRELLAS = {
    "signal transduction", "metabolism", "disease", "gene expression (transcription)",
    "immune system", "metabolism of proteins", "metabolism of rna", "developmental biology",
    "cell cycle", "cellular responses to stimuli", "cellular responses to stress",
    "hemostasis", "dna repair", "dna replication", "transport of small molecules",
    "vesicle-mediated transport", "programmed cell death", "neuronal system",
    "extracellular matrix organization", "muscle contraction", "metabolism of lipids",
    "chromatin organization", "post-translational protein modification",
    "rna polymerase ii transcription", "generic transcription pathway",
    "organelle biogenesis and maintenance", "autophagy", "protein localization",
    "sensory perception", "reproduction", "circadian clock", "digestion and absorption",
}

# Therapeutic-area EFO labels the engine keys on (§7 data prompt / §6.3 app).
# Documentation only: the pipeline stores ALL OT therapeuticAreas verbatim and
# never decides membership. NOTE: Open Targets renamed several areas "… disease"
# → "… disorder"; the engine keys on both variants. The pipeline is unaffected
# (it keeps whatever label OT returns).
EFO_AREAS_OF_INTEREST = {
    "cancer or benign tumor", "nutritional or metabolic disease",
    "endocrine system disorder", "nervous system disorder", "psychiatric disorder",
    "immune system disorder", "cardiovascular disorder", "hematologic disorder",
    "disorder of visual system",
}

# Public sources, surfaced verbatim in meta.sources (each linked in the app).
SOURCES = [
    {"name": "STRING", "url": "https://string-db.org", "desc": "protein–protein interaction channels + neighbourhood"},
    {"name": "Open Targets", "url": "https://platform.opentargets.org", "desc": "disease associations, therapeutic areas, tractability"},
    {"name": "Europe PMC", "url": "https://europepmc.org", "desc": "synonym-aware co-mention literature"},
    {"name": "IntAct", "url": "https://www.ebi.ac.uk/intact", "desc": "curated molecular interactions"},
    {"name": "UniProt", "url": "https://www.uniprot.org", "desc": "function, cofactor, complex membership"},
    {"name": "ClinVar", "url": "https://www.ncbi.nlm.nih.gov/clinvar", "desc": "clinical variant tallies"},
    {"name": "HPO", "url": "https://hpo.jax.org", "desc": "clinical phenotype terms"},
    {"name": "Reactome", "url": "https://reactome.org", "desc": "pathway membership (leaf pathways)"},
    {"name": "GenAge / LongevityMap", "url": "https://genomics.senescence.info", "desc": "ageing / longevity gene sets (HAGR)"},
    {"name": "MyGene.info", "url": "https://mygene.info", "desc": "identifier resolution"},
]

USER_AGENT = ("CTBP-Interactome-Atlas/1.0 (offline research console; "
              "stdlib pipeline; contact via HADDTS Foundation)")

# ── small numeric helpers ──────────────────────────────────────────────────────
def num(x):
    """Treat a missing/None channel as 0.0 (matches the engine's num())."""
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def clean_func(text):
    """Strip UniProt/OT evidence codes ({ECO:…}, (PubMed:…)) and tidy whitespace."""
    if not text:
        return text
    text = re.sub(r"\s*\{ECO:[^}]*\}", "", text)
    text = re.sub(r"\s*\((?:PubMed|Ref\.?):[^)]*\)", "", text)
    text = re.sub(r"\s{2,}", " ", text).strip()
    return text


def log(msg):
    sys.stdout.write(msg.rstrip() + "\n")
    sys.stdout.flush()


# ── HTTP with disk cache + bounded retry/backoff ───────────────────────────────
def _cache_path(key):
    h = hashlib.sha1(key.encode("utf-8")).hexdigest()
    return os.path.join(CACHE_DIR, h + ".json")


def _cache_load(key):
    p = _cache_path(key)
    if os.path.exists(p):
        try:
            with open(p, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except Exception:
            return None
    return None


def _cache_store(key, payload):
    p = _cache_path(key)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh)
    os.replace(tmp, p)


def fetch(url, *, data=None, headers=None, method=None, parse="json",
          retries=4, backoff=1.6, timeout=45, sleep=0.20, cache=True,
          cache_key=None, fatal=False):
    """
    Polite cached HTTP. Returns parsed JSON (parse='json'), text (parse='text'),
    or raw bytes (parse='bytes'). On persistent failure returns None unless
    fatal=True. `data` (bytes or dict) makes it a POST; a dict is form-encoded
    unless a JSON content-type header is supplied (then it is JSON-encoded).
    """
    body = None
    ctype = (headers or {}).get("Content-Type", "")
    if data is not None:
        if isinstance(data, (bytes, bytearray)):
            body = bytes(data)
        elif isinstance(data, dict):
            if "json" in ctype:
                body = json.dumps(data).encode("utf-8")
            else:
                body = urllib.parse.urlencode(data).encode("utf-8")
        else:
            body = str(data).encode("utf-8")

    key = cache_key or "|".join([method or ("POST" if body else "GET"), url,
                                 (body or b"").decode("utf-8", "replace")])
    if cache:
        hit = _cache_load(key)
        if hit is not None:
            return _decode_cached(hit, parse)

    req_headers = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    if headers:
        req_headers.update(headers)

    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=body, headers=req_headers,
                                         method=method)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
            time.sleep(sleep)
            if parse == "bytes":
                stored = {"_b64": _b64(raw)}
                if cache:
                    _cache_store(key, stored)
                return raw
            text = raw.decode("utf-8", "replace")
            if parse == "text":
                if cache:
                    _cache_store(key, {"_text": text})
                return text
            obj = json.loads(text)
            if cache:
                _cache_store(key, {"_json": obj})
            return obj
        except urllib.error.HTTPError as e:
            last_err = "HTTP %s %s" % (e.code, url)
            # 4xx (except 429) won't fix on retry; stop early.
            if e.code in (400, 401, 403, 404, 410, 415, 422):
                break
            time.sleep(backoff ** attempt)
        except Exception as e:  # URLError, timeout, JSON decode, …
            last_err = "%s %s" % (type(e).__name__, url)
            time.sleep(backoff ** attempt)

    if fatal:
        raise RuntimeError("fetch failed: %s (%s)" % (url, last_err))
    log("    · soft-fail: %s" % last_err)
    return None


def _b64(raw):
    import base64
    return base64.b64encode(raw).decode("ascii")


def _decode_cached(hit, parse):
    if not isinstance(hit, dict):
        return hit
    if "_json" in hit:
        return hit["_json"]
    if "_text" in hit:
        return hit["_text"]
    if "_b64" in hit:
        import base64
        return base64.b64decode(hit["_b64"])
    return hit


def fetch_zip(url, **kw):
    """Fetch a .zip and return a zipfile.ZipFile, or None on failure."""
    raw = fetch(url, parse="bytes", **kw)
    if raw is None:
        return None
    try:
        return zipfile.ZipFile(io.BytesIO(raw))
    except Exception:
        return None


# ── the working store (data/_work.json) ────────────────────────────────────────
def new_work():
    return {
        "date": time.strftime("%Y-%m-%d"),
        "species": "Homo sapiens (9606)",
        "hubs": {},          # CTBP1 / CTBP2 hub blocks
        "hubEdge": None,     # {s:{…}}
        "genes": {},         # SYM -> node-in-progress
        "edges": [],         # partner↔partner {a,b,s}
        "channelLegend": CHANNEL_LEGEND,
    }


def load_work():
    if os.path.exists(WORK_PATH):
        with open(WORK_PATH, "r", encoding="utf-8") as fh:
            return json.load(fh)
    return new_work()


def save_work(work):
    tmp = WORK_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(work, fh)
    os.replace(tmp, WORK_PATH)


def gene(work, sym):
    """Get-or-create the working record for a gene symbol."""
    g = work["genes"].get(sym)
    if g is None:
        g = {"sym": sym}
        work["genes"][sym] = g
    return g


# ── Europe PMC query builder (MUST stay byte-identical to app.js, §8) ──────────
def _phrase_group(terms, field):
    """OR-group of quoted phrases, optionally wrapped in a TITLE:/ABSTRACT: field."""
    parts = []
    for t in terms:
        t = t.replace('"', '')
        if field == "title":
            parts.append('TITLE:"%s"' % t)
        elif field == "abs":
            parts.append('(TITLE:"%s" OR ABSTRACT:"%s")' % (t, t))
        else:  # all / full text — bare quoted phrase
            parts.append('"%s"' % t)
    return "(" + " OR ".join(parts) + ")"


def comention_query(hub_terms, gene_terms, tier):
    """
    Tiered, synonym-aware co-mention query (title | abs | all), with the CTBP1
    lncRNA loci excluded from every query. tier in {'title','abs','all'}.
    The app rebuilds this byte-for-byte so the in-app source link reproduces the count.
    """
    h = _phrase_group(hub_terms, tier)
    g = _phrase_group(gene_terms, tier)
    q = "%s AND %s" % (h, g)
    for loc in LNCRNA_EXCLUDE:
        q += ' NOT "%s"' % loc
    return q


def comention_query_both(gene_terms, tier):
    """
    Co-mention of a gene with BOTH hubs together: (CTBP1 group) AND (CTBP2 group)
    AND (gene group), tiered like comention_query, lncRNA loci excluded. This is the
    literature analog of the "shared" attribution; meaningful only for shared genes.
    Must stay byte-identical to the app's builder.
    """
    q = "%s AND %s AND %s" % (_phrase_group(HUB_SYNONYMS["CTBP1"], tier),
                              _phrase_group(HUB_SYNONYMS["CTBP2"], tier),
                              _phrase_group(gene_terms, tier))
    for loc in LNCRNA_EXCLUDE:
        q += ' NOT "%s"' % loc
    return q


def epmc_search_url(query, *, page_size=1, result_type="lite", sort=None, fmt="json"):
    params = {"query": query, "format": fmt, "pageSize": str(page_size),
              "resultType": result_type}
    if sort:
        params["sort"] = sort
    return ("https://www.ebi.ac.uk/europepmc/webservices/rest/search?"
            + urllib.parse.urlencode(params))


def epmc_web_url(query):
    """Human-facing Europe PMC search link mirroring an in-app count."""
    return "https://europepmc.org/search?query=" + urllib.parse.quote(query)


# ── ClinVar query builder (exact [Filter] tokens, §91 data prompt / §5 app) ────
CLINVAR_TERMS = {
    "plp": "{sym}[gene] AND (clinsig_pathogenic[Filter] OR clinsig_likely_path[Filter])",
    "vus": "{sym}[gene] AND clinsig_vus[Filter]",
    "total": "{sym}[gene]",
}


def clinvar_term(sym, which):
    return CLINVAR_TERMS[which].format(sym=sym)


def clinvar_esearch_url(sym, which):
    term = clinvar_term(sym, which)
    return ("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?"
            + urllib.parse.urlencode({"db": "clinvar", "retmode": "json", "term": term}))


def clinvar_web_url(sym, which):
    term = clinvar_term(sym, which)
    return "https://www.ncbi.nlm.nih.gov/clinvar/?term=" + urllib.parse.quote(term)


# ── synonym hygiene (§8) ───────────────────────────────────────────────────────
def clean_synonyms(sym, aliases):
    """Keep real aliases; drop the curated homograph blocklist and noise."""
    out = []
    seen = {sym.upper()}
    for a in aliases or []:
        if not a:
            continue
        a = a.strip()
        u = a.upper()
        if not a or u in seen:
            continue
        if u in SYN_BLOCKLIST:
            continue
        if len(a) < 2:                # single chars are noise
            continue
        if a.isdigit():               # bare numbers are noise
            continue
        seen.add(u)
        out.append(a)
    return out


# ── emit the shipped snapshot (the union assembly + meta) ──────────────────────
SHIPPED_NODE_FIELDS = [
    "sym", "name", "ensembl", "entrez", "uniprot", "mim",
    "hubs", "rank1", "rank2", "s1", "s2", "lit1", "lit2",
    "comention1", "comention2", "comentionB", "litB", "dz", "tract", "areas", "dis",
    "func", "funcRefs", "refs", "syn", "intact", "clinvar",
    "pathways", "phenotypes", "phenoCount", "aging",
]


def _node_hubs(g):
    hubs = []
    if g.get("s1") is not None:
        hubs.append("CTBP1")
    if g.get("s2") is not None:
        hubs.append("CTBP2")
    return hubs


def assemble(work):
    """Build the shipped window.CTBP_DATA object from the working store."""
    nodes = []
    shared = c1 = c2 = 0
    for sym, g in work["genes"].items():
        hubs = _node_hubs(g)
        if not hubs:
            continue  # a gene that scores against neither hub is not in the union
        node = {}
        for f in SHIPPED_NODE_FIELDS:
            if f == "hubs":
                node["hubs"] = hubs
                continue
            v = g.get(f, None)
            # Only rank + STRING score are structural (present iff the node neighbours
            # that hub). Co-mention / lit / comentionB are hub-INDEPENDENT literature
            # and are kept for every node, regardless of which hub it neighbours.
            if f in ("rank1", "s1") and "CTBP1" not in hubs:
                v = None
            if f in ("rank2", "s2") and "CTBP2" not in hubs:
                v = None
            if v is not None:
                node[f] = v
        nodes.append(node)
        if len(hubs) == 2:
            shared += 1
        elif hubs == ["CTBP1"]:
            c1 += 1
        else:
            c2 += 1

    nodes.sort(key=lambda n: -max(num(n.get("s1", {}).get("c") if n.get("s1") else 0),
                                  num(n.get("s2", {}).get("c") if n.get("s2") else 0)))

    n1 = sum(1 for n in nodes if "CTBP1" in n["hubs"])
    n2 = sum(1 for n in nodes if "CTBP2" in n["hubs"])

    data = {
        "hubs": work.get("hubs", {}),
        "hubEdge": work.get("hubEdge") or {"s": {}},
        "nodes": nodes,
        "edges": work.get("edges", []),
        "meta": {
            "date": work.get("date"),
            "species": work.get("species", "Homo sapiens (9606)"),
            "hubs": list(HUBS),
            "neighborhood": {"CTBP1": n1, "CTBP2": n2, "shared": shared,
                             "union": len(nodes)},
            "sources": SOURCES,
            "channelLegend": work.get("channelLegend", CHANNEL_LEGEND),
            "edgeCount": len(work.get("edges", [])),
            "nodeCount": len(nodes) + 2,
            "topN": 250,
            "counts": {"shared": shared, "CTBP1-only": c1, "CTBP2-only": c2},
        },
    }
    return data


def emit_appdata(work):
    data = assemble(work)
    payload = "window.CTBP_DATA = " + json.dumps(data, separators=(",", ":")) + ";\n"
    tmp = APPDATA_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(payload)
    os.replace(tmp, APPDATA_PATH)
    return data


# ── reading an existing app-data.js (the §3 regex contract) ────────────────────
APPDATA_RE = re.compile(r"^\s*window\.CTBP_DATA\s*=\s*(\{.*\})\s*;\s*$", re.S)


def read_appdata():
    if not os.path.exists(APPDATA_PATH):
        return None
    with open(APPDATA_PATH, "r", encoding="utf-8") as fh:
        txt = fh.read()
    m = APPDATA_RE.match(txt)
    if not m:
        return None
    return json.loads(m.group(1))
