/*
 * engine.js — CTBP INTERACTOME ATLAS inference engine (§6).
 *
 * A pure module: no DOM, no network. It receives only window.CTBP_DATA and
 * derives connection scores, connection types, disease/aging field memberships,
 * mechanism tags, paths/routes, discoveries, synthesis and findings.
 *
 * It is SYMMETRIC in the two hubs: every hub-relative computation takes a hub
 * argument ('CTBP1' | 'CTBP2') and reads that hub's fields (s1/s2, lit1/lit2,
 * rank1/rank2, comention1/comention2). The ONLY fixed gene-ish tokens are the
 * two subject hubs (HUBS) and the documented literature stop-list. No partner
 * gene is ever special-cased.
 *
 * Exposes window.CTBP_ENGINE (also globalThis.CTBP_ENGINE for the Node harness).
 */
(function () {
  'use strict';

  // ── fixed tokens ─────────────────────────────────────────────────────────
  var HUBS = ['CTBP1', 'CTBP2'];
  var STOPLIST = { IMPACT: 1, GAPDH: 1, TBP: 1, ACTB: 1, B2M: 1 };

  // composite weights are FIXED constants (no UI sliders), §6.1
  var WT = { phys: 0.5, lit: 0.3, ctx: 0.2 };

  // disease-name floor (§6.3)
  var FLOOR_HARD = 0.18;     // a disease counts at s ≥ 0.18, OR
  var FLOOR_TOP3 = 0.10;     // top-3 association AND s ≥ 0.10
  var OT_AREA_THRESHOLD = 0.15;

  // ── the ten fields (§6.3). `kind`: ot | name | aging. First five are sectors. ──
  var THEMES = {
    oncology: {
      label: 'Oncology', color: '#e11d48', sector: true, kind: 'ot',
      efo: ['cancer or benign tumor'], threshold: OT_AREA_THRESHOLD,
      re: /(cancer|carcinoma|tumou?r|neoplasm|lymphoma|leukem|leukaem|melanoma|sarcoma|glioma|blastoma|malignan|adenoma)/i,
      rule: 'EFO "cancer or benign tumor" association-score sum > 0.15'
    },
    metabolic: {
      label: 'Metabolic disease', color: '#0d9488', sector: true, kind: 'ot',
      // OT renamed several areas "… disease" → "… disorder"; key on both so membership
      // tracks the live data (a node only ever carries one variant).
      efo: ['nutritional or metabolic disease', 'endocrine system disease', 'endocrine system disorder'], threshold: OT_AREA_THRESHOLD,
      re: /(diabet|obes|metaboli|lipid|cholesterol|insulin|glucose|endocrine|thyroid|adipos)/i,
      rule: 'EFO "nutritional or metabolic disease" + "endocrine system disease/disorder" sum > 0.15'
    },
    neurodegen: {
      label: 'Neurodegeneration', color: '#d97706', sector: true, kind: 'name',
      re: /(alzheimer|parkinson|amyotrophic|\bALS\b|huntington|dementia|neurodegener|frontotemporal|tauopath|prion|spinocerebellar|motor neuron)/i,
      rule: 'OT disease names match Alzheimer / Parkinson / ALS / Huntington / dementia / …'
    },
    cns: {
      label: 'CNS / neuroscience', color: '#7c3aed', sector: true, kind: 'ot',
      efo: ['nervous system disease', 'nervous system disorder', 'psychiatric disorder'], threshold: OT_AREA_THRESHOLD,
      re: /(epilep|seizure|schizophren|bipolar|depress|anxiety|psychiat|neuropath|migraine|ataxia|nervous system)/i,
      rule: 'EFO "nervous system disease/disorder" + "psychiatric disorder" sum > 0.15'
    },
    neurodev: {
      label: 'Neurodevelopment (incl. ASD)', color: '#2563eb', sector: true, kind: 'name',
      re: /(autism|\bASD\b|intellectual disability|developmental delay|developmental disorder|developmental and epileptic|\bDEE\b|neurodevelopment|global developmental)/i,
      rule: 'OT names match autism/ASD + intellectual disability + developmental delay + DEE'
    },
    aging: {
      label: 'Aging / longevity', color: '#ca8a04', sector: false, kind: 'aging', halo: true,
      rule: 'node.aging present (GenAge ∪ LongevityMap)'
    },
    immunity: {
      label: 'Immunity', color: '#16a34a', sector: false, kind: 'ot',
      efo: ['immune system disease', 'immune system disorder'], threshold: OT_AREA_THRESHOLD,
      re: /(immun|autoimmun|inflammat|arthritis|lupus|colitis|psoriasis|allerg)/i,
      rule: 'EFO "immune system disease/disorder" sum > 0.15'
    },
    cardiovascular: {
      label: 'Cardiovascular', color: '#db2777', sector: false, kind: 'ot',
      efo: ['cardiovascular disease', 'cardiovascular disorder'], threshold: OT_AREA_THRESHOLD,
      re: /(cardio|cardiac|heart|coronary|myocard|arrhythm|atheroscler|hypertens|vascular|aneurysm)/i,
      rule: 'EFO "cardiovascular disease/disorder" sum > 0.15'
    },
    hematologic: {
      label: 'Hematologic (blood)', color: '#c2410c', sector: false, kind: 'ot',
      efo: ['hematologic disease', 'hematologic disorder'], threshold: OT_AREA_THRESHOLD,
      re: /(anemi|anaemi|thromb|hemato|haemato|leukem|leukaem|coagulat|platelet|blood)/i,
      rule: 'EFO "hematologic disease/disorder" sum > 0.15'
    },
    eye: {
      label: 'Eye / vision', color: '#0891b2', sector: false, kind: 'ot',
      efo: ['disorder of visual system'], threshold: OT_AREA_THRESHOLD,
      re: /(retin|macular|glaucoma|cataract|vision|visual|ocular|cornea|optic|blind)/i,
      rule: 'EFO "disorder of visual system" sum > 0.15'
    }
  };
  var THEME_ORDER = ['oncology', 'metabolic', 'neurodegen', 'cns', 'neurodev',
    'aging', 'immunity', 'cardiovascular', 'hematologic', 'eye'];
  var SECTORS = THEME_ORDER.filter(function (k) { return THEMES[k].sector; });

  // ── mechanism tags (§6.4) — keyword matches against function text ──────────
  var MECH = [
    { key: 'redox', label: 'NAD⁺ / redox', re: /NAD\(?\+?\)?|NADH|oxidoreductase|dehydrogenase|sirtuin|\bredox\b/i },
    { key: 'chromatin', label: 'Chromatin', re: /chromatin|histone|nucleosome|methyltransferase|acetyltransferase|\bHDAC\b|deacetylase|demethylase/i },
    { key: 'repress', label: 'Transcriptional repression', re: /co-?repress|repressor|repression|silencing|transcriptional regulat/i },
    { key: 'wnt', label: 'Wnt / EMT', re: /\bWnt\b|beta-?catenin|β-?catenin|epithelial[- ]mesenchymal|\bEMT\b/i },
    { key: 'synaptic', label: 'Synaptic', re: /synap|neurotransmitter|ribbon synapse|presynap|postsynap|neuronal/i },
    { key: 'apoptosis', label: 'Apoptosis', re: /apopto|programmed cell death|pro-?apoptotic|anti-?apoptotic|\bBcl-?2\b/i }
  ];

  // ── numeric helpers ────────────────────────────────────────────────────────
  function num(x) { return (typeof x === 'number' && isFinite(x)) ? x : 0; }
  function clamp(x, lo, hi) { lo = (lo == null ? 0 : lo); hi = (hi == null ? 1 : hi); return Math.max(lo, Math.min(hi, x)); }
  function round(x, n) { var p = Math.pow(10, n == null ? 3 : n); return Math.round(x * p) / p; }

  function hubScore(node, hub) { return hub === 'CTBP1' ? node.s1 : node.s2; }
  function hubLit(node, hub) { return hub === 'CTBP1' ? node.lit1 : node.lit2; }
  function hubRank(node, hub) { return hub === 'CTBP1' ? node.rank1 : node.rank2; }
  function hubComention(node, hub) { return hub === 'CTBP1' ? node.comention1 : node.comention2; }
  function hubsOf(node) { var o = []; for (var i = 0; i < HUBS.length; i++) if (hubScore(node, HUBS[i])) o.push(HUBS[i]); return o; }
  function attributionOf(node) { var h = hubsOf(node); return h.length === 2 ? 'shared' : (h[0] + '-only'); }

  // ── normalisation constants + adjacency (memoised on the data object) ───────
  function ctxMap(W) {
    if (W.__ctx) return W.__ctx;
    var m = {};
    var edges = W.edges || [];
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      m[e.a] = (m[e.a] || 0) + num(e.s);
      m[e.b] = (m[e.b] || 0) + num(e.s);
    }
    W.__ctx = m; return m;
  }
  function norms(W) {
    if (W.__norms) return W.__norms;
    var ctx = ctxMap(W), maxlit = 1, maxctx = 1, k;
    for (var i = 0; i < W.nodes.length; i++) {
      var n = W.nodes[i];
      for (var h = 0; h < HUBS.length; h++) {
        if (hubScore(n, HUBS[h])) {
          var l = STOPLIST[n.sym] ? 0 : num(hubLit(n, HUBS[h]));
          if (l > maxlit) maxlit = l;
        }
      }
    }
    for (k in ctx) if (ctx[k] > maxctx) maxctx = ctx[k];
    W.__norms = { maxlit: maxlit, maxctx: maxctx }; return W.__norms;
  }
  function adjacency(W) {
    if (W.__adj) return W.__adj;
    var m = {}, edges = W.edges || [];
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      (m[e.a] || (m[e.a] = [])).push([e.b, num(e.s)]);
      (m[e.b] || (m[e.b] = [])).push([e.a, num(e.s)]);
    }
    W.__adj = m; return m;
  }
  function hubNeighbors(W, hub) {
    W.__hn = W.__hn || {};
    if (W.__hn[hub]) return W.__hn[hub];
    var m = {};
    for (var i = 0; i < W.nodes.length; i++) {
      var s = hubScore(W.nodes[i], hub);
      if (s) m[W.nodes[i].sym] = num(s.c);
    }
    W.__hn[hub] = m; return m;
  }

  // ── 6.1 connection score (per hub) ──────────────────────────────────────────
  function connection(W, node, hub) {
    var s = hubScore(node, hub);
    if (!s) return null;
    var N = norms(W);
    var phys = clamp(num(s.e) + 0.5 * num(s.d));
    var litEff = STOPLIST[node.sym] ? 0 : num(hubLit(node, hub));
    var lit = Math.log10(litEff + 1) / Math.log10(N.maxlit + 1);
    var ctxRaw = ctxMap(W)[node.sym] || 0;
    var ctx = clamp(ctxRaw / N.maxctx);
    var composite = 100 * (WT.phys * phys + WT.lit * lit + WT.ctx * ctx) / (WT.phys + WT.lit + WT.ctx);
    var type = classify(node, { s: s, phys: phys, lit: lit, ctx: ctx });
    return {
      hub: hub, phys: round(phys), lit: round(lit), ctx: round(ctx),
      ctxRaw: round(ctxRaw), composite: round(composite, 1), type: type,
      litEff: litEff, stoplisted: !!STOPLIST[node.sym], s: s
    };
  }

  // ── 6.2 connection type (keys off physical evidence, never DB alone) ────────
  function classify(node, sc) {
    var s = sc.s, ia = node.intact;
    var iaDirect = !!(ia && ia.direct);
    var iaPhys = !!(ia && (ia.direct || /physical association|direct interaction/i.test(ia.type || '')));
    // BioGRID layer is already curated to human, physical, yeast-two-hybrid-excluded
    // evidence (data §8), so a non-empty count is physical support (not the DB channel).
    var bgPhys = !!(node.biogrid && node.biogrid.count > 0);
    if (num(s.c) >= 0.9 && (num(s.e) >= 0.5 || iaDirect)) return 'Core complex';
    if (num(s.e) >= 0.2 || iaPhys || bgPhys) return 'Physical interactor';
    if (sc.lit >= 0.6 && sc.phys < 0.45) return 'Literature-linked';
    if (sc.ctx >= 0.45 && sc.phys < 0.45) return 'Functional neighbour';
    return 'Associated';
  }

  // ── 6.3 disease/aging fields (membership is 100% data-driven) ───────────────
  function diseaseMatches(node, re) {
    var dis = node.dis || [], top3 = {}, out = [];
    for (var i = 0; i < dis.length && i < 3; i++) top3[dis[i].n] = 1;
    for (var j = 0; j < dis.length; j++) {
      var d = dis[j];
      if (!re.test(d.n)) continue;
      if (num(d.s) >= FLOOR_HARD || (top3[d.n] && num(d.s) >= FLOOR_TOP3)) out.push(d);
    }
    out.sort(function (a, b) { return num(b.s) - num(a.s); });
    return out;
  }
  function areaSum(node, efo) { var a = node.areas || {}, s = 0; for (var i = 0; i < efo.length; i++) s += num(a[efo[i]]); return s; }
  function totalBurden(node) { var a = node.areas || {}, s = 0; for (var k in a) s += num(a[k]); return s; }

  function fieldsFor(node) {
    var out = [];
    for (var t = 0; t < THEME_ORDER.length; t++) {
      var key = THEME_ORDER[t], th = THEMES[key];
      var member = false, strength = 0, source = null, top = null, matches = [];
      if (th.kind === 'ot') {
        var sum = areaSum(node, th.efo);
        if (sum > th.threshold) {
          member = true;
          var burden = totalBurden(node) || sum;
          strength = clamp(sum / burden);
          matches = th.re ? diseaseMatches(node, th.re) : [];
          var ex = matches[0];
          top = { areaSum: round(sum), efo: th.efo.slice() };
          if (ex) { top.disease = ex.n; top.score = round(num(ex.s)); }
          source = { label: 'Open Targets', url: otAssocURL(node) };
        }
      } else if (th.kind === 'name') {
        matches = diseaseMatches(node, th.re);
        if (matches.length) {
          member = true; strength = num(matches[0].s);
          top = { disease: matches[0].n, score: round(num(matches[0].s)) };
          source = { label: 'Open Targets', url: otAssocURL(node) };
        }
      } else if (th.kind === 'aging') {
        if (node.aging) {
          member = true; strength = node.aging.genage ? 0.6 : 0.45;
          top = { why: node.aging.why, id: node.aging.id || null, pmids: node.aging.pmids || [] };
          source = agingSource(node);
        }
      }
      if (member) {
        out.push({
          key: key, label: th.label, theme: key, sector: !!th.sector, kind: th.kind,
          strength: round(strength), sev: clamp(Math.round(strength * 3), 1, 3),
          source: source, top: top, matches: matches
        });
      }
    }
    return out;
  }

  // dominant DISEASE area (drives chip/card colour); aging excluded unless it is
  // the only membership. Sector dominant (drives constellation wedge+fill) below.
  function dominant(fields) {
    var dz = fields.filter(function (f) { return f.key !== 'aging'; });
    if (dz.length) { dz.sort(function (a, b) { return b.strength - a.strength; }); return dz[0].key; }
    if (fields.some(function (f) { return f.key === 'aging'; })) return 'aging';
    return null;
  }
  function dominantSector(fields) {
    var sec = fields.filter(function (f) { return f.sector; });
    if (!sec.length) return null;
    sec.sort(function (a, b) { return b.strength - a.strength; });
    return sec[0].key;
  }

  function mechFor(node) {
    var txt = node.func || '', out = [];
    for (var i = 0; i < MECH.length; i++) if (MECH[i].re.test(txt)) out.push({ key: MECH[i].key, label: MECH[i].label });
    return out;
  }

  // ── provenance URL builders (pure strings, no DOM) ──────────────────────────
  function otAssocURL(node) { return 'https://platform.opentargets.org/target/' + node.ensembl + '/associations'; }
  function agingSource(node) {
    if (!node.aging) return null;
    if (node.aging.genage) {
      return { label: 'GenAge', url: node.aging.id
        ? 'https://genomics.senescence.info/genes/details.php?id=' + node.aging.id
        : 'https://genomics.senescence.info/genes/search.php?search=' + encodeURIComponent(node.sym) };
    }
    return { label: 'LongevityMap', url: 'https://genomics.senescence.info/longevity/search.php?search=' + encodeURIComponent(node.sym) };
  }

  // ── 6.5 paths / routes (depth ≤ 3; direct always wins) ──────────────────────
  function routes(W, hub, to, opts) {
    opts = opts || {};
    var maxDepth = opts.maxDepth || 3, top = opts.top || 4;
    var hn = hubNeighbors(W, hub);
    if (hn[to] != null) {
      return [{ direct: true, score: round(hn[to]), hops: [{ from: hub, to: to, score: round(hn[to]), kind: 'hub' }] }];
    }
    var A = adjacency(W), found = [];
    // hub → M → to
    for (var M in hn) {
      var e1 = hn[M], nb1 = A[M] || [];
      for (var i = 0; i < nb1.length; i++) {
        if (nb1[i][0] === to) {
          found.push({ direct: false, score: e1 * nb1[i][1], hops: [
            { from: hub, to: M, score: round(e1), kind: 'hub' },
            { from: M, to: to, score: round(nb1[i][1]), kind: 'edge' }] });
        }
      }
    }
    // hub → M → N → to (only when no single intermediary bridges them)
    if (maxDepth >= 3 && found.length === 0) {
      for (var M2 in hn) {
        var ea = hn[M2], nbA = A[M2] || [];
        for (var a = 0; a < nbA.length; a++) {
          var N = nbA[a][0]; if (N === to || N === M2) continue;
          var nbB = A[N] || [];
          for (var b = 0; b < nbB.length; b++) {
            if (nbB[b][0] === to) {
              found.push({ direct: false, score: ea * nbA[a][1] * nbB[b][1], hops: [
                { from: hub, to: M2, score: round(ea), kind: 'hub' },
                { from: M2, to: N, score: round(nbA[a][1]), kind: 'edge' },
                { from: N, to: to, score: round(nbB[b][1]), kind: 'edge' }] });
            }
          }
        }
      }
    }
    found.sort(function (x, y) { return y.score - x.score; });
    var seen = {}, out = [];
    for (var f = 0; f < found.length; f++) {
      var sig = found[f].hops.map(function (h) { return h.to; }).join('>');
      if (seen[sig]) continue; seen[sig] = 1;
      found[f].score = round(found[f].score);
      out.push(found[f]);
      if (out.length >= top) break;
    }
    return out;
  }
  function path(W, hub, to) { var r = routes(W, hub, to, { top: 1 }); return r[0] || null; }

  // ── analyse: scoped, attributed node list sorted by composite ───────────────
  function analyse(W, hubSel) {
    hubSel = hubSel || 'Both';
    var sel = hubSel === 'Both' ? HUBS : [hubSel];
    var out = [];
    for (var i = 0; i < W.nodes.length; i++) {
      var n = W.nodes[i];
      var inScope = sel.some(function (h) { return hubScore(n, h); });
      if (!inScope) continue;
      var conn = {}, headline = 0;
      for (var h = 0; h < HUBS.length; h++) {
        var hub = HUBS[h];
        var c = hubScore(n, hub) ? connection(W, n, hub) : null;
        conn[hub] = c;
        if (c && sel.indexOf(hub) >= 0) headline = Math.max(headline, c.composite);
      }
      var fields = fieldsFor(n);
      out.push({
        sym: n.sym, name: n.name, node: n, hubs: hubsOf(n),
        attribution: attributionOf(n), conn: conn, composite: round(headline, 1),
        fields: fields, dominant: dominant(fields), dominantSector: dominantSector(fields),
        mech: mechFor(n), ctxRaw: round(ctxMap(W)[n.sym] || 0)
      });
    }
    out.sort(function (a, b) { return b.composite - a.composite; });
    return out;
  }

  // ── discoveries: blended, de-duplicated, diversity-capped feed ──────────────
  function litCount(o) { var m = 0; for (var h = 0; h < HUBS.length; h++) { var c = o.conn[HUBS[h]]; if (c) m = Math.max(m, c.litEff); } return m; }
  function maxPhys(o) { var m = 0; for (var h = 0; h < HUBS.length; h++) { var c = o.conn[HUBS[h]]; if (c) m = Math.max(m, c.phys); } return m; }
  function fieldStrength(o, key) { var f = o.fields.filter(function (x) { return x.key === key; })[0]; return f ? f.strength : 0; }
  function divergence(o) {
    var a = o.conn.CTBP1, b = o.conn.CTBP2;
    if (a && b) return Math.abs(a.composite - b.composite);
    return (a || b).composite;  // present with one hub only ⇒ maximally divergent
  }

  function discoveries(W, hubSel) {
    var A = analyse(W, hubSel), used = {}, picks = [];
    function add(o, reason) { if (!o || used[o.sym]) return; used[o.sym] = 1; var c = {}; for (var k in o) c[k] = o[k]; c.reason = reason; picks.push(c); }

    A.slice(0, 8).forEach(function (o) { add(o, 'Strongest connection'); });

    for (var t = 0; t < THEME_ORDER.length; t++) {
      var key = THEME_ORDER[t];
      var members = A.filter(function (o) { return o.fields.some(function (f) { return f.key === key; }); })
        .sort(function (a, b) { return fieldStrength(b, key) - fieldStrength(a, key); });
      if (members.length) add(members[0], THEMES[key].label + ' exemplar');
    }

    A.slice().sort(function (a, b) { return litCount(b) - litCount(a); }).slice(0, 4)
      .forEach(function (o) { if (litCount(o) > 0) add(o, 'Most co-mentioned'); });

    A.filter(function (o) { return maxPhys(o) >= 0.45 && litCount(o) <= 60; })
      .sort(function (a, b) { return maxPhys(b) - maxPhys(a); }).slice(0, 4)
      .forEach(function (o) { add(o, 'Under-explored (strong physical, thin literature)'); });

    if (hubSel === 'Both') {
      A.filter(function (o) { return o.attribution === 'shared'; }).slice(0, 4)
        .forEach(function (o) { add(o, 'Shared by both paralogs'); });
      A.filter(function (o) { return o.attribution !== 'shared' || divergence(o) >= 18; })
        .sort(function (a, b) { return divergence(b) - divergence(a); }).slice(0, 5)
        .forEach(function (o) { add(o, 'Paralog-divergent'); });
    }
    return picks.slice(0, 24);
  }

  // ── theme roll-ups & findings ───────────────────────────────────────────────
  function themeSummary(W, hubSel) {
    var A = analyse(W, hubSel), sum = {};
    for (var t = 0; t < THEME_ORDER.length; t++) {
      var key = THEME_ORDER[t];
      var members = A.filter(function (o) { return o.fields.some(function (f) { return f.key === key; }); });
      sum[key] = { key: key, label: THEMES[key].label, color: THEMES[key].color, sector: !!THEMES[key].sector, count: members.length, rule: THEMES[key].rule };
    }
    return sum;
  }
  function themeExposure(W, hubSel) {
    var s = themeSummary(W, hubSel), arr = [];
    for (var k in s) arr.push(s[k]);
    arr.sort(function (a, b) { return b.count - a.count; });
    return arr;
  }
  function findings(W, hubSel) {
    var A = analyse(W, hubSel), rows = [];
    for (var i = 0; i < A.length; i++) {
      var o = A[i];
      for (var f = 0; f < o.fields.length; f++) {
        var fl = o.fields[f];
        rows.push({
          sym: o.sym, name: o.name, ensembl: o.node.ensembl, hubs: o.hubs,
          attribution: o.attribution, composite: o.composite,
          key: fl.key, label: fl.label, color: THEMES[fl.key].color, sector: fl.sector,
          strength: fl.strength, sev: fl.sev, source: fl.source, top: fl.top, matches: fl.matches
        });
      }
    }
    rows.sort(function (a, b) { return (b.sev - a.sev) || (b.strength - a.strength) || (b.composite - a.composite); });
    return rows;
  }

  // ── synthesis: data-derived lead + body (factual) ───────────────────────────
  function synthesis(W, hubSel) {
    var A = analyse(W, hubSel);
    var exp = themeExposure(W, hubSel).filter(function (e) { return e.count > 0; });
    var topAreas = exp.slice(0, 3).map(function (e) { return e.label + ' (' + e.count + ')'; });
    var lead, body;
    if (hubSel === 'Both') {
      var shared = A.filter(function (o) { return o.attribution === 'shared'; }).length;
      var c1 = A.filter(function (o) { return o.attribution === 'CTBP1-only'; }).length;
      var c2 = A.filter(function (o) { return o.attribution === 'CTBP2-only'; }).length;
      lead = 'CtBP1 and CtBP2 are paralogous NAD(H)-sensing transcriptional corepressors.';
      body = 'Across the combined interactome, ' + shared + ' partners are shared by both paralogs, '
        + c1 + ' connect to CTBP1 only and ' + c2 + ' to CTBP2 only. '
        + (topAreas.length ? 'The most-populated disease lenses are ' + topAreas.join(', ') + '. ' : '')
        + 'Shared partners are the likely common corepressor core; the divergent sets are the paralog-specific leads.';
    } else {
      lead = hubSel + ' is an NAD(H)-sensing transcriptional corepressor of the CtBP family.';
      body = 'Its ' + A.length + ' top STRING partners span '
        + (topAreas.length ? ('the ' + topAreas.join(', ') + ' lenses') : 'several disease lenses') + '. '
        + 'Connection strength blends physical evidence, co-mention literature and network context (weights 0.5 / 0.3 / 0.2).';
    }
    return { lead: lead, body: body };
  }

  // ── export ───────────────────────────────────────────────────────────────────
  var API = {
    HUBS: HUBS, STOPLIST: STOPLIST, WEIGHTS: WT, THEMES: THEMES,
    THEME_ORDER: THEME_ORDER, SECTORS: SECTORS, MECH: MECH,
    num: num, clamp: clamp, round: round,
    hubScore: hubScore, hubLit: hubLit, hubRank: hubRank, hubComention: hubComention,
    hubsOf: hubsOf, attributionOf: attributionOf,
    connection: connection, classify: classify, fieldsFor: fieldsFor,
    dominant: dominant, dominantSector: dominantSector, mechFor: mechFor,
    diseaseMatches: diseaseMatches, areaSum: areaSum, totalBurden: totalBurden,
    routes: routes, path: path, analyse: analyse, discoveries: discoveries,
    themeSummary: themeSummary, themeExposure: themeExposure,
    synthesis: synthesis, findings: findings,
    norms: norms, ctxMap: ctxMap, adjacency: adjacency, hubNeighbors: hubNeighbors,
    otAssocURL: otAssocURL, agingSource: agingSource
  };
  var root = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
  root.CTBP_ENGINE = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
