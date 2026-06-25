"""
run_all — drive the pipeline steps in order, with a snapshot backup and a
`--from <step>` resume flag. Each step is idempotent and rewrites ../app-data.js.

    python3 data/run_all.py                 # full build (network; thousands of calls)
    python3 data/run_all.py --from build_data   # resume from a step
    python3 data/run_all.py --only evidence     # run a single step
    python3 data/run_all.py --list              # list the steps

Both hubs are fetched and merged before the snapshot is valid.
"""

import importlib
import os
import shutil
import sys
import time

import common as C

STEPS = [
    "fetch_core",   # STRING top-250 per hub + hub edge + ID resolution
    "enrich",       # Open Targets: dis, areas, tractability, function
    "topup",        # fill ID gaps / HGNC renames
    "netfetch",     # partner↔partner STRING edges over the union
    "build_data",   # assemble/merge union, finalize hub blocks, meta
    "refs",         # Europe PMC citation-ranked refs + aging reading lists
    "diseases",     # deepen node.dis
    "evidence",     # IntAct + Europe PMC co-mention tiers
    "annotate",     # UniProt / Reactome / HPO / GO / ClinVar
    "genage",       # GenAge ∪ LongevityMap
    "fixups",       # documented idempotent corrections
]


def backup():
    stamp = time.strftime("%Y%m%d-%H%M%S")
    for path in (C.APPDATA_PATH, C.WORK_PATH):
        if os.path.exists(path):
            dst = path + ".bak-" + stamp
            shutil.copy2(path, dst)
            C.log("  backup %s -> %s" % (os.path.basename(path), os.path.basename(dst)))


def main(argv):
    start = 0
    only = None
    if "--list" in argv:
        for i, s in enumerate(STEPS, 1):
            print("%2d. %s" % (i, s))
        return 0
    if "--from" in argv:
        name = argv[argv.index("--from") + 1]
        if name not in STEPS:
            print("unknown step: %s (see --list)" % name)
            return 2
        start = STEPS.index(name)
    if "--only" in argv:
        only = argv[argv.index("--only") + 1]
        if only not in STEPS:
            print("unknown step: %s (see --list)" % only)
            return 2

    backup()
    plan = [only] if only else STEPS[start:]
    t0 = time.time()
    for name in plan:
        C.log("\n=== step: %s ===" % name)
        mod = importlib.import_module(name)
        importlib.reload(mod)
        try:
            mod.run()
        except Exception as e:
            C.log("!! step %s raised %s: %s — continuing with what we have"
                  % (name, type(e).__name__, e))
    C.log("\nall done in %.0fs -> %s" % (time.time() - t0, C.APPDATA_PATH))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
