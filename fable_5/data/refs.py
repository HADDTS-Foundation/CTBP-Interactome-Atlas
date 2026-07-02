"""
refs  -  step 6.

  - node.refs : citation-ranked co-mention papers for each gene (gene synonyms AND
    (CTBP1 OR CTBP2)); prefer title+abstract, fall back to full text.
  - hubs.<HUB>.litTotal : total literature count for the hub.
  - hubs.<HUB>.agingRefs : the curated, ortholog-aware aging/longevity reading list.
    CTBP1's list is guaranteed to include the landmark C. elegans ctbp-1 life-span
    paper (PMID 19164523).
"""
import common as C
import epmc

# ortholog-aware hub term groups for the aging reading list (case-insensitive)
AGING_HUB_TERMS = {
    "CTBP1": ["CTBP1", "CtBP1", "CTBP-1", "ctbp-1"],
    "CTBP2": ["CTBP2", "CtBP2", "CTBP-2"],
}
AGING_TOPIC = '("life span" OR lifespan OR longevity OR aging OR ageing OR senescence)'
LANDMARK_PMID = "19164523"

def paper(rec):
    return {"pmid": rec.get("pmid") or rec.get("id"),
            "t": rec.get("title"), "a": rec.get("authorString"),
            "y": rec.get("pubYear"), "j": rec.get("journalTitle"),
            "c": rec.get("citedByCount")}

def search(query, n=15, sort_cited=True):
    extra = "&resultType=core" + ("&sort=" + C.urllib.parse.quote("CITED desc") if sort_cited else "")
    j = C.get_json(epmc.url(query, page_size=n, extra=extra), limiter=C.EPMC_LIMIT, tries=4, backoff=1.5, timeout=60)
    if not j:
        return []
    return [paper(r) for r in (j.get("resultList", {}).get("result") or []) if r.get("pmid") or r.get("id")]

def gene_refs(syn):
    both = epmc._group(["CTBP1", "CTBP2"], "abs")
    q_abs = epmc._group(syn, "abs") + " AND " + both + epmc.EXCL
    refs = search(q_abs, n=15)
    if len(refs) < 4:                          # thin in title/abstract -> full text
        bothall = epmc._group(["CTBP1", "CTBP2"], "all")
        q_all = epmc._group(syn, "all") + " AND " + bothall + epmc.EXCL
        seen = {r["pmid"] for r in refs}
        for r in search(q_all, n=15):
            if r["pmid"] not in seen:
                refs.append(r)
    return refs[:15]

def hub_lit_total(hub):
    q = epmc._group([hub], "all") + epmc.EXCL
    j = C.get_json(epmc.url(q, page_size=1), limiter=C.EPMC_LIMIT, tries=5)
    return None if not j else j.get("hitCount")

def aging_refs(hub):
    terms = AGING_HUB_TERMS[hub]
    q = epmc._group(terms, "all") + " AND " + AGING_TOPIC + epmc.EXCL
    refs = search(q, n=12)
    if hub == "CTBP1":                          # guarantee the landmark paper
        have = {r["pmid"] for r in refs}
        if LANDMARK_PMID not in have:
            lm = search("EXT_ID:%s AND SRC:MED" % LANDMARK_PMID, n=1, sort_cited=False)
            if lm:
                refs = lm + refs
    return refs[:12]

def run():
    work = C.load_work()
    nodes = work["nodesBySym"]
    C.log("  gene refs for %d genes ..." % len(nodes))
    syms = list(nodes.keys())
    res = C.pmap(lambda s: (s, gene_refs(nodes[s].get("syn") or [s])), syms,
                 workers=6, label="refs")
    for r in res:
        if r:
            nodes[r[0]]["refs"] = r[1]

    for h in C.HUBS:
        hb = work["hubs"][h]
        lt = hub_lit_total(h)
        if lt is not None:
            hb["litTotal"] = lt
        hb["agingRefs"] = aging_refs(h)
        C.log("  %s: litTotal=%s, agingRefs=%d" % (h, hb.get("litTotal"), len(hb["agingRefs"])))
    C.save_work(work)
    C.emit_app_data(work)
    C.log("refs done.")

if __name__ == "__main__":
    run()
