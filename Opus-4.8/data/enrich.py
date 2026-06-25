"""
enrich — Open Targets v4 (GraphQL) per gene: disease associations (top-20),
EFO therapeutic-area aggregation (`areas` = sum of association score per
therapeuticAreas entry, labels verbatim), tractability, and function text.

Fetched per Ensembl gene (once per gene, hub-independent). Membership is NOT
decided here — only the raw `areas` map and `dis` list are stored.
"""

import common as C

OT_GQL = "https://api.platform.opentargets.org/api/v4/graphql"

QUERY = """
query Target($ensg: String!) {
  target(ensemblId: $ensg) {
    id
    approvedSymbol
    functionDescriptions
    tractability { label modality value }
    associatedDiseases(page: { index: 0, size: 20 }) {
      count
      rows {
        score
        disease { id name therapeuticAreas { id name } }
      }
    }
  }
}
""".strip()


def query_target(ensg):
    return C.fetch(OT_GQL, data={"query": QUERY, "variables": {"ensg": ensg}},
                   headers={"Content-Type": "application/json"}, sleep=0.15)


def parse_target(res):
    """-> dict(dis, areas, tract, func, diseaseCount) or None."""
    tgt = (((res or {}).get("data") or {}).get("target")) if isinstance(res, dict) else None
    if not tgt:
        return None
    out = {}
    fds = tgt.get("functionDescriptions") or []
    if fds:
        out["func"] = C.clean_func(" ".join(fds[:2]))
    tract = []
    for t in tgt.get("tractability") or []:
        if t.get("value"):
            label = t.get("label")
            if label and label not in tract:
                tract.append(label)
    if tract:
        out["tract"] = tract
    assoc = tgt.get("associatedDiseases") or {}
    rows = assoc.get("rows") or []
    dis = []
    areas = {}
    for r in rows:
        sc = C.num(r.get("score"))
        d = r.get("disease") or {}
        nm = d.get("name")
        if nm:
            dis.append({"n": nm, "s": round(sc, 4)})
        for ta in d.get("therapeuticAreas") or []:
            label = ta.get("name")
            if label:
                areas[label] = areas.get(label, 0.0) + sc
    if dis:
        out["dis"] = dis
    if areas:
        out["areas"] = {k: round(v, 4) for k, v in areas.items()}
    out["diseaseCount"] = assoc.get("count", len(dis))
    return out


def apply_to(target_dict, ensg):
    res = query_target(ensg)
    parsed = parse_target(res)
    if not parsed:
        return False
    for k in ("func", "tract", "dis", "areas"):
        if k in parsed:
            target_dict[k] = parsed[k]
    if "diseaseCount" in parsed:
        target_dict["diseaseCount"] = parsed["diseaseCount"]
    return True


def run():
    work = C.load_work()

    # the two hubs
    for H in C.HUBS:
        block = work["hubs"].get(H)
        if block and block.get("ids", {}).get("ensembl"):
            ok = apply_to(block, block["ids"]["ensembl"])
            C.log("  hub %s OT: %s" % (H, "ok" if ok else "no target"))

    # every union gene
    genes = work["genes"]
    n = len(genes)
    done = 0
    for sym, g in genes.items():
        done += 1
        ensg = g.get("ensembl")
        if not ensg:
            continue
        if apply_to(g, ensg):
            pass
        if done % 50 == 0:
            C.log("  OT enrich %d/%d" % (done, n))
            C.save_work(work)

    C.emit_appdata(work)
    C.save_work(work)
    C.log("enrich done (%d genes)" % n)


if __name__ == "__main__":
    run()
