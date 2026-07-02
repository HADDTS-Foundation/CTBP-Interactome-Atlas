"""
genage  -  step 10.

Data-driven Aging/longevity membership from HAGR:
  - GenAge human ageing genes        -> aging.genage, aging.why, aging.id
  - LongevityMap *significant* rows  -> aging.longevity, aging.pmids

node.aging is written only for members (GenAge OR significant LongevityMap). HAGR
can hard-block (415); on any failure we DEGRADE GRACEFULLY, preserving any existing
node.aging and never wiping the field.
"""
import io, csv, zipfile, re
import common as C

GENAGE_URL = "https://genomics.senescence.info/genes/human_genes.zip"
LONGEVITY_URL = "https://genomics.senescence.info/longevity/longevity_genes.zip"
UA_BROWSER = {"User-Agent": "Mozilla/5.0 (compatible; CTBP-Atlas data pipeline)"}

def _zip_csv(url, member):
    b = C.http_raw(url, headers=UA_BROWSER, timeout=90)
    if b is None:
        return None
    try:
        z = zipfile.ZipFile(io.BytesIO(b))
        name = member
        if name not in z.namelist():
            cands = [n for n in z.namelist() if n.endswith(".csv")]
            if not cands:
                return None
            name = cands[0]
        return z.read(name).decode("utf-8", "replace")
    except (zipfile.BadZipFile, KeyError):
        return None

def load_genage():
    txt = _zip_csv(GENAGE_URL, "genage_human.csv")
    if not txt:
        return None
    by_sym, by_entrez = {}, {}
    for row in csv.DictReader(io.StringIO(txt)):
        sym = (row.get("symbol") or "").strip()
        ent = (row.get("entrez gene id") or "").strip()
        rec = {"id": (row.get("GenAge ID") or "").strip(), "why": (row.get("why") or "").strip()}
        if sym: by_sym[sym.upper()] = rec
        if ent: by_entrez[ent] = rec
    return {"sym": by_sym, "entrez": by_entrez}

def load_longevity():
    txt = _zip_csv(LONGEVITY_URL, "longevity.csv")
    if not txt:
        return None
    by_sym = {}
    for row in csv.DictReader(io.StringIO(txt)):
        if (row.get("Association") or "").strip().lower() != "significant":
            continue
        genes = re.split(r"[;,]", row.get("Gene(s)") or "")
        pmid = (row.get("PubMed") or "").strip()
        for g in genes:
            g = g.strip().upper()
            if not g:
                continue
            d = by_sym.setdefault(g, set())
            if pmid:
                d.add(pmid)
    return by_sym

def run():
    work = C.load_work()
    ga = load_genage()
    lm = load_longevity()
    if ga is None and lm is None:
        C.log("  ! HAGR unreachable; preserving existing aging (graceful degradation)")
        C.emit_app_data(work)
        return
    C.log("  GenAge: %s genes; LongevityMap significant: %s genes"
          % (len(ga["sym"]) if ga else "n/a", len(lm) if lm else "n/a"))

    def apply(sym, entrez, dst):
        genage = ga["sym"].get(sym.upper()) or (ga["entrez"].get(entrez) if entrez else None) if ga else None
        lgv = lm.get(sym.upper()) if lm else None
        if not genage and not lgv:
            return
        aging = {"genage": bool(genage), "longevity": bool(lgv)}
        if genage:
            aging["why"] = genage.get("why") or None
            aging["id"] = genage.get("id") or None
        if lgv:
            aging["pmids"] = sorted(lgv)[:12]
        dst["aging"] = aging

    n = 0
    for h in C.HUBS:
        before = "aging" in work["hubs"][h]
        apply(h, C.SEED[h]["entrez"], work["hubs"][h])
        n += 1 if ("aging" in work["hubs"][h] and not before) else 0
    members = 0
    for sym, nd in work["nodesBySym"].items():
        apply(sym, nd.get("entrez"), nd)
        if nd.get("aging"):
            members += 1
    C.log("  aging members among partners: %d" % members)
    C.save_work(work)
    C.emit_app_data(work)
    C.log("genage done.")

if __name__ == "__main__":
    run()
