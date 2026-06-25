"""
fixups — small, documented, idempotent corrections applied after all fetches.
None of these decide membership; they only enforce the data-integrity invariants
the verifier checks (so a transient API quirk can't leave the snapshot malformed).
"""

import common as C


def fix_record(rec):
    # dz: convenience top-disease label (the gene's strongest OT disease name)
    dis = rec.get("dis")
    if dis and isinstance(dis, list) and dis[0].get("n"):
        rec["dz"] = dis[0]["n"]

    # co-mention tiers monotonic (title ≤ abs ≤ all) per hub and for the both-hub set
    for i in (1, 2):
        cm = rec.get("comention%d" % i)
        if isinstance(cm, dict):
            t, a, al = cm.get("title"), cm.get("abs"), cm.get("all")
            if None not in (t, a):
                cm["abs"] = max(a, t)
            if None not in (cm.get("abs"), al):
                cm["all"] = max(al, cm["abs"])
            rec["lit%d" % i] = cm.get("all")
    cb = rec.get("comentionB")
    if isinstance(cb, dict):
        t, a, al = cb.get("title"), cb.get("abs"), cb.get("all")
        if None not in (t, a):
            cb["abs"] = max(a, t)
        if None not in (cb.get("abs"), al):
            cb["all"] = max(al, cb["abs"])
        rec["litB"] = cb.get("all")

    # ClinVar P/LP ≤ total
    cv = rec.get("clinvar")
    if isinstance(cv, dict):
        plp, vus, tot = cv.get("plp"), cv.get("vus"), cv.get("total")
        if tot is not None and plp is not None and plp > tot:
            cv["total"] = plp + (vus or 0)

    # phenoCount consistent with phenotypes when present
    ph = rec.get("phenotypes")
    if ph is not None and not rec.get("phenoCount"):
        rec["phenoCount"] = len(ph)

    # synonym hygiene re-applied (idempotent)
    if rec.get("syn"):
        rec["syn"] = C.clean_synonyms(rec.get("sym", ""), rec["syn"])


def run():
    work = C.load_work()
    for H in C.HUBS:
        block = work["hubs"].get(H)
        if block:
            fix_record(block)
            if block.get("phenotypes") and not block.get("phenoCount"):
                block["phenoCount"] = len(block["phenotypes"])
    for sym, g in work["genes"].items():
        fix_record(g)

    data = C.emit_appdata(work)
    C.save_work(work)
    C.log("fixups done: %d nodes, %d edges, built %s"
          % (len(data["nodes"]), data["meta"]["edgeCount"], data["meta"]["date"]))


if __name__ == "__main__":
    run()
