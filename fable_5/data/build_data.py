"""
build_data  -  step 5.

The union/merge is already materialised on the nodes by fetch_core (each node's
hubs / s1 / s2 / rank1 / rank2). This step finalises the two hub BLOCKS (name,
factual RefSeq summary, the CTBP2 RIBEYE note) and emits the merged, minified
snapshot ../app-data.js (the read-side contract). Later steps mutate app-data.js
in place; re-running is idempotent.
"""
import common as C

MYGENE = "https://mygene.info/v3"

def hub_meta(entrez):
    j = C.get_json(MYGENE + "/gene/%s?fields=name,summary,symbol" % entrez, limiter=C.POLITE)
    if not j:
        return None, None
    return j.get("name"), j.get("summary")

def run():
    work = C.load_work()
    for h in C.HUBS:
        hb = work["hubs"].setdefault(h, {"sym": h})
        hb["sym"] = h
        name, summary = hub_meta(C.SEED[h]["entrez"])
        if name: hb["name"] = name
        if summary: hb["summary"] = summary
    # documented biological fact (alt-promoter product of CTBP2)
    work["hubs"]["CTBP2"]["note"] = ("CTBP2 also encodes RIBEYE (retinal ribbon-synapse "
                                     "protein) via an alternative promoter")
    work.setdefault("meta", {})["date"] = _snapshot_date()
    work["meta"]["species"] = C.SPECIES
    C.save_work(work)
    C.emit_app_data(work)
    C.log("build_data done.")

def _snapshot_date():
    # deterministic: use the build machine's date via time (allowed in stdlib)
    import time
    return time.strftime("%Y-%m-%d", time.gmtime())

if __name__ == "__main__":
    run()
