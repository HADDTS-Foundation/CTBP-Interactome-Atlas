"""
netfetch  -  step 4.

The partner<->partner STRING graph over the UNION of both neighbourhoods (plus the
two hubs), so the app can do the indirect hub -> M -> G (and -> N -> G) path-finding
(depth <= 3). Stored as edges:[{a,b,s}] with s = STRING combined score.
"""
import common as C

STRING = "https://string-db.org/api/json"

def resolve_string_ids(symbols):
    """symbol -> STRING id, via a batched POST to get_string_ids."""
    sid2sym, ids = {}, []
    syms = list(symbols)
    for i in range(0, len(syms), 400):
        chunk = syms[i:i+400]
        body = {"identifiers": "\r".join(chunk), "species": str(C.SPECIES), "echo_query": "1"}
        res = C.post_form(STRING + "/get_string_ids", body, limiter=C.POLITE)
        if not res:
            continue
        for r in res:
            sid = r.get("stringId")
            q = r.get("queryItem")
            if sid and q in symbols:
                sid2sym[sid] = q
                ids.append(sid)
    return sid2sym, ids

def fetch_network(ids):
    """Induced subnetwork among the given STRING ids (POST; may be chunked)."""
    edges = []
    body = {"identifiers": "\r".join(ids), "species": str(C.SPECIES)}
    res = C.post_form(STRING + "/network", body, limiter=C.POLITE, timeout=120)
    if res:
        edges = res
    return edges

def run():
    work = C.load_work()
    accepted = set(work["nodesBySym"].keys()) | set(C.HUBS)
    C.log("  resolving %d STRING ids ..." % len(accepted))
    sid2sym, ids = resolve_string_ids(accepted)
    C.log("  resolved %d STRING ids; fetching induced network ..." % len(ids))
    rows = fetch_network(ids)
    C.log("  STRING returned %d edge rows" % len(rows))

    seen, edges = set(), []
    for r in rows:
        a = sid2sym.get(r.get("stringId_A")) or r.get("preferredName_A")
        b = sid2sym.get(r.get("stringId_B")) or r.get("preferredName_B")
        if not a or not b or a == b:
            continue
        if a not in accepted or b not in accepted:
            continue
        key = tuple(sorted((a, b)))
        if key in seen:
            continue
        seen.add(key)
        sc = r.get("score")
        edges.append({"a": key[0], "b": key[1], "s": round(sc, 3) if sc is not None else None})
    work["edges"] = edges
    # sanity: how many union nodes have at least one partner<->partner edge
    touched = set()
    for e in edges:
        touched.add(e["a"]); touched.add(e["b"])
    C.log("  kept %d unique edges over %d symbols" % (len(edges), len(touched)))
    C.save_work(work)
    C.log("netfetch done.")

if __name__ == "__main__":
    run()
