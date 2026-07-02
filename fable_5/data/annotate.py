"""
annotate  -  step 9.

Per gene (partners + both hubs):
  - UniProt : function text + evidence PMIDs (funcRefs), NAD cofactor, subunit
    (complex membership, hubs), and GO terms {MF,BP,CC}
  - Reactome: specific leaf pathways (official top-level umbrellas filtered out)
  - HPO     : clinical-phenotype terms + phenoCount
  - ClinVar : P/LP, VUS, total variant counts using the exact [Filter] tokens
"""
import common as C

UNIPROT = "https://rest.uniprot.org/uniprotkb"
REACTOME = "https://reactome.org/ContentService"
HPO = "https://ontology.jax.org/api/network/annotation"
EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"

# ClinVar [Filter] tokens (INVARIANT: never [Clinical significance])
CV_PLP = '(clinsig_pathogenic[Filter] OR clinsig_likely_path[Filter])'
CV_VUS = 'clinsig_vus[Filter]'

def genes(work):
    out = []
    for h in C.HUBS:
        out.append(("hub", h, work["hubs"][h]))
    for sym, nd in work["nodesBySym"].items():
        out.append(("node", sym, nd))
    return out

# ---------------------------------------------------------------- UniProt ------
def uniprot(acc):
    j = C.get_json("%s/%s.json?fields=cc_function,cc_cofactor,cc_subunit,go" % (UNIPROT, acc),
                   limiter=C.POLITE, timeout=60)
    if not j:
        return None
    func, funcRefs, cofactor, subunit = None, [], None, []
    for cm in j.get("comments", []) or []:
        t = cm.get("commentType")
        if t == "FUNCTION":
            texts = cm.get("texts", []) or []
            func = " ".join(x.get("value", "") for x in texts).strip() or func
            for x in texts:
                for ev in x.get("evidences", []) or []:
                    if ev.get("source") == "PubMed" and ev.get("id"):
                        funcRefs.append(ev["id"])
        elif t == "COFACTOR":
            names = [c.get("name") for c in cm.get("cofactors", []) or [] if c.get("name")]
            if names:
                cofactor = ", ".join(names)
        elif t == "SUBUNIT":
            subunit = [x.get("value") for x in cm.get("texts", []) or [] if x.get("value")]
    go = {"MF": [], "BP": [], "CC": []}
    for xr in j.get("uniProtKBCrossReferences", []) or []:
        if xr.get("database") != "GO":
            continue
        term = None
        for p in xr.get("properties", []) or []:
            if p.get("key") == "GoTerm":
                term = p.get("value")
        if not term or ":" not in term:
            continue
        cat, name = term.split(":", 1)
        key = {"F": "MF", "P": "BP", "C": "CC"}.get(cat)
        if key and len(go[key]) < 8 and name not in go[key]:
            go[key].append(name)
    return {"func": func, "funcRefs": sorted(set(funcRefs))[:12],
            "cofactor": cofactor, "subunit": subunit, "go": go}

# ---------------------------------------------------------------- Reactome ----
def reactome(acc, umbrellas):
    j = C.get_json("%s/data/mapping/UniProt/%s/pathways?species=9606" % (REACTOME, acc),
                   fail_fast=True, timeout=30, limiter=C.POLITE)
    if not j:
        return None
    out = []
    for p in j:
        nm = p.get("displayName")
        if not nm or nm in umbrellas:
            continue
        out.append({"n": nm, "id": p.get("stId")})
        if len(out) >= 15:
            break
    return out

def top_umbrellas():
    j = C.get_json("%s/data/pathways/top/9606" % REACTOME, limiter=C.POLITE) or []
    return {p.get("displayName") for p in j if p.get("displayName")}

# ---------------------------------------------------------------- HPO ----------
def hpo(entrez):
    j = C.get_json("%s/NCBIGene:%s" % (HPO, entrez), limiter=C.POLITE, timeout=45)
    if not j:
        return None
    ph = j.get("phenotypes") or []
    return {"phenotypes": [p.get("name") for p in ph[:15] if p.get("name")],
            "phenoCount": len(ph)}

