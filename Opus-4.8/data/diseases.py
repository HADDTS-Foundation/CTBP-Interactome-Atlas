"""
diseases — deepen node.dis (top-20 OT disease names + scores) so the disease-name
fields are complete. enrich already fetches the top-20; this step gap-fills any
gene still missing `dis`/`areas` (e.g. a transient OT failure) and makes sure
both hub blocks carry their disease list. Idempotent (cached OT responses).
"""

import common as C
from enrich import apply_to


def run():
    work = C.load_work()

    filled = 0
    genes = work["genes"]
    for sym, g in genes.items():
        if g.get("dis") and g.get("areas") is not None:
            continue
        ensg = g.get("ensembl")
        if ensg and apply_to(g, ensg):
            filled += 1
    C.log("  gap-filled OT for %d genes" % filled)

    for H in C.HUBS:
        block = work["hubs"].get(H)
        if block and not block.get("dis"):
            ensg = block.get("ids", {}).get("ensembl")
            if ensg:
                apply_to(block, ensg)

    C.emit_appdata(work)
    C.save_work(work)
    C.log("diseases done")


if __name__ == "__main__":
    run()
