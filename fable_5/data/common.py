"""
common.py  -  shared helpers for the CTBP Interactome Atlas data pipeline.

Standard library only (urllib, json, csv, zipfile, re, time, os, sys, hashlib,
threading, concurrent.futures). No third-party packages, no API keys.

Everything the pipeline steps need lives here:
  - HUBS + the fixed hub seed IDs (the ONLY hard-coded gene tokens)
  - a polite, cached, retry-with-backoff HTTP GET / POST-JSON
  - a bounded thread-pool map (pmap) for the thousands of key-free calls
  - a dedicated <=3 req/s limiter for NCBI eutils
  - working-state I/O (_work.json) + the app-data.js emitter (the read-side
    contract in app_build_prompt.md section 4)
"""

import os, sys, re, json, time, hashlib, threading, urllib.request, urllib.parse, urllib.error
from concurrent.futures import ThreadPoolExecutor

# ---------------------------------------------------------------- paths --------
HERE   = os.path.dirname(os.path.abspath(__file__))          # .../fable_5/data
PROOT  = os.path.dirname(HERE)                               # .../fable_5
CACHE  = os.path.join(HERE, "cache")
WORK   = os.path.join(HERE, "_work.json")
APPDATA = os.path.join(PROOT, "app-data.js")
BIOGRID_DIR = os.path.join(HERE, "BioGRID")
os.makedirs(CACHE, exist_ok=True)

# ---------------------------------------------------------------- constants ----
HUBS = ["CTBP1", "CTBP2"]

# The only fixed gene tokens in the whole pipeline: the IDs used to START each
# hub's fetch. Every other gene is discovered from the data.
SEED = {
    "CTBP1": {"ensembl": "ENSG00000159692", "entrez": "1487", "uniprot": "Q13363",
              "string": "9606.ENSP00000290921"},
    "CTBP2": {"ensembl": "ENSG00000175029", "entrez": "1488", "uniprot": "P56545",
              "string": "9606.ENSP00000311825"},
}

TOPN    = 250            # STRING neighbours per hub (stated curation choice)
SPECIES = 9606
BIOGRID_RELEASE = "5.0.258"

UA = ("CTBP-Interactome-Atlas/1.0 (data pipeline; standard-library urllib; "
      "contact: HADDTS Foundation)")

# STRING channel keys, in canonical order.
CHANNELS = ["c", "e", "d", "t", "a", "p", "n", "f"]

# Literature stop-list (ambiguous / housekeeping); still counted, but the app
# excludes them from the literature score. Kept here so pipeline + engine agree.
STOPLIST = ["IMPACT", "GAPDH", "TBP", "ACTB", "B2M"]

# Ambiguous homograph aliases to drop from node.syn (they name unrelated genes
# and cannot be detected syntactically). Curated blocklist (section 6 / section 8).
SYN_BLOCKLIST = {"GLP1", "P18", "PC2", "PH1", "C21", "DC42", "IRA1"}

# CTBP1 lncRNA loci excluded from every co-mention query (NOT "CTBP1-AS" - "AS"
# is a stopword that nukes the result set).
LNCRNA_EXCLUDE = ["CTBP1-AS2", "CTBP1-DT", "CTBP1-AS1"]

# ---------------------------------------------------------------- logging ------
_log_lock = threading.Lock()
def log(*a):
    with _log_lock:
        print(*a, flush=True)

# ---------------------------------------------------------------- rate limit ---
class MinInterval:
    """Serialise callers to at most one call per `interval` seconds (thread-safe)."""
    def __init__(self, interval):
        self.interval = interval
        self.lock = threading.Lock()
        self.next = 0.0
    def wait(self):
        with self.lock:
            now = time.monotonic()
            if now < self.next:
                time.sleep(self.next - now)
                now = time.monotonic()
            self.next = now + self.interval

NCBI = MinInterval(0.45)     # ~2.2 req/s, key-free eutils politeness (refuses under load)
EPMC_LIMIT = MinInterval(0.2)   # ~5 req/s GLOBAL cap (EBI IP-throttles under sustained load)
POLITE = MinInterval(0.0)    # general (per-request sleep handled by callers)