# ---------------------------------------------------------------- ClinVar ------
def clinvar(sym):
    def cnt(term):
        j = C.get_json("%s?db=clinvar&term=%s&retmode=json" % (EUTILS, C.urllib.parse.quote(term)),
                       limiter=C.NCBI, timeout=45, tries=5, backoff=1.5)
        try:
            return int(j["esearchresult"]["count"])
        except (TypeError, KeyError, ValueError):
            return None
    total = cnt("%s[gene]" % sym)
    plp = cnt("%s[gene] AND %s" % (sym, CV_PLP))
    vus = cnt("%s[gene] AND %s" % (sym, CV_VUS))
    if total is None:
        return None
    if plp is not None and plp > total: plp = total
    if vus is not None and vus > total: vus = total
    return {"plp": plp, "vus": vus, "total": total}

# ---------------------------------------------------------------- run ----------
def run():
    work = C.load_work()
    gs = genes(work)
    umbrellas = top_umbrellas()
    C.log("  Reactome umbrellas to exclude: %d" % len(umbrellas))

    # each signal is applied + saved immediately, so a kill can't wipe the whole
    # step (HTTP responses are cached, so re-running is cheap).
    C.log("  UniProt for %d genes ..." % len(gs))
    def up_job(item):
        k, key, d = item
        acc = d.get("uniprot") or (C.SEED[key]["uniprot"] if k == "hub" else None)
        return (key, uniprot(acc)) if acc else (key, None)
    for key, u in C.pmap(up_job, gs, workers=6, label="uniprot"):
        if not u: continue
        d = _dst(work, key)
        if u["func"]: d["func"] = u["func"]
        if u["funcRefs"]: d["funcRefs"] = u["funcRefs"]
        if u["go"] and any(u["go"].values()): d["go"] = u["go"]
        if key in C.HUBS:
            if u["cofactor"]: d["cofactor"] = u["cofactor"]
            if u["subunit"]: d["subunit"] = u["subunit"]
            if u["func"]: d["uniprotFunc"] = u["func"]
    C.save_work(work); C.log("  uniprot saved")

    C.log("  Reactome for %d genes ..." % len(gs))
    def rc_job(item):
        k, key, d = item
        acc = d.get("uniprot") or (C.SEED[key]["uniprot"] if k == "hub" else None)
        return (key, reactome(acc, umbrellas)) if acc else (key, None)
    for key, r in C.pmap(rc_job, gs, workers=5, label="reactome"):
        if r is None: continue
        d = _dst(work, key); d["pathways"] = r
        if key in C.HUBS: d["reactome"] = r
    C.save_work(work); C.log("  reactome saved")

    C.log("  HPO for %d genes ..." % len(gs))
    def hp_job(item):
        k, key, d = item
        ent = d.get("entrez") or (C.SEED[key]["entrez"] if k == "hub" else None)
        return (key, hpo(ent)) if ent else (key, None)
    for key, hh in C.pmap(hp_job, gs, workers=6, label="hpo"):
        if not hh: continue
        d = _dst(work, key); d["phenotypes"] = hh["phenotypes"]; d["phenoCount"] = hh["phenoCount"]
    C.save_work(work); C.log("  hpo saved")

    C.log("  ClinVar for %d genes (NCBI rate-limited) ..." % len(gs))
    def cv_job(item):
        return (item[1], clinvar(item[1]))
    for key, c in C.pmap(cv_job, gs, workers=2, label="clinvar"):
        if c: _dst(work, key)["clinvar"] = c
    C.save_work(work)
    C.emit_app_data(work)
    C.log("annotate done.")

def _dst(work, key):
    return work["hubs"][key] if key in C.HUBS else work["nodesBySym"][key]

if __name__ == "__main__":
    run()
