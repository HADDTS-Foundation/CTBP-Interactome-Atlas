"""
enrich  -  step 2.

Open Targets v4 GraphQL, per gene (partners + both hubs):
  - associatedDiseases (top 20)         -> dis:[{n,s}]  and  diseaseCount
  - therapeuticAreas score aggregation  -> areas:{ "<EFO area>": summed-score }
  - tractability                        -> tract:[...]
  - functionDescriptions                -> func (fallback; UniProt refines in annotate)

The engine keys area membership off the EFO `therapeuticAreas` labels VERBATIM, so
we store them exactly as Open Targets returns them and log the full label set.
"""
import common as C

OT = "https://api.platform.opentargets.org/api/v4/graphql"

QUERY = """
query T($id: String!) {
  target(ensemblId: $id) {
    approvedSymbol
    functionDescriptions
    tractability { label modality value }
    associatedDiseases(page: {index: 0, size: 20}) {
      count
      rows { score disease { id name therapeuticAreas { name } } }
    }
  }
}"""

def fetch_ot(ensembl):
    j = C.post_json(OT, {"query": QUERY, "variables": {"id": ensembl}},
                    limiter=C.POLITE, timeout=60)
    if not j or not j.get("data") or not j["data"].get("target"):
        return None
    return j["data"]["target"]

def parse(target):
    ad = target.get("associatedDiseases") or {}
    rows = ad.get("rows") or []
    dis, areas = [], {}
    for r in rows:
        d = r.get("disease") or {}
        sc = r.get("score") or 0
        dis.append({"n": d.get("name"), "s": round(sc, 4)})
        for ta in (d.get("therapeuticAreas") or []):
            nm = ta.get("name")
            if nm:
                areas[nm] = round(areas.get(nm, 0) + sc, 4)
    tract = []
    for t in (target.get("tractability") or []):
        if t.get("value"):
            tract.append({"m": t.get("modality"), "l": t.get("label")})
    fds = target.get("functionDescriptions") or []
    func = fds[0] if fds else None
    return {"dis": dis, "areas": areas, "tract": tract,
            "diseaseCount": ad.get("count"), "func": func}

def run():
    work = C.load_work()
    targets = []                              # (kind, key, ensembl)
    for h in C.HUBS:
        targets.append(("hub", h, C.SEED[h]["ensembl"]))
    for sym, nd in work["nodesBySym"].items():
        if nd.get("ensembl"):
            targets.append(("node", sym, nd["ensembl"]))
    C.log("  Open Targets for %d genes ..." % len(targets))

    def job(t):
        kind, key, ens = t
        tg = fetch_ot(ens)
        return (kind, key, parse(tg) if tg else None)

    results = C.pmap(job, targets, workers=6, label="OT")
    all_areas = {}
    filled = 0
    for r in results:
        if not r:
            continue
        kind, key, p = r
        if not p:
            continue
        filled += 1
        for a, s in p["areas"].items():
            all_areas[a] = all_areas.get(a, 0) + 1
        dst = work["hubs"][key] if kind == "hub" else work["nodesBySym"][key]
        if p["dis"]: dst["dis"] = p["dis"]
        if p["areas"]: dst["areas"] = p["areas"]
        if p["tract"]: dst["tract"] = p["tract"]
        if p["diseaseCount"] is not None: dst["diseaseCount"] = p["diseaseCount"]
        if p["func"] and not dst.get("func"): dst["func"] = p["func"]

    work.setdefault("scratch", {})["areaLabels"] = dict(
        sorted(all_areas.items(), key=lambda kv: -kv[1]))
    C.log("  filled OT for %d / %d genes" % (filled, len(targets)))
    C.log("  distinct therapeuticAreas labels (label: #genes):")
    for a, n in sorted(all_areas.items(), key=lambda kv: -kv[1]):
        C.log("      %3d  %s" % (n, a))
    C.save_work(work)
    C.log("enrich done.")

if __name__ == "__main__":
    run()
