"""
netfetch — the partner↔partner STRING edge graph over the UNION of both hubs'
neighbourhoods. Powers network-context scoring and the indirect path-finding
(hub → M → G, depth ≤ 3). Hub-incident edges are excluded; hub→partner strength
already lives in each node's s1/s2.

Primary: one STRING `network` call over all union STRING ids (POST).
Fallback: per-node interaction_partners intersected with the union.
"""

import common as C

STRING_API = "https://string-db.org/api"
CALLER = "haddts_ctbp_atlas"


def resolve_string_ids(syms):
    """Batch-resolve symbols -> STRING ids via get_string_ids."""
    out = {}
    batch = 80
    for i in range(0, len(syms), batch):
        chunk = syms[i:i + batch]
        url = (STRING_API + "/json/get_string_ids?"
               + C.urllib.parse.urlencode({"identifiers": "\r".join(chunk),
                                           "species": "9606", "limit": "1",
                                           "caller_identity": CALLER}))
        res = C.fetch(url)
        if isinstance(res, list):
            for r in res:
                q = r.get("queryItem")
                sid = r.get("stringId")
                if q and sid:
                    out[q] = sid
        C.log("  resolved STRING ids %d/%d" % (min(i + batch, len(syms)), len(syms)))
    return out


def network_edges(string_ids):
    """One POST to the STRING network endpoint over the given ids -> [(a,b,score)]."""
    body = {"identifiers": "\r".join(string_ids), "species": "9606",
            "caller_identity": CALLER}
    res = C.fetch(STRING_API + "/tsv-no-header/network", data=body, parse="text",
                  timeout=120)
    edges = []
    if not res:
        return edges
    for line in res.splitlines():
        cols = line.split("\t")
        if len(cols) < 6:
            continue
        a, b = cols[2], cols[3]
        try:
            s = float(cols[5])
        except ValueError:
            continue
        edges.append((a, b, s))
    return edges


def fallback_edges(union_syms):
    """Per-node interaction_partners, kept where both ends are in the union."""
    uset = set(union_syms)
    seen = {}
    for i, sym in enumerate(union_syms, 1):
        url = (STRING_API + "/json/interaction_partners?"
               + C.urllib.parse.urlencode({"identifiers": sym, "species": "9606",
                                           "limit": "400", "caller_identity": CALLER}))
        res = C.fetch(url)
        if isinstance(res, list):
            for rec in res:
                b = rec.get("preferredName_B")
                if b in uset and b != sym:
                    key = tuple(sorted((sym, b)))
                    seen[key] = max(seen.get(key, 0.0), C.num(rec.get("score")))
        if i % 50 == 0:
            C.log("  fallback edges %d/%d" % (i, len(union_syms)))
    return [(a, b, s) for (a, b), s in seen.items()]


def run():
    work = C.load_work()
    union = [s for s, g in work["genes"].items()
             if g.get("s1") is not None or g.get("s2") is not None]
    if not union:
        C.log("  no union genes yet — run fetch_core first")
        return

    sid_map = resolve_string_ids(union)
    for sym, sid in sid_map.items():
        if sym in work["genes"]:
            work["genes"][sym]["_strid"] = sid

    hub_syms = set(C.HUBS)
    raw = network_edges(list(sid_map.values()))
    C.log("  network endpoint returned %d raw edges" % len(raw))
    if not raw:
        C.log("  falling back to per-node interaction_partners")
        raw = fallback_edges(union)

    uset = set(union)
    seen = {}
    for a, b, s in raw:
        if a in hub_syms or b in hub_syms:
            continue                      # hub→partner lives in s1/s2
        if a not in uset or b not in uset or a == b:
            continue
        key = tuple(sorted((a, b)))
        seen[key] = max(seen.get(key, 0.0), s)
    edges = [{"a": a, "b": b, "s": round(s, 3)} for (a, b), s in seen.items()]
    work["edges"] = edges
    C.log("  kept %d partner↔partner edges over the union" % len(edges))

    C.emit_appdata(work)
    C.save_work(work)
    C.log("netfetch done")


if __name__ == "__main__":
    run()
