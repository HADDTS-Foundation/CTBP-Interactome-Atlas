/*
 * engine.js  -  the pure CTBP Interactome Atlas inference engine.
 *
 * No DOM. No hard-coded partner genes. The ONLY gene-ish tokens allowed here are
 * the two subject hubs (HUBS) and the documented literature stop-list (STOPLIST).
 * Every hub-relative computation is parameterised by a hub argument and reads that
 * hub's fields (s1/lit1 for CTBP1, s2/lit2 for CTBP2), so the engine is symmetric
 * in the two paralogs.
 *
 * Area membership is 100% a function of the data (EFO area sums / OT disease-name
 * regexes / GenAge-LongevityMap), never a hand-picked gene list; data/verify.js
 * recomputes membership straight from the raw data and asserts it equals what this
 * engine returns. Change a threshold or weight here and the test recomputes the
 * same rule, so it stays falsifiable without pinning any biological conclusion.
 */
(function (root) {
  "use strict";

  var HUBS = ["CTBP1", "CTBP2"];
  var STOPLIST = { IMPACT: 1, GAPDH: 1, TBP: 1, ACTB: 1, B2M: 1 };
  var W = { phys: 0.5, lit: 0.3, ctx: 0.2 };      // fixed editorial weights (no UI)

  // ---- fields (5 SECTOR + 5 cross-cutting overlay/filter). EFO labels are the
  //      LIVE Open Targets therapeuticAreas strings (OT renamed several
  //      "... disease" -> "... disorder"); membership keys off them verbatim. ----
  var THEMES = {
    oncology:   { label: "Oncology", color: "--area-oncology", sector: true, kind: "ot",
                  efo: ["cancer or benign tumor"], thr: 0.15,
                  re: /cancer|carcinoma|tumou?r|neoplas|lymphoma|leuk(?:a)?emia|melanoma|sarcoma|glioma|blastoma|myeloma|malignan/i },
    metabolic:  { label: "Metabolic disease", color: "--area-metabolic", sector: true, kind: "ot",
                  efo: ["nutritional or metabolic disease", "endocrine system disorder"], thr: 0.15,
                  re: /diabet|obesit|metaboli|insulin|lipid|cholesterol|glucose|endocrine|thyroid|glycogen|steatosis/i },
    neurodegen: { label: "Neurodegeneration", color: "--area-neurodegen", sector: true, kind: "name",
                  re: /alzheimer|parkinson|amyotrophic|\bALS\b|huntington|dementia|neurodegener|frontotemporal|tauopath|prion|spinocerebellar|motor neuron/i },
    cns:        { label: "CNS / neuroscience", color: "--area-cns", sector: true, kind: "ot",
                  efo: ["nervous system disorder", "psychiatric disorder"], thr: 0.15,
                  re: /epileps|seizure|schizophren|bipolar|depress|neuropath|migraine|psychiatr|encephal|neurolog/i },
    neurodev:   { label: "Neurodevelopment (incl. ASD)", color: "--area-neurodev", sector: true, kind: "name",
                  re: /autism|\bASD\b|intellectual disab|developmental delay|neurodevelopment|epileptic encephalopath|\bDEE\b|global developmental|pervasive developmental/i },
    aging:      { label: "Aging / longevity", color: "--area-aging", sector: false, kind: "aging" },
    immunity:   { label: "Immunity", color: "--area-immunity", sector: false, kind: "ot",
                  efo: ["immune system disorder"], thr: 0.15,
                  re: /immun|autoimmun|inflammat|lupus|arthrit|psorias|colitis|crohn|allerg/i },
    cardiovascular: { label: "Cardiovascular", color: "--area-cardiovascular", sector: false, kind: "ot",
                  efo: ["cardiovascular disorder"], thr: 0.15,
                  re: /cardio|heart|coronary|atheroscler|hypertens|arrhythm|myocard|vascular|aneurysm/i },
    hematologic: { label: "Hematologic (blood)", color: "--area-hematologic", sector: false, kind: "ot",
                  efo: ["hematologic disorder"], thr: 0.15,
                  re: /anemia|anaemia|leuk(?:a)?emia|thromb|h(?:a)?emato|platelet|coagul|myelodysplas|neutropenia/i },
    eye:        { label: "Eye / vision", color: "--area-eye", sector: false, kind: "ot",
                  efo: ["disorder of visual system"], thr: 0.15,
                  re: /retin|macular|glaucoma|cataract|vision|ocular|\boptic\b|blind|\beye\b|corneal/i }
  };
  var THEME_ORDER = ["oncology", "metabolic", "neurodegen", "cns", "neurodev",
                     "aging", "immunity", "cardiovascular", "hematologic", "eye"];

  var MECH = {
    redox:    { label: "NAD+/redox", re: /NAD\(?H?\)?\+?|NADH|oxidoreductase|dehydrogenase|sirtuin|\bredox\b|2-hydroxyacid/i },
    chromatin:{ label: "Chromatin", re: /chromatin|histone|nucleosome|methyltransferase|acetyltransferase|deacetylase/i },
    repress:  { label: "Co-repression", re: /repress|corepress|co-repress|silenc|transcriptional repress/i },
    wnt:      { label: "Wnt / EMT", re: /\bWnt\b|beta-catenin|β-catenin|epithelial[- ]mesenchymal|\bEMT\b|catenin/i },
    synaptic: { label: "Synaptic", re: /synap|neurotransmit|\baxon|presynap|postsynap|ribbon synapse/i },
    apoptosis:{ label: "Apoptosis", re: /apopto|programmed cell death|caspase|pro-apopto|anti-apopto/i }
  };

  // ---------------------------------------------------------------- helpers ----
  function num(x) { return (typeof x === "number" && !isNaN(x)) ? x : 0; }
  function clamp(x) { return Math.max(0, Math.min(1, x)); }
  function sKey(hub) { return hub === "CTBP1" ? "s1" : "s2"; }
  function litKey(hub) { return hub === "CTBP1" ? "lit1" : "lit2"; }
  function rankKey(hub) { return hub === "CTBP1" ? "rank1" : "rank2"; }

  // per-dataset preparation (adjacency + normalisation constants), memoised.
  var _cache = (typeof WeakMap !== "undefined") ? new WeakMap() : null;
  function prep(D) {
    if (_cache && _cache.has(D)) return _cache.get(D);
    var bySym = {}, i;
    for (i = 0; i < D.nodes.length; i++) bySym[D.nodes[i].sym] = D.nodes[i];
    // undirected weighted adjacency over partners + both hubs
    var adj = {};
    function link(a, b, w) {
      if (a == null || b == null || a === b || w == null) return;
      (adj[a] || (adj[a] = {}))[b] = Math.max(adj[a][b] || 0, w);
      (adj[b] || (adj[b] = {}))[a] = Math.max(adj[b][a] || 0, w);
    }
    for (i = 0; i < D.edges.length; i++) link(D.edges[i].a, D.edges[i].b, num(D.edges[i].s));
    for (i = 0; i < D.nodes.length; i++) {
      var n = D.nodes[i];
      if (n.s1) link("CTBP1", n.sym, num(n.s1.c));
      if (n.s2) link("CTBP2", n.sym, num(n.s2.c));
    }
    if (D.hubEdge && D.hubEdge.s) link("CTBP1", "CTBP2", num(D.hubEdge.s.c));

    // network-context raw (sum of partner<->partner weights, excluding BOTH hubs)
    var ctxRaw = {}, maxCtx = 0, maxLit = 1, sym;
    for (sym in adj) {
      if (sym === "CTBP1" || sym === "CTBP2") continue;
      var sum = 0, nb = adj[sym];
      for (var k in nb) { if (k === "CTBP1" || k === "CTBP2") continue; sum += nb[k]; }
      ctxRaw[sym] = sum; if (sum > maxCtx) maxCtx = sum;
    }
    for (i = 0; i < D.nodes.length; i++) {
      var nn = D.nodes[i];
      if (STOPLIST[nn.sym]) continue;
      var l1 = num(nn.lit1), l2 = num(nn.lit2);
      if (l1 > maxLit) maxLit = l1;
      if (l2 > maxLit) maxLit = l2;
    }
    var out = { bySym: bySym, adj: adj, ctxRaw: ctxRaw, maxCtx: maxCtx || 1, maxLit: maxLit };
    if (_cache) _cache.set(D, out);
    return out;
  }

  // ---------------------------------------------------------------- connection -
  // per-hub connection score + type; returns null if node doesn't neighbour hub.
  function connection(D, node, hub) {
    var s = node[sKey(hub)];
    if (!s) return null;
    var P = prep(D);
    var phys = clamp(num(s.e) + 0.5 * num(s.d));      // experiments + curated DB only
    var litRaw = STOPLIST[node.sym] ? 0 : num(node[litKey(hub)]);
    var lit = Math.log10(litRaw + 1) / Math.log10(P.maxLit + 1);
    var ctx = clamp((P.ctxRaw[node.sym] || 0) / P.maxCtx);
    var composite = 100 * (W.phys * phys + W.lit * lit + W.ctx * ctx) / (W.phys + W.lit + W.ctx);
    return {
      hub: hub, phys: phys, lit: lit, ctx: ctx, litRaw: litRaw,
      composite: Math.round(composite * 10) / 10,
      type: classify(node, s, phys, lit, ctx)
    };
  }

  // connection type keys off PHYSICAL evidence, never the DB channel alone.
  function classify(node, s, phys, lit, ctx) {
    var ia = node.intact || null, bg = node.biogrid || null;
    var iaDirect = !!(ia && ia.direct);
    var iaPhys = !!(ia && (ia.direct || ia.physical));
    var bgPhys = !!(bg && bg.count >= 1);
    var sc = num(s.c), se = num(s.e);
    if (sc >= 0.9 && (se >= 0.5 || iaDirect)) return "Core complex";
    if (se >= 0.2 || iaPhys || bgPhys) return "Physical interactor";
    if (lit >= 0.6 && phys < 0.45) return "Literature-linked";
    if (ctx >= 0.45 && phys < 0.45) return "Functional neighbour";
    return "Associated";
  }

  // ---------------------------------------------------------------- themes -----
  function floored(dis) {
    if (!dis) return [];
    var out = [];
    for (var i = 0; i < dis.length; i++) {
      var d = dis[i];
      if (num(d.s) >= 0.18 || (i < 3 && num(d.s) >= 0.10)) out.push(d);
    }
    return out;
  }

  // area memberships for a node (hub-independent). Returns array of flags.
  function themesFor(node) {
    var flags = [], areas = node.areas || {}, dis = node.dis || [], fl = floored(dis), i, k;
    var totalBurden = 0;
    for (k in areas) totalBurden += num(areas[k]);
    for (var t = 0; t < THEME_ORDER.length; t++) {
      var key = THEME_ORDER[t], th = THEMES[key], flag = null;
      if (th.kind === "ot") {
        var sum = 0, present = false;
        for (i = 0; i < th.efo.length; i++) if (areas[th.efo[i]] != null) { sum += num(areas[th.efo[i]]); present = true; }
        if (present && sum > th.thr) {
          var examples = [];
          for (i = 0; i < fl.length && examples.length < 4; i++) if (th.re.test(fl[i].n || "")) examples.push(fl[i]);
          var strength = totalBurden > 0 ? sum / totalBurden : 0;
          flag = mkFlag(key, th, strength, { efo: th.efo.slice(), sum: round4(sum) }, examples);
        }
      } else if (th.kind === "name") {
        var matches = [];
        for (i = 0; i < fl.length; i++) if (th.re.test(fl[i].n || "")) matches.push(fl[i]);
        if (matches.length) {
          var top = matches[0];
          for (i = 1; i < matches.length; i++) if (num(matches[i].s) > num(top.s)) top = matches[i];
          flag = mkFlag(key, th, num(top.s), top, matches.slice(0, 4));
        }
      } else if (th.kind === "aging") {
        if (node.aging) {
          var strengthA = node.aging.genage ? 0.6 : 0.45;
          flag = mkFlag(key, th, strengthA, node.aging, []);
        }
      }
      if (flag) flags.push(flag);
    }
    return flags;
  }

  function mkFlag(key, th, strength, top, matches) {
    var sev = Math.max(1, Math.min(3, Math.round(clamp(strength) * 3)));
    return { key: key, label: th.label, theme: th.color, sector: !!th.sector,
             kind: th.kind, strength: clamp(strength), sev: sev, top: top, matches: matches || [] };
  }

  // dominant disease area (drives node colour). Aging excluded unless it is the
  // only membership. Returns a flag or null.
  function dominant(node) {
    var flags = themesFor(node), best = null, agingFlag = null, i, f;
    for (i = 0; i < flags.length; i++) {
      f = flags[i];
      if (f.key === "aging") { agingFlag = f; continue; }
      if (!best || f.strength > best.strength) best = f;
    }
    return best || agingFlag || null;
  }
  // dominant among the 5 SECTOR fields only (constellation wedge + fill colour).
  function dominantSector(node) {
    var flags = themesFor(node), best = null, i, f;
    for (i = 0; i < flags.length; i++) {
      f = flags[i];
      if (!f.sector) continue;
      if (!best || f.strength > best.strength) best = f;
    }
    return best;
  }

  function mechFor(node) {
    var out = [], f = node.func || "";
    for (var k in MECH) if (MECH[k].re.test(f)) out.push({ key: k, label: MECH[k].label });
    return out;
  }

  // ---------------------------------------------------------------- paths ------
  function routes(D, hub, to, opts) {
    opts = opts || {};
    var maxDepth = opts.maxDepth || 3, top = opts.top || 5;
    var P = prep(D), adj = P.adj;
    if (to === hub || !adj[hub]) return [];
    // direct edge always wins
    if (adj[hub][to] != null) {
      return [{ path: [hub, to], edges: [{ a: hub, b: to, s: adj[hub][to] }],
                score: adj[hub][to], direct: true }];
    }
    var found = [];
    var hn = adj[hub];
    // depth 2: hub -> M -> to
    for (var m in hn) {
      if (m === to) continue;
      if (adj[m] && adj[m][to] != null) {
        var sc2 = hn[m] * adj[m][to];
        found.push({ path: [hub, m, to], score: sc2, direct: false,
          edges: [{ a: hub, b: m, s: hn[m] }, { a: m, b: to, s: adj[m][to] }] });
      }
    }
    // depth 3: hub -> M -> N -> to  (only if no depth-2 route, to avoid noise)
    if (found.length === 0 && maxDepth >= 3) {
      for (var m2 in hn) {
        if (m2 === to) continue;
        var mn = adj[m2]; if (!mn) continue;
        for (var nn in mn) {
          if (nn === to || nn === hub || nn === m2) continue;
          if (adj[nn] && adj[nn][to] != null) {
            var sc3 = hn[m2] * mn[nn] * adj[nn][to];
            found.push({ path: [hub, m2, nn, to], score: sc3, direct: false,
              edges: [{ a: hub, b: m2, s: hn[m2] }, { a: m2, b: nn, s: mn[nn] },
                      { a: nn, b: to, s: adj[nn][to] }] });
          }
        }
      }
    }
    found.sort(function (a, b) { return b.score - a.score; });
    // dedupe by path signature
    var seen = {}, uniq = [];
    for (var i = 0; i < found.length && uniq.length < top; i++) {
      var sig = found[i].path.join(">");
      if (seen[sig]) continue; seen[sig] = 1; uniq.push(found[i]);
    }
    return uniq;
  }
  function path(D, hub, to) { var r = routes(D, hub, to, { top: 1 }); return r.length ? r[0] : null; }

  // ---------------------------------------------------------------- analyse ----
  // scoped, attributed node list (each node's hubs + per-hub composites).
  function analyse(D, hubSel) {
    var out = [];
    for (var i = 0; i < D.nodes.length; i++) {
      var n = D.nodes[i];
      var inScope = hubSel === "Both" ? true
        : (hubSel === "CTBP1" ? n.s1 != null : n.s2 != null);
      if (!inScope) continue;
      var c1 = n.s1 ? connection(D, n, "CTBP1") : null;
      var c2 = n.s2 ? connection(D, n, "CTBP2") : null;
      var comps = [];
      if (hubSel === "CTBP1") { if (c1) comps.push(c1.composite); }
      else if (hubSel === "CTBP2") { if (c2) comps.push(c2.composite); }
      else { if (c1) comps.push(c1.composite); if (c2) comps.push(c2.composite); }
      var headline = comps.length ? Math.max.apply(null, comps) : 0;
      var attr = (n.s1 && n.s2) ? "shared" : (n.s1 ? "CTBP1" : "CTBP2");
      var dom = dominant(n), sec = dominantSector(n);
      out.push({
        sym: n.sym, node: n, hubs: n.hubs || [], attribution: attr,
        conn: { CTBP1: c1, CTBP2: c2 }, composite: headline,
        type: { CTBP1: c1 ? c1.type : null, CTBP2: c2 ? c2.type : null },
        themes: themesFor(n), dominant: dom, dominantSector: sec, mech: mechFor(n)
      });
    }
    out.sort(function (a, b) { return b.composite - a.composite; });
    return out;
  }

  // ---------------------------------------------------------------- summaries --
  function themeSummary(D, hubSel) {
    var rows = analyse(D, hubSel), counts = {}, k;
    for (k = 0; k < THEME_ORDER.length; k++) counts[THEME_ORDER[k]] = 0;
    for (var i = 0; i < rows.length; i++)
      for (var t = 0; t < rows[i].themes.length; t++) counts[rows[i].themes[t].key]++;
    return counts;
  }
  function themeExposure(D, hubSel) {
    var counts = themeSummary(D, hubSel), arr = [];
    for (var k in counts) if (counts[k] > 0) arr.push({ key: k, label: THEMES[k].label, count: counts[k] });
    arr.sort(function (a, b) { return b.count - a.count; });
    return arr;
  }

  function findings(D, hubSel) {
    var rows = analyse(D, hubSel), out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      for (var t = 0; t < r.themes.length; t++) {
        var f = r.themes[t];
        out.push({ sym: r.sym, node: r.node, hubs: r.hubs, attribution: r.attribution,
          area: f.key, label: f.label, theme: f.theme, kind: f.kind, sev: f.sev,
          strength: f.strength, top: f.top, matches: f.matches, composite: r.composite });
      }
    }
    out.sort(function (a, b) { return b.sev - a.sev || b.strength - a.strength; });
    return out;
  }

  // blended, de-duplicated, diversity-capped discovery feed.
  function discoveries(D, hubSel) {
    var rows = analyse(D, hubSel), used = {}, feed = [];
    function take(r, category, reason) {
      if (!r || used[r.sym]) return false;
      used[r.sym] = 1;
      feed.push({ sym: r.sym, node: r.node, category: category, reason: reason,
        attribution: r.attribution, composite: r.composite, dominant: r.dominant, hubs: r.hubs });
      return true;
    }
    var byComp = rows.slice().sort(function (a, b) { return b.composite - a.composite; });
    var i, n;
    // 1. strongest connections
    for (i = 0, n = 0; i < byComp.length && n < 6; i++)
      if (take(byComp[i], "Strongest connections", "Top composite " + byComp[i].composite + "/100")) n++;
    // 2. best exemplar per disease area
    for (var t = 0; t < THEME_ORDER.length; t++) {
      var key = THEME_ORDER[t], best = null;
      for (i = 0; i < rows.length; i++) {
        if (used[rows[i].sym]) continue;
        var has = null;
        for (var j = 0; j < rows[i].themes.length; j++) if (rows[i].themes[j].key === key) has = rows[i].themes[j];
        if (has && (!best || has.strength > best.s)) best = { r: rows[i], s: has.strength };
      }
      if (best) take(best.r, "Disease-area exemplar", "Leading " + THEMES[key].label + " partner");
    }
    // 3. most co-mentioned (literature)
    var byLit = rows.slice().sort(function (a, b) {
      return litOf(b) - litOf(a);
    });
    for (i = 0, n = 0; i < byLit.length && n < 4; i++)
      if (!STOPLIST[byLit[i].sym] && take(byLit[i], "Most co-mentioned", "Rich CtBP co-mention literature")) n++;
    // 4. under-explored hypotheses: strong physical, thin literature
    var hyp = rows.slice().filter(function (r) {
      var c = bestConn(r); return c && c.phys >= 0.4 && c.lit < 0.25;
    }).sort(function (a, b) { return bestConn(b).phys - bestConn(a).phys; });
    for (i = 0, n = 0; i < hyp.length && n < 4; i++)
      if (take(hyp[i], "Under-explored", "Strong physical evidence, thin literature")) n++;
    // 5. Both mode: paralog contrasts (shared vs divergent)
    if (hubSel === "Both") {
      var div = rows.slice().filter(function (r) {
        var a = r.conn.CTBP1, b = r.conn.CTBP2;
        if (r.attribution !== "shared") return r.attribution === "CTBP1" || r.attribution === "CTBP2";
        return a && b && Math.abs(a.composite - b.composite) >= 20;
      }).sort(function (a, b) { return b.composite - a.composite; });
      for (i = 0, n = 0; i < div.length && n < 6; i++) {
        var r = div[i], reason;
        if (r.attribution === "shared") reason = "Divergent wiring: CTBP1 " + r.conn.CTBP1.composite + " vs CTBP2 " + r.conn.CTBP2.composite;
        else reason = r.attribution + "-specific partner";
        take(r, "Paralog contrast", reason);
      }
    }
    return feed;
  }
  function litOf(r) { return Math.max(num(r.node.lit1), num(r.node.lit2)); }
  function bestConn(r) {
    var a = r.conn.CTBP1, b = r.conn.CTBP2;
    if (a && b) return a.composite >= b.composite ? a : b;
    return a || b;
  }

  function synthesis(D, hubSel) {
    var nb = D.meta.neighborhood;
    var lead, body;
    if (hubSel === "Both") {
      lead = "CtBP1 and CtBP2: " + nb.shared + " shared partners, " +
             (nb.CTBP1 - nb.shared) + " CTBP1-only, " + (nb.CTBP2 - nb.shared) + " CTBP2-only";
      body = "The two paralogous NAD(H)-sensing transcriptional corepressors share a common " +
             "interactor core (" + nb.shared + " genes both hubs contact) while each also keeps a " +
             "paralog-specific set. Shared partners are the likely common corepressor machinery; " +
             "divergent ones are where the paralogs' wiring differs.";
    } else {
      var count = hubSel === "CTBP1" ? nb.CTBP1 : nb.CTBP2;
      lead = hubSel + ": top-250 STRING interactome (" + count + " resolved partners)";
      body = hubSel + " is one of the two paralogous NAD(H)-sensing transcriptional corepressors of " +
             "the CtBP family. Its neighbourhood is dominated by chromatin-modifying and " +
             "transcriptional-repression machinery; disease-area memberships below are derived from " +
             "each partner's own Open Targets / GenAge evidence, not from the hub.";
    }
    return { lead: lead, body: body };
  }

  var ENGINE = {
    HUBS: HUBS, STOPLIST: STOPLIST, W: W,
    THEMES: THEMES, THEME_ORDER: THEME_ORDER, MECH: MECH,
    prep: prep, connection: connection, classify: classify,
    themesFor: themesFor, dominant: dominant, dominantSector: dominantSector, mechFor: mechFor,
    floored: floored, analyse: analyse, path: path, routes: routes,
    discoveries: discoveries, themeSummary: themeSummary, themeExposure: themeExposure,
    synthesis: synthesis, findings: findings, num: num, clamp: clamp
  };
  function round4(x) { return Math.round(x * 10000) / 10000; }

  if (typeof module !== "undefined" && module.exports) module.exports = ENGINE;
  root.CTBP_ENGINE = ENGINE;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