# ---------------------------------------------------------------- cache --------
def _cache_path(key):
    h = hashlib.sha1(key.encode("utf-8")).hexdigest()
    return os.path.join(CACHE, h + ".cache")

def cache_get(key):
    p = _cache_path(key)
    if os.path.exists(p):
        try:
            with open(p, "rb") as f:
                return f.read()
        except OSError:
            return None
    return None

def cache_put(key, data):
    p = _cache_path(key)
    try:
        with open(p, "wb") as f:
            f.write(data)
    except OSError:
        pass

# ---------------------------------------------------------------- http ---------
def _open(req, timeout):
    return urllib.request.urlopen(req, timeout=timeout)

def http_raw(url, data=None, headers=None, timeout=45, tries=4, backoff=2.0,
             limiter=None, cache=True, accept_status=(200,), fail_fast=False):
    """
    Polite HTTP with on-disk cache + bounded retry/backoff.
    Returns response bytes, or None on give-up (graceful degradation).
    `data` (bytes) -> POST. `limiter` -> a MinInterval to honour before each hit.
    `fail_fast` -> a single attempt (for endpoints that 5xx under retry storms).
    """
    method = "POST" if data is not None else "GET"
    ckey = method + " " + url + (" " + hashlib.sha1(data).hexdigest() if data else "")
    if cache:
        hit = cache_get(ckey)
        if hit is not None:
            return hit
    hdr = {"User-Agent": UA, "Accept": "application/json, text/plain, */*"}
    if headers:
        hdr.update(headers)
    attempts = 1 if fail_fast else tries
    last = None
    for i in range(attempts):
        if limiter:
            limiter.wait()
        try:
            req = urllib.request.Request(url, data=data, headers=hdr, method=method)
            with _open(req, timeout) as r:
                body = r.read()
            if cache:
                cache_put(ckey, body)
            return body
        except urllib.error.HTTPError as e:
            last = "HTTP %s" % e.code
            # 4xx (except 429) will not fix themselves; stop retrying.
            if e.code < 500 and e.code != 429:
                break
        except Exception as e:               # URLError, timeout, socket, ...
            last = repr(e)
        if i < attempts - 1:
            time.sleep(backoff * (2 ** i))
    log("    ! give up %s (%s)" % (url[:90], last))
    return None

def get_json(url, **kw):
    b = http_raw(url, **kw)
    if b is None:
        return None
    try:
        return json.loads(b.decode("utf-8", "replace"))
    except (ValueError, UnicodeDecodeError):
        return None

def post_json(url, payload, **kw):
    body = json.dumps(payload).encode("utf-8")
    kw.setdefault("headers", {})["Content-Type"] = "application/json"
    b = http_raw(url, data=body, **kw)
    if b is None:
        return None
    try:
        return json.loads(b.decode("utf-8", "replace"))
    except (ValueError, UnicodeDecodeError):
        return None

def post_form(url, fields, **kw):
    body = urllib.parse.urlencode(fields).encode("utf-8")
    kw.setdefault("headers", {})["Content-Type"] = "application/x-www-form-urlencoded"
    b = http_raw(url, data=body, **kw)
    if b is None:
        return None
    try:
        return json.loads(b.decode("utf-8", "replace"))
    except (ValueError, UnicodeDecodeError):
        return None

def get_text(url, **kw):
    b = http_raw(url, **kw)
    return None if b is None else b.decode("utf-8", "replace")

def string_channels(row):
    """Map a STRING interaction row to our 8 canonical channel keys."""
    return {"c": row.get("score"), "e": row.get("escore"), "d": row.get("dscore"),
            "t": row.get("tscore"), "a": row.get("ascore"), "p": row.get("fscore"),
            "n": row.get("nscore"), "f": row.get("pscore")}

