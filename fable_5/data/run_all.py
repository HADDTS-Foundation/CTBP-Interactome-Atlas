#!/usr/bin/env python3
"""
run_all  -  drive the CTBP Interactome Atlas data pipeline in order.

    python3 data/run_all.py                 # full fresh build (network)
    python3 data/run_all.py --from evidence # resume from a step
    python3 data/run_all.py --only biogrid  # run a single step

Both hubs (CTBP1 + CTBP2) are fetched and merged symmetrically; the final artifact
is ../app-data.js (window.CTBP_DATA), validated by `node data/verify_data.js`.
"""
import sys, os, time, shutil
import common as C

import fetch_core, enrich, topup, netfetch, build_data, refs, diseases, evidence, annotate, genage, biogrid, fix_ups

STEPS = [
    ("fetch_core", fetch_core.run),
    ("enrich",     enrich.run),
    ("topup",      topup.run),
    ("netfetch",   netfetch.run),
    ("build_data", build_data.run),
    ("refs",       refs.run),
    ("diseases",   diseases.run),
    ("evidence",   evidence.run),
    ("annotate",   annotate.run),
    ("genage",     genage.run),
    ("biogrid",    biogrid.run),
    ("fix_ups",    fix_ups.run),
]

def backup():
    if os.path.exists(C.APPDATA):
        dst = C.APPDATA + ".bak-" + time.strftime("%Y%m%d-%H%M%S", time.gmtime())
        shutil.copy2(C.APPDATA, dst)
        C.log("backup -> %s" % os.path.basename(dst))

def main(argv):
    start, only = None, None
    if "--from" in argv:
        start = argv[argv.index("--from") + 1]
    if "--only" in argv:
        only = argv[argv.index("--only") + 1]
    backup()
    names = [n for n, _ in STEPS]
    if start and start not in names:
        C.log("unknown step %r; steps: %s" % (start, ", ".join(names))); return 2
    if only and only not in names:
        C.log("unknown step %r; steps: %s" % (only, ", ".join(names))); return 2
    began = start is None
    for name, fn in STEPS:
        if only:
            if name != only:
                continue
        else:
            if not began:
                if name == start:
                    began = True
                else:
                    continue
        C.log("\n=== step: %s ===" % name)
        t0 = time.monotonic()
        fn()
        C.log("    (%s took %.1fs)" % (name, time.monotonic() - t0))
    C.log("\nALL DONE. -> %s" % C.APPDATA)
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
