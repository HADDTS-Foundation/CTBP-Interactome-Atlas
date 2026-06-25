"""
genage — the data-driven Aging / longevity membership: GenAge human ageing genes
∪ LongevityMap *significant* longevity-association genes. Writes node.aging =
{genage, longevity, why, id, pmids} for members only.

HAGR can hard-block these zips (415). Degrade gracefully: if a set can't be
fetched, preserve any existing node.aging and never crash or wipe aging.
"""

import common as C

GENAGE_ZIP = "https://genomics.senescence.info/genes/human_genes.zip"
LONGEVITY_ZIP = "https://genomics.senescence.info/longevity/longevity_genes.zip"


def _rows(zf, want_substr):
    """Yield dict rows from the first CSV in the zip whose name matches."""
    if not zf:
        return
    names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
    names.sort(key=lambda n: (want_substr not in n.lower(), len(n)))
    for nm in names:
        try:
            with zf.open(nm) as fh:
                text = io_textwrap(fh.read())
            reader = C.csv.DictReader(text.splitlines())
            for row in reader:
                yield {(k or "").strip().lower(): (v or "").strip()
                       for k, v in row.items()}
            return
        except Exception:
            continue


def io_textwrap(b):
    return b.decode("utf-8", "replace")


def _col(row, *needles):
    for k, v in row.items():
        for n in needles:
            if n in k:
                return v
    return ""


def load_genage():
    zf = C.fetch_zip(GENAGE_ZIP, retries=2, sleep=0.0)
    if not zf:
        C.log("  ! GenAge zip unreachable — preserving existing aging")
        return None
    out = {}
    for row in _rows(zf, "human"):
        sym = _col(row, "symbol")
        gid = _col(row, "genage id", "id")
        if sym:
            out[sym.upper()] = gid or None
    C.log("  GenAge: %d human ageing genes" % len(out))
    return out


def load_longevity():
    zf = C.fetch_zip(LONGEVITY_ZIP, retries=2, sleep=0.0)
    if not zf:
        C.log("  ! LongevityMap zip unreachable — preserving existing aging")
        return None
    out = {}
    for row in _rows(zf, "longevity"):
        assoc = _col(row, "association").lower()
        if "significant" not in assoc or "non-significant" in assoc or "non significant" in assoc:
            continue
        genes = _col(row, "gene")
        pmid = _col(row, "pubmed")
        for sym in C.re.split(r"[,;/]\s*", genes):
            sym = sym.strip().upper()
            if not sym:
                continue
            rec = out.setdefault(sym, set())
            if pmid:
                rec.add(pmid)
    C.log("  LongevityMap: %d significant longevity genes" % len(out))
    return out


def annotate(rec, genage, longevity):
    sym = rec.get("sym")
    if not sym:
        return
    u = sym.upper()
    in_ga = genage is not None and u in genage
    in_lm = longevity is not None and u in longevity
    if not in_ga and not in_lm:
        return  # not a member (and we only get here if at least one set loaded)
    why = []
    if in_ga:
        why.append("Human ageing-associated gene (GenAge, HAGR)")
    if in_lm:
        why.append("Significant longevity-association gene (LongevityMap, HAGR)")
    rec["aging"] = {
        "genage": bool(in_ga),
        "longevity": bool(in_lm),
        "why": "; ".join(why),
        "id": (genage.get(u) if in_ga else None),
        "pmids": sorted(longevity.get(u, set())) if in_lm else [],
    }


def run():
    work = C.load_work()
    genage = load_genage()
    longevity = load_longevity()
    if genage is None and longevity is None:
        C.log("  both HAGR sets unreachable — aging left as-is")
        C.emit_appdata(work)
        return

    members = 0
    for H in C.HUBS:
        block = work["hubs"].get(H)
        if block:
            annotate(block, genage, longevity)
    for sym, g in work["genes"].items():
        annotate(g, genage, longevity)
        if g.get("aging"):
            members += 1
    C.log("  aging members in union: %d" % members)

    C.emit_appdata(work)
    C.save_work(work)
    C.log("genage done")


if __name__ == "__main__":
    run()
