"""
evidence — two signals:
  * IntAct curated interactions per hub (human–human only): type (incl. direct
    interaction), detection method, PMID, MI-score, attached to each partner node.
  * Europe PMC co-mention tiers per hub × gene: comention1/comention2 =
    {title, abs, all}; lit1/lit2 = the full-text ('all') count. The query builder
    is byte-identical to the app's so the in-app links reproduce these counts.
"""

import common as C

INTACT_WS = "https://www.ebi.ac.uk/intact/ws/interaction/findInteractions/"

TYPE_RANK = {
    "direct interaction": 4,
    "physical association": 3,
    "association": 2,
    "colocalization": 1,
}


def _better_type(a, b):
    return a if TYPE_RANK.get((a or "").lower(), 0) >= TYPE_RANK.get((b or "").lower(), 0) else b


def intact_for_hub(H):
    """-> {partner_sym_upper: {type,direct,miscore,methods,pmids,count}}"""
    out = {}
    for page in range(0, 6):
        url = (INTACT_WS + H + "?"
               + C.urllib.parse.urlencode({"page": str(page), "pageSize": "200"}))
        res = C.fetch(url, sleep=0.1)
        content = res.get("content") if isinstance(res, dict) else (res if isinstance(res, list) else None)
        if not content:
            break
        for it in content:
            ta = str(it.get("taxIdA") or it.get("taxonIdA") or "")
            tb = str(it.get("taxIdB") or it.get("taxonIdB") or "")
            if ("9606" not in ta) or ("9606" not in tb):
                continue
            ma = (it.get("moleculeA") or "").strip()
            mb = (it.get("moleculeB") or "").strip()
            partner = mb if ma.upper() == H.upper() else (ma if mb.upper() == H.upper() else None)
            if not partner or partner.upper() == H.upper():
                continue
            key = partner.upper()
            typ = it.get("type") or ""
            ev = out.setdefault(key, {"type": "", "direct": False, "miscore": 0.0,
                                      "methods": [], "pmids": [], "count": 0})
            ev["count"] += 1
            ev["type"] = _better_type(ev["type"], typ)
            if "direct" in typ.lower():
                ev["direct"] = True
            ev["miscore"] = max(ev["miscore"], C.num(it.get("intactMiscore")))
            meth = it.get("detectionMethod")
            if meth and meth not in ev["methods"] and len(ev["methods"]) < 4:
                ev["methods"].append(meth)
            pmid = it.get("publicationPubmedIdentifier")
            if pmid and str(pmid) not in ev["pmids"] and len(ev["pmids"]) < 6:
                ev["pmids"].append(str(pmid))
        if len(content) < 200:
            break
    return out


def hitcount(query):
    url = C.epmc_search_url(query, page_size=1)
    res = C.fetch(url, sleep=0.1)
    if isinstance(res, dict) and "hitCount" in res:
        return int(res["hitCount"])
    return None


def _monotonic(out):
    t, a, al = out["title"], out["abs"], out["all"]
    if None not in (t, a):
        out["abs"] = max(a, t)
    if None not in (out["abs"], al):
        out["all"] = max(al, out["abs"])
    return out


def comention_tiers(hub_terms, gene_terms):
    out = {}
    for tier in ("title", "abs", "all"):
        out[tier] = hitcount(C.comention_query(hub_terms, gene_terms, tier))
    return _monotonic(out)


def both_tiers(gene_terms):
    """Co-mention with BOTH hubs together (shared-gene literature), tiered."""
    out = {}
    for tier in ("title", "abs", "all"):
        out[tier] = hitcount(C.comention_query_both(gene_terms, tier))
    return _monotonic(out)


def run():
    work = C.load_work()
    genes = work["genes"]

    # IntAct per hub -> attach to partner nodes
    attached = 0
    for H in C.HUBS:
        ev_map = intact_for_hub(H)
        C.log("  IntAct %s: %d partners with curated interactions" % (H, len(ev_map)))
        for sym, g in genes.items():
            ev = ev_map.get(sym.upper())
            if not ev:
                continue
            prev = g.get("intact")
            if prev:  # merge across hubs (keep best)
                ev = {
                    "type": _better_type(prev.get("type"), ev["type"]),
                    "direct": bool(prev.get("direct")) or ev["direct"],
                    "miscore": max(C.num(prev.get("miscore")), ev["miscore"]),
                    "methods": (prev.get("methods") or [])[:],
                    "pmids": (prev.get("pmids") or [])[:],
                    "count": int(prev.get("count") or 0) + ev["count"],
                }
                for m in ev_map[sym.upper()]["methods"]:
                    if m not in ev["methods"] and len(ev["methods"]) < 4:
                        ev["methods"].append(m)
                for p in ev_map[sym.upper()]["pmids"]:
                    if p not in ev["pmids"] and len(ev["pmids"]) < 6:
                        ev["pmids"].append(p)
            ev["miscore"] = round(ev["miscore"], 3)
            g["intact"] = ev
            attached += 1
    C.log("  attached IntAct evidence to %d node-records" % attached)

    # Europe PMC co-mention tiers per hub the gene neighbours
    done = 0
    for sym, g in genes.items():
        done += 1
        gene_terms = [sym] + (g.get("syn") or [])
        for hi, H in enumerate(C.HUBS, start=1):
            if g.get("s%d" % hi) is None:
                continue
            tiers = comention_tiers(C.HUB_SYNONYMS[H], gene_terms)
            g["comention%d" % hi] = tiers
            g["lit%d" % hi] = tiers.get("all")
        # both-hub co-mention for SHARED genes (the gene appears with both paralogs)
        if g.get("s1") is not None and g.get("s2") is not None:
            b = both_tiers(gene_terms)
            g["comentionB"] = b
            g["litB"] = b.get("all")
        if done % 30 == 0:
            C.log("  co-mention %d/%d" % (done, len(genes)))
            C.save_work(work)

    # hub-level total literature
    for H in C.HUBS:
        block = work["hubs"].get(H)
        if block:
            q = "(" + " OR ".join('"%s"' % t for t in C.HUB_SYNONYMS[H]) + ")"
            block["litTotal"] = hitcount(q)

    C.emit_appdata(work)
    C.save_work(work)
    C.log("evidence done")


if __name__ == "__main__":
    run()
