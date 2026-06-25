"""
annotate — per-gene annotations:
  * UniProtKB: function text, cofactor, complex (subunit), GO terms, function PMIDs.
  * Reactome ContentService: specific leaf pathways (umbrella-filtered), fail-fast;
    MyGene pathway.reactome is the last-resort, umbrella-filtered fallback.
  * HPO (ontology.jax.org): clinical-phenotype terms + count; a Monarch browse link
    is reconstructable in-app from the Entrez id.
"""

import common as C

REACTOME = "https://reactome.org/ContentService/data/mapping/UniProt/%s/pathways?species=9606"
HPO = "https://ontology.jax.org/api/network/annotation/NCBIGene:%s"


# ── ClinVar (eutils esearch, exact [Filter] tokens — §91/§5) ───────────────────
def clinvar_count(sym, which):
    res = C.fetch(C.clinvar_esearch_url(sym, which), sleep=0.34, retries=3)
    if isinstance(res, dict):
        c = (res.get("esearchresult") or {}).get("count")
        if c is not None:
            try:
                return int(c)
            except ValueError:
                return None
    return None


def clinvar(sym):
    plp = clinvar_count(sym, "plp")
    vus = clinvar_count(sym, "vus")
    total = clinvar_count(sym, "total")
    if plp is None and vus is None and total is None:
        return None
    # keep P/LP ≤ total honest if a transient miscount slips through
    if total is not None and plp is not None and plp > total:
        total = plp + (vus or 0)
    return {"plp": plp, "vus": vus, "total": total}


# ── UniProt ────────────────────────────────────────────────────────────────────
def uniprot(acc):
    return C.fetch("https://rest.uniprot.org/uniprotkb/%s.json" % acc)


def parse_uniprot(res):
    if not isinstance(res, dict):
        return None
    out = {"func": None, "funcRefs": [], "cofactor": None, "subunit": None,
           "go": {"MF": [], "BP": [], "CC": []}}
    for c in res.get("comments") or []:
        ct = c.get("commentType")
        if ct == "FUNCTION":
            txts = c.get("texts") or []
            if txts:
                out["func"] = C.clean_func(txts[0].get("value"))
                for ev in txts[0].get("evidences") or []:
                    if ev.get("source") == "PubMed" and ev.get("id"):
                        if ev["id"] not in out["funcRefs"] and len(out["funcRefs"]) < 6:
                            out["funcRefs"].append(ev["id"])
        elif ct == "COFACTOR":
            names = [cf.get("name") for cf in (c.get("cofactors") or []) if cf.get("name")]
            if names:
                out["cofactor"] = ", ".join(names)
        elif ct == "SUBUNIT":
            txts = c.get("texts") or []
            if txts:
                out["subunit"] = txts[0].get("value")
    for x in res.get("uniProtKBCrossReferences") or []:
        if x.get("database") != "GO":
            continue
        term = None
        for p in x.get("properties") or []:
            if p.get("key") == "GoTerm":
                term = p.get("value")
        if not term or ":" not in term:
            continue
        aspect, name = term.split(":", 1)
        bucket = {"F": "MF", "P": "BP", "C": "CC"}.get(aspect)
        if bucket and name not in out["go"][bucket] and len(out["go"][bucket]) < 12:
            out["go"][bucket].append(name)
    return out


# ── Reactome ───────────────────────────────────────────────────────────────────
def reactome_pathways(acc):
    res = C.fetch(REACTOME % acc, retries=1, timeout=20, sleep=0.1)  # fail-fast
    names = []
    if isinstance(res, list):
        for p in res:
            nm = p.get("displayName")
            if nm and nm.lower() not in C.REACTOME_UMBRELLAS and nm not in names:
                names.append(nm)
    return names[:14]


def reactome_fallback(entrez):
    """Last-resort: MyGene pathway.reactome, umbrella-filtered."""
    url = "https://mygene.info/v3/gene/%s?fields=pathway.reactome" % entrez
    res = C.fetch(url)
    rp = (((res or {}).get("pathway") or {}).get("reactome")) if isinstance(res, dict) else None
    if isinstance(rp, dict):
        rp = [rp]
    names = []
    for p in rp or []:
        nm = p.get("name")
        if nm and nm.lower() not in C.REACTOME_UMBRELLAS and nm not in names:
            names.append(nm)
    return names[:14]


# ── HPO ────────────────────────────────────────────────────────────────────────
def hpo_phenotypes(entrez):
    res = C.fetch(HPO % entrez, retries=2, timeout=25, sleep=0.1)
    items = None
    if isinstance(res, dict):
        items = res.get("phenotypes") or res.get("termAssoc") or res.get("terms")
    elif isinstance(res, list):
        items = res
    names = []
    if items:
        for it in items:
            nm = it.get("name") if isinstance(it, dict) else None
            if nm and nm not in names:
                names.append(nm)
    return names


def annotate_record(rec, *, is_hub=False):
    acc = rec.get("uniprot") or (rec.get("ids", {}) or {}).get("uniprot")
    entrez = rec.get("entrez") or (rec.get("ids", {}) or {}).get("entrez")
    if acc:
        up = parse_uniprot(uniprot(acc))
        if up:
            if up["func"]:
                if is_hub:
                    rec["uniprotFunc"] = up["func"]
                    rec.setdefault("summary", up["func"])
                elif not rec.get("func"):
                    rec["func"] = up["func"]
            if up["funcRefs"]:
                rec["funcRefs"] = up["funcRefs"]
            if up["cofactor"]:
                rec["cofactor"] = up["cofactor"]
                # surface NAD(H) cofactor in func so the redox mechanism tag can fire
                if not is_hub and rec.get("func") and "NAD" in up["cofactor"].upper() \
                        and "NAD" not in (rec["func"] or "").upper():
                    rec["func"] = rec["func"] + " Cofactor: " + up["cofactor"] + "."
            if is_hub:
                if up["subunit"]:
                    rec["subunit"] = up["subunit"]
                if any(up["go"].values()):
                    rec["go"] = up["go"]
        # Reactome leaves (fail-fast) with MyGene fallback
        paths = reactome_pathways(acc)
        if not paths and entrez:
            paths = reactome_fallback(entrez)
        if paths:
            rec["pathways"] = paths
    if entrez:
        ph = hpo_phenotypes(entrez)
        if ph:
            rec["phenotypes"] = ph[:18]
            rec["phenoCount"] = len(ph)
    sym = rec.get("sym")
    if sym and not rec.get("clinvar"):
        cv = clinvar(sym)
        if cv:
            rec["clinvar"] = cv


def run():
    work = C.load_work()

    for H in C.HUBS:
        block = work["hubs"].get(H)
        if block:
            annotate_record(block, is_hub=True)
            C.log("  annotated hub %s" % H)

    genes = work["genes"]
    done = 0
    for sym, g in genes.items():
        done += 1
        try:
            annotate_record(g)
        except Exception as e:
            C.log("    annotate soft-fail %s: %s" % (sym, type(e).__name__))
        if done % 30 == 0:
            C.log("  annotate %d/%d" % (done, len(genes)))
            C.save_work(work)

    C.emit_appdata(work)
    C.save_work(work)
    C.log("annotate done")


if __name__ == "__main__":
    run()
