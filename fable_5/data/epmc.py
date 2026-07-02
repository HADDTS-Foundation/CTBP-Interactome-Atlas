"""
epmc  -  the CANONICAL, byte-identical Europe PMC co-mention query builder.

This is a reproducibility INVARIANT: app.js rebuilds the same query strings for
its in-page source links, so identical query => identical count. The builder here
and the `epmcQuery()` in app.js MUST stay character-for-character equal.

Three nested scopes (broadest last), so counts are monotonic (title <= abs <= all):
  - title : both groups appear in the TITLE
  - abs   : title+abstract  (each group in TITLE or ABSTRACT; includes the title hits)
  - all   : anywhere in the full text (bare quoted terms)

Every query appends the CTBP1 lncRNA exclusions (NOT "CTBP1-AS2" NOT "CTBP1-DT"
NOT "CTBP1-AS1"); "CTBP1-AS" is deliberately NOT excluded ("AS" is a stopword).
"""

EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
EXCL = ' NOT "CTBP1-AS2" NOT "CTBP1-DT" NOT "CTBP1-AS1"'

def _group(terms, tier):
    if tier == "title":
        inner = " OR ".join('TITLE:"%s"' % t for t in terms)
    elif tier == "abs":
        inner = " OR ".join('TITLE:"%s" OR ABSTRACT:"%s"' % (t, t) for t in terms)
    else:  # all
        inner = " OR ".join('"%s"' % t for t in terms)
    return "(" + inner + ")"

def build(gene_syns, hub_syms, tier):
    """gene_syns: ordered synonym list (incl. primary symbol).
       hub_syms : ['CTBP1'] | ['CTBP2'] | ['CTBP1','CTBP2'] (both-hub)."""
    parts = [_group(gene_syns, tier)] + [_group([h], tier) for h in hub_syms]
    return " AND ".join(parts) + EXCL

def url(query, page_size=1, extra=""):
    import urllib.parse
    return "%s?query=%s&format=json&pageSize=%d%s" % (
        EPMC, urllib.parse.quote(query), page_size, extra)
