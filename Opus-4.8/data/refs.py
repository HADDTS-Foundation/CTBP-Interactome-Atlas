"""
refs — Europe PMC citation-ranked co-mention papers per gene (node.refs), the
hubs' own top-cited reading lists (hubs.<HUB>.refs), and the curated, ortholog-
aware aging/longevity reading lists (hubs.<HUB>.agingRefs).

References are synonym-aware and citation-ranked (prefer title/abstract, fall
back to full text), not a bare strict-symbol query (§8). The CTBP1 aging list is
ortholog-aware (CtBP1 / CTBP-1 / ctbp-1) and includes the landmark C. elegans
ctbp-1 life-span paper (PMID 19164523) per the data prompt's curation directive.
"""

import common as C

LANDMARK_PMID = "19164523"   # Chen et al. 2009, C. elegans ctbp-1 life span
AGING_TERMS = ('("longevity" OR "life span" OR "lifespan" OR "ageing" OR '
               '"aging" OR "senescence" OR "age-related")')


def _paper(r):
    pmid = r.get("pmid") or (r.get("id") if r.get("source") == "MED" else None)
    if not pmid:
        return None
    jt = r.get("journalTitle")
    if not jt:
        ji = r.get("journalInfo") or {}
        jt = (ji.get("journal") or {}).get("title")
    auth = r.get("authorString") or ""
    return {
        "pmid": str(pmid),
        "t": (r.get("title") or "").rstrip(". "),
        "a": auth[:80] + ("…" if len(auth) > 80 else ""),
        "y": r.get("pubYear"),
        "j": jt,
        "c": int(r.get("citedByCount") or 0),
    }


def search_papers(query, size=8, sort="CITED desc"):
    url = C.epmc_search_url(query, page_size=size, result_type="core", sort=sort)
    res = C.fetch(url, sleep=0.12)
    rows = (((res or {}).get("resultList") or {}).get("result")) if isinstance(res, dict) else None
    out = []
    for r in rows or []:
        p = _paper(r)
        if p:
            out.append(p)
    return out


def paper_by_pmid(pmid):
    res = search_papers('ext_id:%s AND src:med' % pmid, size=1, sort=None)
    return res[0] if res else None


def gene_refs(g):
    hub_terms = C.HUB_SYNONYMS["CTBP1"] + C.HUB_SYNONYMS["CTBP2"]
    gene_terms = [g["sym"]] + (g.get("syn") or [])
    # prefer title+abstract co-mention, fall back to full text
    q = C.comention_query(hub_terms, gene_terms, "abs")
    papers = search_papers(q, size=8)
    if len(papers) < 3:
        q2 = C.comention_query(hub_terms, gene_terms, "all")
        more = search_papers(q2, size=8)
        seen = {p["pmid"] for p in papers}
        for p in more:
            if p["pmid"] not in seen:
                papers.append(p)
                seen.add(p["pmid"])
    return papers[:8]


def run():
    work = C.load_work()

    # per-gene co-mention references
    genes = work["genes"]
    done = 0
    for sym, g in genes.items():
        done += 1
        try:
            refs = gene_refs(g)
            if refs:
                g["refs"] = refs
        except Exception as e:
            C.log("    refs soft-fail %s: %s" % (sym, type(e).__name__))
        if done % 40 == 0:
            C.log("  gene refs %d/%d" % (done, len(genes)))
            C.save_work(work)

    # hub-level reading lists
    for H in C.HUBS:
        block = work["hubs"].get(H)
        if not block:
            continue
        hub_terms = C.HUB_SYNONYMS[H]
        # the hub's own most-cited papers
        block["refs"] = search_papers(
            "(" + " OR ".join('"%s"' % t for t in hub_terms) + ")", size=8)
        # ortholog-aware aging/longevity reading list
        ortho = C.HUB_ORTHO_TERMS[H][0]
        aging = search_papers("(%s) AND %s" % (ortho, AGING_TERMS), size=10)
        if H == "CTBP1":
            have = {p["pmid"] for p in aging}
            if LANDMARK_PMID not in have:
                lm = paper_by_pmid(LANDMARK_PMID)
                if lm:
                    aging.insert(0, lm)
                else:
                    # ensure the landmark is present even if EPMC is unreachable
                    aging.insert(0, {
                        "pmid": LANDMARK_PMID,
                        "t": ("The conserved NAD(H)-dependent corepressor CTBP-1 "
                              "regulates Caenorhabditis elegans life span"),
                        "a": "Chen S, Whetstine JR, Ghosh S, et al.",
                        "y": "2009", "j": "Proc Natl Acad Sci U S A", "c": 0})
        block["agingRefs"] = aging
        C.log("  hub %s: %d refs, %d agingRefs" % (H, len(block["refs"]), len(aging)))

    C.emit_appdata(work)
    C.save_work(work)
    C.log("refs done")


if __name__ == "__main__":
    run()
