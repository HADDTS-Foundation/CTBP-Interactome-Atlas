"""
diseases  -  step 7.

Ensure node.dis (top-20 Open Targets disease names + scores) is complete: trim to
20, and backfill any gene enrich missed by resolving its OT target via symbol
search, then re-running the associations query. Idempotent gap-filler.
"""
import common as C
from enrich import QUERY, fetch_ot, parse

OT = "https://api.platform.opentargets.org/api/v4/graphql"
SEARCH = """query S($q: String!) {
  search(queryString: $q, entityNames: ["target"]) { hits { id entity } } }"""

def ot_target_id(sym):
    j = C.post_json(OT, {"query": SEARCH, "variables": {"q": sym}}, limiter=C.POLITE)
    if not j:
        return None
    for h in (j.get("data", {}).get("search", {}) or {}).get("hits", []) or []:
        if h.get("entity") == "target" and str(h.get("id", "")).startswith("ENSG"):
            return h["id"]
    return None

def run():
    work = C.load_work()
    nodes = work["nodesBySym"]
    missing = [s for s, nd in nodes.items() if not nd.get("dis")]
    C.log("  %d genes missing disease associations; backfilling ..." % len(missing))

    def job(sym):
        tid = ot_target_id(sym)
        if not tid:
            return (sym, None)
        tg = fetch_ot(tid)
        return (sym, parse(tg) if tg else None)

    for r in C.pmap(job, missing, workers=6, label="dz-fill"):
        if not r or not r[1]:
            continue
        sym, p = r
        if p["dis"]: nodes[sym]["dis"] = p["dis"]
        if p["areas"] and not nodes[sym].get("areas"): nodes[sym]["areas"] = p["areas"]
        if p["diseaseCount"] is not None: nodes[sym]["diseaseCount"] = p["diseaseCount"]

    for nd in nodes.values():                   # trim to top-20
        if nd.get("dis"):
            nd["dis"] = nd["dis"][:20]
    still = sum(1 for nd in nodes.values() if not nd.get("dis"))
    C.log("  %d genes still without disease associations (no OT record)" % still)
    C.save_work(work)
    C.emit_app_data(work)
    C.log("diseases done.")

if __name__ == "__main__":
    run()
