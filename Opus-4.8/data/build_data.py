"""
build_data — assemble/merge the two neighbourhoods into the shipped snapshot:
union, dedupe by gene, each node's hubs / s1 / s2 / rank1 / rank2 (handled by
common.assemble), finalize the hub blocks, and write meta. Idempotent.

(The union + per-hub attribution + meta is computed by common.assemble(), which
emit_appdata() calls at the end of every step, so app-data.js is always current.
This step makes the hub blocks complete, prunes empties, and reports the counts.)
"""

import common as C


def run():
    work = C.load_work()

    # prune any gene that scores against neither hub (defensive)
    drop = [s for s, g in work["genes"].items()
            if g.get("s1") is None and g.get("s2") is None]
    for s in drop:
        del work["genes"][s]
    if drop:
        C.log("  pruned %d genes with no hub score" % len(drop))

    # ensure both hub blocks are well-formed
    for H in C.HUBS:
        block = work["hubs"].setdefault(H, {})
        block["sym"] = H
        block.setdefault("name", C.HUB_NAME[H])
        ids = block.setdefault("ids", dict(C.HUB_IDS[H]))
        for k, v in C.HUB_IDS[H].items():
            ids.setdefault(k, v)
        block.setdefault("syn", C.HUB_SYNONYMS[H][:])
        block.setdefault("litTotal", None)
        block.setdefault("agingRefs", [])
        block.setdefault("refs", [])
    # CTBP2's RIBEYE note (sourced fact carried in the model)
    if "CTBP2" in work["hubs"]:
        work["hubs"]["CTBP2"].setdefault(
            "note", "CTBP2 also encodes RIBEYE, a retinal ribbon-synapse protein, "
                    "via an alternative promoter.")

    data = C.emit_appdata(work)
    C.save_work(work)

    nb = data["meta"]["neighborhood"]
    cnt = data["meta"]["counts"]
    C.log("build_data done: union=%d (CTBP1=%d, CTBP2=%d) | shared=%d, "
          "CTBP1-only=%d, CTBP2-only=%d | edges=%d"
          % (nb["union"], nb["CTBP1"], nb["CTBP2"], cnt["shared"],
             cnt["CTBP1-only"], cnt["CTBP2-only"], data["meta"]["edgeCount"]))


if __name__ == "__main__":
    run()
