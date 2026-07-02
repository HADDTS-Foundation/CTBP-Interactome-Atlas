"""
fix_ups  -  step 12.

Small, documented, idempotent corrections + final metadata:
  - ensure lit1/lit2/litB mirror comention{1,2,B}.all
  - assemble meta.sources (every public source, each with a base URL + the pinned
    BioGRID release) for the app's provenance strip
  - final consistency clamps (clinvar plp<=total; syn blocklist re-applied)
"""
import common as C

def sources(work):
    rel = work.get("meta", {}).get("biogridRelease", C.BIOGRID_RELEASE)
    return [
        {"name": "STRING v12", "url": "https://string-db.org"},
        {"name": "Open Targets", "url": "https://platform.opentargets.org"},
        {"name": "IntAct", "url": "https://www.ebi.ac.uk/intact"},
        {"name": "Europe PMC", "url": "https://europepmc.org"},
        {"name": "UniProt", "url": "https://www.uniprot.org"},
        {"name": "NCBI ClinVar", "url": "https://www.ncbi.nlm.nih.gov/clinvar"},
        {"name": "HPO", "url": "https://hpo.jax.org"},
        {"name": "Reactome", "url": "https://reactome.org"},
        {"name": "GenAge (HAGR)", "url": "https://genomics.senescence.info/genes"},
        {"name": "LongevityMap (HAGR)", "url": "https://genomics.senescence.info/longevity"},
        {"name": "BioGRID %s" % rel, "url": "https://thebiogrid.org"},
        {"name": "MyGene.info", "url": "https://mygene.info"},
    ]

def run():
    work = C.load_work()
    for nd in work["nodesBySym"].values():
        for gk, field in (("1", "comention1"), ("2", "comention2"), ("B", "comentionB")):
            cm = nd.get(field) or {}
            nd["lit" + gk if gk != "B" else "litB"] = cm.get("all")
        # re-apply the ambiguous-homograph blocklist defensively
        if nd.get("syn"):
            nd["syn"] = [s for s in nd["syn"] if s.upper() not in C.SYN_BLOCKLIST]
        cv = nd.get("clinvar")
        if cv and cv.get("plp") is not None and cv.get("total") is not None and cv["plp"] > cv["total"]:
            cv["plp"] = cv["total"]
    work.setdefault("meta", {})["sources"] = sources(work)
    C.save_work(work)
    C.emit_app_data(work)
    C.log("fix_ups done.")

if __name__ == "__main__":
    run()
