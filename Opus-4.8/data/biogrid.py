"""
biogrid — a second curated PHYSICAL-interaction layer beside IntAct, from the
key-free BioGRID bulk download (release in common.BIOGRID_RELEASE).

Researcher-directed filters (verbatim decisions, see the build prompts):
  * HUMAN only         — both Organism ID = 9606
  * PHYSICAL only      — Experimental System Type = physical (no genetic)
  * exclude YEAST TWO-HYBRID — Experimental System != "Two-hybrid"
  * BioGRID is the sole source; NO cross-organism / NO conservation view
    (the consulted CtBP researcher: only human data is trustable)

Per partner gene that interacts with a hub (CTBP1/CTBP2) we store
`node.biogrid = {count, methods[], pmids[]}`, combined across hubs like `intact`.

The 171 MB raw archive is streamed and gitignored; a small CtBP extract
(data/BioGRID/biogrid-ctbp-human-physical.tsv) is written for reproducibility.
"""

import io
import os
import glob

import common as C

BIOGRID_DIR = os.path.join(C.DATA_DIR, "BioGRID")
EXTRACT_TSV = os.path.join(BIOGRID_DIR, "biogrid-ctbp-human-physical.tsv")
HUBS_UP = {h.upper() for h in C.HUBS}
MAX_METHODS = 6
MAX_PMIDS = 8


def locate_or_download():
    """Return a path to a BioGRID .tab3 zip in data/BioGRID/, downloading if absent."""
    os.makedirs(BIOGRID_DIR, exist_ok=True)
    found = sorted(glob.glob(os.path.join(BIOGRID_DIR, "*.tab3.zip")))
    if found:
        return found[0]
    dest = os.path.join(BIOGRID_DIR, "BIOGRID-ALL-%s.tab3.zip" % C.BIOGRID_RELEASE)
    C.log("  downloading BioGRID %s (~171 MB, key-free)…" % C.BIOGRID_RELEASE)
    if C.download_to_file(C.BIOGRID_ALL_URL, dest):
        return dest
    return None


def _member(zf):
    for n in zf.namelist():
        if n.lower().endswith(".txt"):
            return n
    return zf.namelist()[0] if zf.namelist() else None


def run():
    work = C.load_work()
    genes = work["genes"]
    union_up = {s.upper(): s for s in genes}   # uppercase -> canonical sym

    path = locate_or_download()
    if not path:
        C.log("  ! BioGRID archive unavailable — skipping (biogrid left as-is)")
        C.emit_appdata(work)
        return

    try:
        zf = C.zipfile.ZipFile(path)
    except Exception as e:
        C.log("  ! cannot open %s (%s) — skipping" % (path, type(e).__name__))
        C.emit_appdata(work)
        return

    member = _member(zf)
    C.log("  reading %s :: %s" % (os.path.basename(path), member))

    acc = {}          # canonical partner sym -> {count, methods:set, pmids:set}
    extract_rows = []
    kept = scanned = 0
    with zf.open(member) as raw:
        stream = io.TextIOWrapper(raw, encoding="utf-8", errors="replace")
        header = stream.readline().rstrip("\n").split("\t")
        if header and header[0].startswith("#"):
            header[0] = header[0][1:]
        idx = {name.strip(): i for i, name in enumerate(header)}

        def col(cols, name):
            i = idx.get(name)
            return cols[i].strip() if (i is not None and i < len(cols)) else ""

        for line in stream:
            scanned += 1
            cols = line.rstrip("\n").split("\t")
            if col(cols, "Organism ID Interactor A") != "9606":
                continue
            if col(cols, "Organism ID Interactor B") != "9606":
                continue
            if col(cols, "Experimental System Type").lower() != "physical":
                continue
            es = col(cols, "Experimental System")
            if "two-hybrid" in es.lower():            # exclude yeast two-hybrid
                continue
            a = col(cols, "Official Symbol Interactor A").upper()
            b = col(cols, "Official Symbol Interactor B").upper()
            if a in HUBS_UP and b not in HUBS_UP:
                hub, partner_up = a, b
            elif b in HUBS_UP and a not in HUBS_UP:
                hub, partner_up = b, a
            else:
                continue                               # not a hub–partner row (or hub–hub)
            sym = union_up.get(partner_up)
            if not sym:
                continue                               # partner not in our union
            pub = col(cols, "Publication Source")   # tab3 format, e.g. "PUBMED:12345"
            pmid = pub.split(":")[-1].strip() if pub else ""
            rec = acc.setdefault(sym, {"count": 0, "methods": set(), "pmids": set()})
            rec["count"] += 1
            if es:
                rec["methods"].add(es)
            if pmid and pmid.isdigit():
                rec["pmids"].add(pmid)
            extract_rows.append("\t".join([hub, sym, es, pmid, col(cols, "Throughput")]))
            kept += 1

    C.log("  scanned %d rows, kept %d CtBP human/physical/non-Y2H, %d partners"
          % (scanned, kept, len(acc)))

    for sym, rec in acc.items():
        genes[sym]["biogrid"] = {
            "count": rec["count"],
            "methods": sorted(rec["methods"])[:MAX_METHODS],
            "pmids": sorted(rec["pmids"], key=lambda p: int(p))[:MAX_PMIDS],
        }

    # committed reproducibility extract (small)
    try:
        with open(EXTRACT_TSV, "w", encoding="utf-8") as fh:
            fh.write("# BioGRID %s — human, physical, yeast-two-hybrid excluded; CtBP hub–partner rows\n"
                     % C.BIOGRID_RELEASE)
            fh.write("hub\tpartner\texperimental_system\tpubmed\tthroughput\n")
            fh.write("\n".join(sorted(extract_rows)) + "\n")
        C.log("  wrote extract %s (%d rows)" % (os.path.basename(EXTRACT_TSV), len(extract_rows)))
    except Exception as e:
        C.log("    · could not write extract: %s" % type(e).__name__)

    C.emit_appdata(work)
    C.save_work(work)
    C.log("biogrid done")


if __name__ == "__main__":
    run()
