"""
fetch_core — for each hub: STRING v12 top-250 neighbours (8 channels) + the
CTBP1↔CTBP2 hub edge; resolve every partner to Ensembl + Entrez + UniProt
(MyGene / NCBI), dropping unresolvable so each hub holds ≤250.

Symmetric in the two hubs (HUBS list); the only fixed tokens are the hub seeds.
Idempotent: re-running overwrites the same per-gene/per-hub records.
"""

import common as C

STRING_API = "https://string-db.org/api"
CALLER = "haddts_ctbp_atlas"
TOPN = 250


def string_id(sym):
    url = (STRING_API + "/json/get_string_ids?"
           + C.urllib.parse.urlencode({"identifiers": sym, "species": "9606",
                                       "limit": "1", "caller_identity": CALLER}))
    res = C.fetch(url)
    if isinstance(res, list) and res:
        return res[0].get("stringId"), res[0].get("preferredName", sym)
    return None, sym


def channels(rec):
    """Map a STRING partner record's channel columns to our compact keys."""
    s = {}
    for col, key in C.STRING_CHANNEL_MAP.items():
        if col in rec and rec[col] is not None:
            s[key] = round(C.num(rec[col]), 3)
    if "c" not in s:                       # combined is mandatory
        s["c"] = round(C.num(rec.get("score")), 3)
    return s


def partners(strid):
    url = (STRING_API + "/json/interaction_partners?"
           + C.urllib.parse.urlencode({"identifiers": strid, "species": "9606",
                                       "limit": str(TOPN), "caller_identity": CALLER}))
    res = C.fetch(url)
    return res if isinstance(res, list) else []


def _first(v):
    if isinstance(v, list):
        return v[0] if v else None
    return v


def mygene_resolve(sym):
    """Resolve a symbol to {name,ensembl,entrez,uniprot,mim,aliases}. None on failure."""
    url = ("https://mygene.info/v3/query?"
           + C.urllib.parse.urlencode({
               "q": 'symbol:%s' % sym, "species": "human", "size": "1",
               "fields": "symbol,name,entrezgene,ensembl.gene,uniprot,alias,MIM"}))
    res = C.fetch(url)
    hits = (res or {}).get("hits") if isinstance(res, dict) else None
    if not hits:
        # fall back to a looser query (handles HGNC renames / alias hits)
        url2 = ("https://mygene.info/v3/query?"
                + C.urllib.parse.urlencode({
                    "q": sym, "species": "human", "size": "1",
                    "fields": "symbol,name,entrezgene,ensembl.gene,uniprot,alias,MIM"}))
        res = C.fetch(url2)
        hits = (res or {}).get("hits") if isinstance(res, dict) else None
    if not hits:
        return None
    h = hits[0]
    ens = h.get("ensembl")
    if isinstance(ens, list):
        ens = _first(ens)
    ensembl = (ens or {}).get("gene") if isinstance(ens, dict) else None
    uni = h.get("uniprot") or {}
    uniprot = _first(uni.get("Swiss-Prot")) or _first(uni.get("TrEMBL"))
    entrez = h.get("entrezgene")
    return {
        "name": h.get("name"),
        "ensembl": ensembl,
        "entrez": str(entrez) if entrez is not None else None,
        "uniprot": uniprot,
        "mim": str(h.get("MIM")) if h.get("MIM") else None,
        "aliases": h.get("alias") if isinstance(h.get("alias"), list)
        else ([h["alias"]] if h.get("alias") else []),
        "symbol": h.get("symbol", sym),
    }


def run():
    work = C.load_work()

    # hub blocks + STRING ids for the two hubs
    hub_strid = {}
    for H in C.HUBS:
        strid, pref = string_id(H)
        hub_strid[H] = strid
        block = work["hubs"].get(H, {})
        block["sym"] = H
        block["name"] = C.HUB_NAME[H]
        ids = dict(C.HUB_IDS[H])
        ids["string"] = strid
        block["ids"] = ids
        block.setdefault("syn", C.HUB_SYNONYMS[H][:])
        work["hubs"][H] = block
        C.log("  hub %s -> STRING %s" % (H, strid))

    # neighbours per hub
    for hi, H in enumerate(C.HUBS, start=1):
        strid = hub_strid[H]
        if not strid:
            C.log("  ! no STRING id for %s — skipping its neighbourhood" % H)
            continue
        recs = partners(strid)
        C.log("  %s: STRING returned %d partners" % (H, len(recs)))
        rank = 0
        kept = 0
        for rec in recs:
            sym = rec.get("preferredName_B") or rec.get("preferredName_A")
            if not sym or sym in C.HUBS:
                # the other hub is captured as the hubEdge, not as a node
                if sym in C.HUBS and sym != H:
                    work["hubEdge"] = {"s": channels(rec)}
                continue
            ids = mygene_resolve(sym)
            if not ids or not ids.get("ensembl") or not ids.get("entrez"):
                continue  # drop unresolvable (keeps each hub ≤250 resolved)
            if not C.re.match(r"^ENSG\d+$", ids["ensembl"] or ""):
                continue
            rank += 1
            kept += 1
            g = C.gene(work, sym)
            g["sym"] = sym
            g.setdefault("name", ids.get("name"))
            g["ensembl"] = ids["ensembl"]
            g["entrez"] = ids["entrez"]
            g.setdefault("uniprot", ids.get("uniprot"))
            if ids.get("mim"):
                g.setdefault("mim", ids["mim"])
            if not g.get("syn"):
                g["syn"] = C.clean_synonyms(sym, ids.get("aliases"))
            g["s%d" % hi] = channels(rec)
            g["rank%d" % hi] = rank
        C.log("  %s: kept %d resolved neighbours" % (H, kept))

    # hub-block ids may also want the resolved uniprot already in HUB_IDS (kept)
    C.emit_appdata(work)
    C.save_work(work)
    C.log("fetch_core done: %d union genes so far" % len(work["genes"]))


if __name__ == "__main__":
    run()
