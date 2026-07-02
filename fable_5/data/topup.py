"""
topup  -  step 3.

Fill gaps left by fetch_core / enrich and build the synonym lists co-mention needs:
  - node.syn : ordered [primary symbol] + curated aliases, with the ambiguous-
               homograph blocklist applied (so co-mention queries stay precise
               and reproducible). Stored, so the app rebuilds identical queries.
  - backfill node.uniprot where MyGene missed it (needed by UniProt + Reactome).
"""
import re
import common as C

MYGENE = "https://mygene.info/v3"

def curate_syn(sym, aliases):
    """Ordered, deduped synonym list: primary first, then decent aliases."""
    out, seen = [], set()
    def add(a):
        if not a: return
        a = a.strip()
        key = a.upper()
        if not a or key in seen: return
        if key in C.SYN_BLOCKLIST: return
        if key in ("CTBP1", "CTBP2"): return          # never fold a hub into a partner
        if len(a) < 3: return                          # 1-2 char aliases are noise
        if a.isdigit(): return                         # bare numbers are noise
        seen.add(key); out.append(a)
    add(sym)
    for a in aliases or []:
        add(a)
        if len(out) >= 6:                              # cap keeps queries precise
            break
    return out

def fetch_aliases(symbols):
    out = {}
    syms = list(symbols)
    for i in range(0, len(syms), 300):
        chunk = syms[i:i+300]
        res = C.post_form(MYGENE + "/query",
                          {"q": ",".join(chunk), "scopes": "symbol",
                           "fields": "symbol,alias,uniprot.Swiss-Prot", "species": "human"},
                          limiter=C.POLITE)
        if not res:
            continue
        for r in res:
            q = r.get("query")
            if not q or r.get("notfound"):
                continue
            al = r.get("alias")
            if isinstance(al, str):
                al = [al]
            up = r.get("uniprot", {}).get("Swiss-Prot") if isinstance(r.get("uniprot"), dict) else None
            if isinstance(up, list):
                up = up[0] if up else None
            prev = out.get(q, {})
            if r.get("_score", 0) >= prev.get("_score", -1):
                out[q] = {"alias": al or [], "uniprot": up, "_score": r.get("_score", 0)}
    return out

def run():
    work = C.load_work()
    syms = list(work["nodesBySym"].keys())
    C.log("  fetching aliases for %d genes ..." % len(syms))
    info = fetch_aliases(syms)

    # partner nodes
    for sym, nd in work["nodesBySym"].items():
        rec = info.get(sym, {})
        nd["syn"] = curate_syn(sym, rec.get("alias"))
        if not nd.get("uniprot") and rec.get("uniprot"):
            nd["uniprot"] = rec["uniprot"]

    # hubs get a syn list too (primary symbol only; co-mention uses hub group)
    for h in C.HUBS:
        hb = work["hubs"][h]
        hb["syn"] = [h]

    missing_up = [s for s, nd in work["nodesBySym"].items() if not nd.get("uniprot")]
    C.log("  synonyms set; %d nodes still missing UniProt (Reactome/UniProt will skip them)"
          % len(missing_up))
    C.save_work(work)
    C.log("topup done.")

if __name__ == "__main__":
    run()