# ---------------------------------------------------------------- thread map ---
def pmap(fn, items, workers=6, label=None):
    """Run fn over items with a bounded thread pool, preserving order.
    Progress is logged every ~5%. Exceptions become None (graceful)."""
    items = list(items)
    n = len(items)
    if n == 0:
        return []
    out = [None] * n
    done = [0]
    step = max(1, n // 20)
    lk = threading.Lock()
    def wrap(i_it):
        i, it = i_it
        try:
            r = fn(it)
        except Exception as e:               # never let one item kill the run
            log("    ! item error: %r" % e)
            r = None
        out[i] = r
        with lk:
            done[0] += 1
            if label and (done[0] % step == 0 or done[0] == n):
                log("    %s %d/%d" % (label, done[0], n))
        return None
    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(wrap, enumerate(items)))
    return out

# ---------------------------------------------------------------- work I/O -----
def load_work():
    if os.path.exists(WORK):
        with open(WORK, "r") as f:
            return json.load(f)
    return {"hubs": {}, "hubEdge": None, "nodesBySym": {}, "edges": [],
            "meta": {}, "scratch": {}}

def save_work(work):
    tmp = WORK + ".tmp"
    with open(tmp, "w") as f:
        json.dump(work, f)
    os.replace(tmp, WORK)

def node(work, sym):
    """Get-or-create the node dict for a gene symbol in the working state."""
    return work["nodesBySym"].setdefault(sym, {"sym": sym})

# ---------------------------------------------------------------- emit ---------
def _num(x):
    return x if isinstance(x, (int, float)) else 0

def emit_app_data(work):
    """Project the working state into the app_build_prompt.md section 4 contract
    and write minified `window.CTBP_DATA` to ../app-data.js. Idempotent."""
    nodes = []
    shared = c1only = c2only = 0
    for sym in sorted(work["nodesBySym"]):
        nd = work["nodesBySym"][sym]
        hset = nd.get("hubs") or []
        if not hset:
            continue                          # not attributed to a hub -> not a partner
        if "CTBP1" in hset and "CTBP2" in hset: shared += 1
        elif "CTBP1" in hset: c1only += 1
        elif "CTBP2" in hset: c2only += 1
        nodes.append(_project_node(nd))
    nodes.sort(key=lambda n: -(_headline(n)))
    edges = work.get("edges", [])
    meta = dict(work.get("meta", {}))
    meta["hubs"] = HUBS
    meta.setdefault("species", SPECIES)
    meta["neighborhood"] = {"CTBP1": c1only + shared, "CTBP2": c2only + shared,
                            "shared": shared, "union": len(nodes)}
    meta["edgeCount"] = len(edges)
    meta["nodeCount"] = len(nodes) + 2        # union partners + 2 hubs
    meta.setdefault("channelLegend", {
        "c": "combined", "e": "experiments", "d": "databases", "t": "text-mining",
        "a": "co-expression", "p": "fusion", "n": "neighborhood", "f": "co-occurrence"})
    data = {"hubs": work["hubs"], "hubEdge": work.get("hubEdge"),
            "nodes": nodes, "edges": edges, "meta": meta}
    payload = "window.CTBP_DATA = " + json.dumps(data, separators=(",", ":")) + ";\n"
    tmp = APPDATA + ".tmp"
    with open(tmp, "w") as f:
        f.write(payload)
    os.replace(tmp, APPDATA)
    log("  emitted app-data.js: %d nodes (%d shared / %d CTBP1-only / %d CTBP2-only), %d edges"
        % (len(nodes), shared, c1only, c2only, len(edges)))

def _headline(n):
    # a rough ordering hint only (real composite is computed in engine.js)
    s1 = n.get("s1") or {}
    s2 = n.get("s2") or {}
    return max(_num(s1.get("c")), _num(s2.get("c")))

# fields carried verbatim into a contract node when present
_NODE_FIELDS = ["sym", "name", "ensembl", "entrez", "uniprot", "mim", "hubs",
                "rank1", "rank2", "s1", "s2", "lit1", "lit2",
                "comention1", "comention2", "comentionB", "litB",
                "dz", "tract", "areas", "dis", "func", "funcRefs", "refs", "syn",
                "intact", "biogrid", "clinvar", "pathways", "phenotypes",
                "phenoCount", "aging", "go", "mech"]

def _project_node(nd):
    out = {}
    for k in _NODE_FIELDS:
        if k in nd and nd[k] is not None:
            out[k] = nd[k]
    return out
