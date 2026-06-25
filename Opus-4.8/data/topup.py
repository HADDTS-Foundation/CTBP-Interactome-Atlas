"""
topup — fill ID gaps (UniProt accession, MIM, names) and reconcile HGNC renames
by re-resolving against MyGene's gene endpoint (by Entrez, which is stable across
symbol renames). Idempotent: only fills missing fields, never overwrites a value.
"""

import common as C
from fetch_core import _first


def gene_by_entrez(entrez):
    url = ("https://mygene.info/v3/gene/%s?" % entrez
           + C.urllib.parse.urlencode({"fields": "symbol,name,uniprot,MIM,alias,ensembl.gene"}))
    return C.fetch(url)


def run():
    work = C.load_work()
    genes = work["genes"]
    filled = 0
    done = 0
    for sym, g in genes.items():
        done += 1
        need_uniprot = not g.get("uniprot")
        need_mim = not g.get("mim")
        need_name = not g.get("name")
        need_syn = not g.get("syn")
        if not (need_uniprot or need_mim or need_name or need_syn):
            continue
        entrez = g.get("entrez")
        if not entrez:
            continue
        res = gene_by_entrez(entrez)
        if not isinstance(res, dict):
            continue
        if need_uniprot:
            uni = res.get("uniprot") or {}
            acc = _first(uni.get("Swiss-Prot")) or _first(uni.get("TrEMBL"))
            if acc:
                g["uniprot"] = acc
                filled += 1
        if need_mim and res.get("MIM"):
            g["mim"] = str(res["MIM"])
        if need_name and res.get("name"):
            g["name"] = res["name"]
        if need_syn:
            al = res.get("alias")
            al = al if isinstance(al, list) else ([al] if al else [])
            g["syn"] = C.clean_synonyms(sym, al)
        if done % 60 == 0:
            C.log("  topup %d/%d" % (done, len(genes)))
            C.save_work(work)

    C.emit_appdata(work)
    C.save_work(work)
    C.log("topup done (filled %d uniprot gaps)" % filled)


if __name__ == "__main__":
    run()
