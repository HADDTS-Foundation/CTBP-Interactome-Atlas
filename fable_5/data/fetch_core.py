"""
fetch_core  -  step 1.

For EACH hub (symmetric): STRING top-250 interaction partners with all 8 channels,
plus the CTBP1<->CTBP2 hub edge. Resolve every partner to Ensembl gene + Entrez +
UniProt (MyGene), dropping unresolvable so each hub holds <= 250 partners.

Writes into the working state: per-node s1/s2, rank1/rank2, hubs attribution and
core IDs; work.hubEdge; work.hubs.<HUB>.ids.
"""
import re
import common as C

STRING = "https://string-db.org/api/json"
MYGENE = "https://mygene.info/v3"

def resolve_hub_string_id(sym):
    j = C.get_json("%s/get_string_ids?identifiers=%s&species=%d" % (STRING, sym, C.SPECIES),
                   limiter=C.POLITE)
    if j:
        return j[0].get("stringId")
    return C.SEED[sym]["string"]

def fetch_partners(string_id):
    url = "%s/interaction_partners?identifiers=%s&species=%d&limit=%d" % (
        STRING, string_id, C.SPECIES, C.TOPN)
    return C.get_json(url, limiter=C.POLITE) or []

def mygene_batch(symbols):
    """symbol -> {ensembl,entrez,uniprot,mim,name}. Batched POST, chunked."""
    out = {}
    fields = "symbol,name,entrezgene,ensembl.gene,uniprot.Swiss-Prot,MIM"
    syms = list(symbols)
    for i in range(0, len(syms), 300):
        chunk = syms[i:i+300]
        res = C.post_form(MYGENE + "/query",
                          {"q": ",".join(chunk), "scopes": "symbol,alias",
                           "fields": fields, "species": "human"},
                          limiter=C.POLITE)
        if not res:
            continue
        for r in res:
            q = r.get("query")
            if not q or r.get("notfound"):
                continue
            ens = _first_ensg(r.get("ensembl"))
            ent = r.get("entrezgene")
            up = _first(r.get("uniprot", {}).get("Swiss-Prot") if isinstance(r.get("uniprot"), dict) else None)
            mim = _first(r.get("MIM"))
            # keep the best (highest _score) hit per symbol
            prev = out.get(q)
            if prev and prev.get("_score", 0) >= r.get("_score", 0):
                continue
            out[q] = {"ensembl": ens, "entrez": str(ent) if ent is not None else None,
                      "uniprot": up, "mim": str(mim) if mim is not None else None,
                      "name": r.get("name"), "_score": r.get("_score", 0)}
    return out

def _first(x):
    if isinstance(x, list):
        return x[0] if x else None
    return x

def _first_ensg(ens):
    if isinstance(ens, list):
        for e in ens:
            g = e.get("gene") if isinstance(e, dict) else None
            if g and re.match(r"^ENSG\d+$", g):
                return g
        return None
    if isinstance(ens, dict):
        g = ens.get("gene")
        return g if (g and re.match(r"^ENSG\d+$", g)) else None
    return None

def run():
    work = C.load_work()
    work.setdefault("hubs", {})
    work.setdefault("nodesBySym", {})
    work.setdefault("scratch", {})

    # 1. resolve hub STRING ids and record per-hub id blocks
    hub_sids = {}
    for h in C.HUBS:
        sid = resolve_hub_string_id(h)
        hub_sids[h] = sid
        hb = work["hubs"].setdefault(h, {"sym": h})
        hb["ids"] = {"ensembl": C.SEED[h]["ensembl"], "entrez": C.SEED[h]["entrez"],
                     "uniprot": C.SEED[h]["uniprot"], "string": sid}
    C.log("  hub STRING ids: " + ", ".join("%s=%s" % (h, hub_sids[h]) for h in C.HUBS))

    # 2. fetch each hub's top-250 partners
    raw = {}
    for h in C.HUBS:
        rows = fetch_partners(hub_sids[h])
        # keep only rows where A is the hub (partner is B), dedupe by partner name
        seen = {}
        for r in rows:
            pa, pb = r.get("preferredName_A"), r.get("preferredName_B")
            partner = pb if pa == h else pa
            if not partner or partner in C.HUBS and partner == h:
                continue
            if partner not in seen:
                seen[partner] = r
        raw[h] = seen
        C.log("  %s: %d STRING partners" % (h, len(seen)))

    # 3. capture the hub edge (CTBP1<->CTBP2)
    he = raw["CTBP1"].get("CTBP2") or raw["CTBP2"].get("CTBP1")
    if he:
        work["hubEdge"] = {"s": C.string_channels(he)}
        C.log("  hub edge CTBP1<->CTBP2 combined=%.3f" % (he.get("score") or 0))

    # 4. resolve all partner symbols (union) via MyGene
    union_syms = set()
    for h in C.HUBS:
        union_syms.update(raw[h].keys())
    union_syms.discard("CTBP1"); union_syms.discard("CTBP2")
    C.log("  resolving %d unique partner symbols via MyGene ..." % len(union_syms))
    ids = mygene_batch(sorted(union_syms))
    resolved = {s: v for s, v in ids.items() if v.get("ensembl") and v.get("entrez")}
    C.log("  resolved %d / %d partners" % (len(resolved), len(union_syms)))
    work["scratch"]["unresolved"] = sorted(set(union_syms) - set(resolved))

    # 5. write nodes with per-hub s/rank/hubs attribution (drop unresolvable)
    for h in C.HUBS:
        skey = "s1" if h == "CTBP1" else "s2"
        rkey = "rank1" if h == "CTBP1" else "rank2"
        # rank by combined score desc among resolvable partners of this hub
        keep = [(sym, r) for sym, r in raw[h].items() if sym in resolved]
        keep.sort(key=lambda kv: -(kv[1].get("score") or 0))
        for rank, (sym, r) in enumerate(keep, start=1):
            nd = C.node(work, sym)
            info = resolved[sym]
            nd["name"] = nd.get("name") or info.get("name") or sym
            nd["ensembl"] = info["ensembl"]; nd["entrez"] = info["entrez"]
            if info.get("uniprot"): nd["uniprot"] = info["uniprot"]
            if info.get("mim"): nd["mim"] = info["mim"]
            nd[skey] = C.string_channels(r)
            nd[rkey] = rank
            hs = set(nd.get("hubs") or []); hs.add(h)
            nd["hubs"] = [x for x in C.HUBS if x in hs]
        C.log("  %s: kept %d resolvable partners" % (h, len(keep)))

    C.save_work(work)
    C.log("fetch_core done.")

if __name__ == "__main__":
    run()
