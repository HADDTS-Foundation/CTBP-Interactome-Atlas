"""
biogrid  -  step 11.

A second curated PHYSICAL interaction layer beside IntAct, from the KEY-FREE bulk
BIOGRID-ALL-<release>.tab3.zip (the REST webservice needs a key; forbidden).

Researcher-directed filters, applied verbatim:
  - human-human only            (both Organism ID = 9606)
  - Experimental System Type = physical   (no genetic)
  - exclude yeast two-hybrid    (Experimental System = "Two-hybrid")
  - no cross-organism / no conservation view

Per partner: node.biogrid = {count, methods[], pmids[]} (combined across hubs).
The 171 MB raw zip is gitignored; a small CtBP extract .tsv is committed.
"""
import os, io, csv, zipfile, urllib.request
import common as C

REL = C.BIOGRID_RELEASE
ZIP_URL = ("https://downloads.thebiogrid.org/Download/BioGRID/Release-Archive/"
           "BIOGRID-%s/BIOGRID-ALL-%s.tab3.zip" % (REL, REL))
ZIP_PATH = os.path.join(C.BIOGRID_DIR, "BIOGRID-ALL-%s.tab3.zip" % REL)
EXTRACT = os.path.join(C.BIOGRID_DIR, "CTBP-extract-%s.tsv" % REL)

csv.field_size_limit(10 * 1024 * 1024)

def download():
    os.makedirs(C.BIOGRID_DIR, exist_ok=True)
    if os.path.exists(ZIP_PATH) and os.path.getsize(ZIP_PATH) > 1_000_000:
        C.log("  BioGRID zip already present (%d bytes)" % os.path.getsize(ZIP_PATH))
        return True
    C.log("  downloading BioGRID %s (~171 MB) ..." % REL)
    tmp = ZIP_PATH + ".part"
    try:
        req = urllib.request.Request(ZIP_URL, headers={"User-Agent": C.UA})
        with urllib.request.urlopen(req, timeout=300) as r, open(tmp, "wb") as f:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
        os.replace(tmp, ZIP_PATH)
        C.log("  downloaded %d bytes" % os.path.getsize(ZIP_PATH))
        return True
    except Exception as e:
        C.log("  ! BioGRID download failed: %r (degrading gracefully)" % e)
        if os.path.exists(tmp):
            os.remove(tmp)
        return False

def col(header):
    idx = {}
    for i, h in enumerate(header):
        idx[h.strip()] = i
    def get(name):
        for k in idx:
            if k.lower() == name.lower():
                return idx[k]
        return None
    return {
        "symA": get("Official Symbol Interactor A"),
        "symB": get("Official Symbol Interactor B"),
        "sys": get("Experimental System"),
        "systype": get("Experimental System Type"),
        "orgA": get("Organism ID Interactor A"),
        "orgB": get("Organism ID Interactor B"),
        "pub": get("Publication Source"),
    }

def run():
    work = C.load_work()
    ok = download()
    if not ok:
        work.setdefault("meta", {}).setdefault("biogridRelease", REL)
        C.save_work(work); C.emit_app_data(work)
        return
    nodes = work["nodesBySym"]
    hubset = set(C.HUBS)
    per = {}
    kept_rows = []
    header_out = None
    member = "BIOGRID-ALL-%s.tab3.txt" % REL
    with zipfile.ZipFile(ZIP_PATH) as z:
        names = z.namelist()
        if member not in names:
            member = next((n for n in names if n.endswith(".txt")), names[0])
        with z.open(member) as raw:
            stream = io.TextIOWrapper(raw, encoding="utf-8", errors="replace")
            reader = csv.reader(stream, delimiter="\t")
            header = next(reader)
            header_out = header
            c = col(header)
            if c["symA"] is None or c["systype"] is None:
                C.log("  ! unexpected BioGRID header; aborting biogrid step")
                return
            n = 0
            for row in reader:
                n += 1
                try:
                    a = row[c["symA"]]; b = row[c["symB"]]
                    if a not in hubset and b not in hubset:
                        continue
                    if row[c["orgA"]] != "9606" or row[c["orgB"]] != "9606":
                        continue
                    if (row[c["systype"]] or "").lower() != "physical":
                        continue
                    sysname = row[c["sys"]] or ""
                    if sysname.strip().lower() == "two-hybrid":
                        continue
                except IndexError:
                    continue
                partner = b if a in hubset else a
                if partner in hubset or partner not in nodes:
                    # still record CtBP-involving rows for the committed extract
                    kept_rows.append(row)
                    continue
                kept_rows.append(row)
                pmid = (row[c["pub"]] or "").split(":")[-1].strip() if c["pub"] is not None else ""
                d = per.setdefault(partner, {"methods": set(), "pmids": set(), "count": 0})
                if sysname: d["methods"].add(sysname)
                if pmid.isdigit(): d["pmids"].add(pmid)
                d["count"] += 1
                if n % 500000 == 0:
                    C.log("    scanned %d rows, %d CtBP rows kept ..." % (n, len(kept_rows)))
    C.log("  BioGRID: %d CtBP physical non-Y2H rows; %d union partners annotated"
          % (len(kept_rows), len(per)))

    for sym, d in per.items():
        nodes[sym]["biogrid"] = {"count": d["count"],
                                 "methods": sorted(d["methods"])[:10],
                                 "pmids": sorted(d["pmids"])[:25]}
    # commit the small extract for reproducibility
    try:
        with open(EXTRACT, "w", newline="") as f:
            w = csv.writer(f, delimiter="\t")
            if header_out:
                w.writerow(header_out)
            w.writerows(kept_rows)
        C.log("  wrote committed extract %s (%d rows)" % (os.path.basename(EXTRACT), len(kept_rows)))
    except OSError as e:
        C.log("  ! could not write extract: %r" % e)

    work.setdefault("meta", {})["biogridRelease"] = REL
    C.save_work(work)
    C.emit_app_data(work)
    C.log("biogrid done.")

if __name__ == "__main__":
    run()
