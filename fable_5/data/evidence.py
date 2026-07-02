"""
evidence  -  step 8.

  - Europe PMC co-mention, synonym-aware + tiered (title <= abs <= all), for EVERY
    gene against CTBP1, CTBP2 and BOTH (hub-independent literature):
    comention1 / comention2 / comentionB {title,abs,all}  +  lit1/lit2/litB.
  - IntAct curated interactions per hub (human-human), aggregated per partner into
    node.intact {type,direct,physical,miscore,methods,pmids,count}.
"""
import common as C
import epmc

INTACT = "https://www.ebi.ac.uk/intact/ws/interaction"
GROUPS = {"1": ["CTBP1"], "2": ["CTBP2"], "B": ["CTBP1", "CTBP2"]}
TIERS = ["title", "abs", "all"]

# ---------------------------------------------------------------- co-mention ---
def epmc_count(query):
    j = C.get_json(epmc.url(query, page_size=1), limiter=C.EPMC_LIMIT, tries=4, backoff=1.5)
    return None if j is None else j.get("hitCount")

def comention():
    work = C.load_work()
    tasks = []
    for sym, nd in work["nodesBySym"].items():
        syn = nd.get("syn") or [sym]
        for gk, hubs in GROUPS.items():
            for tier in TIERS:
                tasks.append((sym, gk, tier, epmc.build(syn, hubs, tier)))
    C.log("  Europe PMC co-mention: %d count queries ..." % len(tasks))
    res = C.pmap(lambda t: (t[0], t[1], t[2], epmc_count(t[3])), tasks,
                 workers=4, label="co-mention")
    agg = {}
    for r in res:
        if not r:
            continue
        sym, gk, tier, cnt = r
        agg.setdefault(sym, {}).setdefault(gk, {})[tier] = cnt
    for sym, nd in work["nodesBySym"].items():
        g = agg.get(sym, {})
        for gk, field in (("1", "comention1"), ("2", "comention2"), ("B", "comentionB")):
            tiers = _mono(g.get(gk, {}))
            nd[field] = tiers
        nd["lit1"] = nd["comention1"].get("all")
        nd["lit2"] = nd["comention2"].get("all")
        nd["litB"] = nd["comentionB"].get("all")
    C.save_work(work)
    C.log("  co-mention done.")

def _mono(t):
    """Return {title,abs,all}; broaden outer tiers so title <= abs <= all holds
    (the scopes nest by construction; any inversion is an index artifact)."""
    ti, ab, al = t.get("title"), t.get("abs"), t.get("all")
    if ti is not None and ab is not None and ab < ti: ab = ti
    if ab is not None and al is not None and al < ab: al = ab
    if ti is not None and al is not None and al < ti: al = ti
    return {"title": ti, "abs": ab, "all": al}

# ---------------------------------------------------------------- IntAct -------
PHYSICAL_TYPES = {"direct interaction", "physical association"}

def fetch_hub_intact(hub):
    out, page = [], 0
    while page <= 60:
        j = C.get_json("%s/findInteractions/%s?page=%d&pageSize=200" % (INTACT, hub, page),
                       limiter=C.POLITE, timeout=60)
        if not j:
            break
        content = j.get("content") or []
        out.extend(content)
        total = j.get("totalElements") or 0
        page += 1
        if not content or page * 200 >= total:
            break
    return out

def intact():
    work = C.load_work()
    nodes = work["nodesBySym"]
    per = {}                                   # partner sym -> aggregation
    for hub in C.HUBS:
        rows = fetch_hub_intact(hub)
        C.log("  IntAct %s: %d interactions" % (hub, len(rows)))
        for r in rows:
            if r.get("taxIdA") != C.SPECIES or r.get("taxIdB") != C.SPECIES:
                continue                       # human-human only
            a, b = r.get("moleculeA"), r.get("moleculeB")
            partner = b if a == hub else (a if b == hub else None)
            if not partner or partner == hub or partner not in nodes:
                continue
            d = per.setdefault(partner, {"types": set(), "methods": set(),
                                         "pmids": set(), "miscore": 0.0, "count": 0})
            typ = (r.get("type") or "").lower()
            if typ: d["types"].add(typ)
            m = r.get("detectionMethod")
            if m: d["methods"].add(m)
            pm = r.get("publicationPubmedIdentifier")
            if pm: d["pmids"].add(str(pm))
            try:
                d["miscore"] = max(d["miscore"], float(r.get("intactMiscore") or 0))
            except (TypeError, ValueError):
                pass
            d["count"] += 1
    for sym, d in per.items():
        types = d["types"]
        direct = "direct interaction" in types
        physical = bool(types & PHYSICAL_TYPES)
        rep = ("direct interaction" if direct else
               ("physical association" if "physical association" in types else
                (sorted(types)[0] if types else "association")))
        nodes[sym]["intact"] = {
            "type": rep, "direct": direct, "physical": physical,
            "miscore": round(d["miscore"], 3),
            "methods": sorted(d["methods"])[:8], "pmids": sorted(d["pmids"])[:20],
            "count": d["count"]}
    C.log("  IntAct: annotated %d partners" % len(per))
    C.save_work(work)

def run():
    comention()
    intact()
    work = C.load_work()
    C.emit_app_data(work)
    C.log("evidence done.")

if __name__ == "__main__":
    run()
