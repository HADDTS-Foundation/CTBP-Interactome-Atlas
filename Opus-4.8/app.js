/*
 * app.js — CTBP INTERACTOME ATLAS front end (§7).
 *
 * Rendering, interaction, the drawer, the five views, discoveries and export.
 * Reads window.CTBP_DATA + window.CTBP_ENGINE. Owns the hub selection
 * (CTBP1 / CTBP2 / Both, default Both) and the focus-gene state. No scoring
 * lives here; all of that is in engine.js.
 *
 * Provenance-first: every shown value carries a click-through to the live record,
 * and any value that is itself a link carries a trailing ↗. Human voice: no
 * spaced em dash as a sentence connector in user-facing copy.
 */
(function () {
  'use strict';
  var D = window.CTBP_DATA, EN = window.CTBP_ENGINE;

  // ── state ───────────────────────────────────────────────────────────────
  // `focus` = the route/network focus gene (set only via focusGene). `selected` =
  // the gene whose dossier is open (for the constellation highlight). Keeping these
  // separate is essential: opening a dossier must NOT imply focus mode, or a real
  // double-click (which fires click→dossier first) would toggle the focus it just set.
  var state = { hub: 'Both', focus: null, selected: null, lens: null, limit: 80, view: 'constellation' };
  var drawer = { mode: 'hub' };           // 'hub' | 'gene' | 'lens'
  var analysed = [];                       // EN.analyse(D, state.hub)
  var bySym = {};                          // sym -> node

  var HUB_SYN = { CTBP1: ['CTBP1', 'CtBP1'], CTBP2: ['CTBP2', 'CtBP2'] };
  var LNCRNA = ['CTBP1-AS2', 'CTBP1-DT', 'CTBP1-AS1'];
  var CLINVAR_TERMS = {
    plp: '{s}[gene] AND (clinsig_pathogenic[Filter] OR clinsig_likely_path[Filter])',
    vus: '{s}[gene] AND clinsig_vus[Filter]',
    total: '{s}[gene]'
  };

  // ── tiny DOM helpers ────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function fmtN(x) { return (x == null) ? '—' : Number(x).toLocaleString('en-US'); }
  function fmtC(x) { return (x == null) ? '—' : Number(x).toFixed(1); }
  function fmtS(x) { return (x == null) ? '—' : Number(x).toFixed(3); }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  // ── link builders (must reproduce the pipeline's queries, §5/§8) ──────────
  var L = {
    pubmed: function (p) { return 'https://pubmed.ncbi.nlm.nih.gov/' + p; },
    ensembl: function (g) { return 'https://www.ensembl.org/Homo_sapiens/Gene/Summary?g=' + g; },
    ncbiGene: function (e) { return 'https://www.ncbi.nlm.nih.gov/gene/' + e; },
    uniprot: function (a) { return 'https://www.uniprot.org/uniprotkb/' + a + '/entry'; },
    omim: function (m) { return 'https://www.omim.org/entry/' + m; },
    ot: function (g) { return 'https://platform.opentargets.org/target/' + g + '/associations'; },
    otDisease: function (g) { return 'https://platform.opentargets.org/target/' + g + '/associations'; },
    intact: function (s) { return 'https://www.ebi.ac.uk/intact/search?query=' + encodeURIComponent(s); },
    monarch: function (e) { return 'https://monarchinitiative.org/NCBIGene:' + e; },
    hpoApi: function (e) { return 'https://ontology.jax.org/api/network/annotation/NCBIGene:' + e; },
    reactome: function (name) { return 'https://reactome.org/content/query?q=' + encodeURIComponent(name) + '&species=Homo+sapiens'; },
    stringPair: function (a, b) { return 'https://string-db.org/cgi/network?identifiers=' + encodeURIComponent(a) + '%0d' + encodeURIComponent(b) + '&species=9606'; },
    stringGene: function (s) { return 'https://string-db.org/cgi/network?identifiers=' + encodeURIComponent(s) + '&species=9606'; },
    method: function () { return 'app_build_prompt.md'; },
    clinvar: function (sym, which) {
      return 'https://www.ncbi.nlm.nih.gov/clinvar/?term=' + encodeURIComponent(CLINVAR_TERMS[which].replace('{s}', sym));
    },
    epmc: function (query) { return 'https://europepmc.org/search?query=' + encodeURIComponent(query); }
  };
  // Europe PMC co-mention query, byte-identical to common.comention_query
  function phraseGroup(terms, tier) {
    var parts = terms.map(function (t) {
      t = String(t).replace(/"/g, '');
      if (tier === 'title') return 'TITLE:"' + t + '"';
      if (tier === 'abs') return '(TITLE:"' + t + '" OR ABSTRACT:"' + t + '")';
      return '"' + t + '"';
    });
    return '(' + parts.join(' OR ') + ')';
  }
  function comentionQuery(hubTerms, geneTerms, tier) {
    var q = phraseGroup(hubTerms, tier) + ' AND ' + phraseGroup(geneTerms, tier);
    for (var i = 0; i < LNCRNA.length; i++) q += ' NOT "' + LNCRNA[i] + '"';
    return q;
  }
  // both-hub co-mention (CTBP1 AND CTBP2 AND gene); byte-identical to common.comention_query_both
  function comentionQueryBoth(geneTerms, tier) {
    var q = phraseGroup(HUB_SYN.CTBP1, tier) + ' AND ' + phraseGroup(HUB_SYN.CTBP2, tier) + ' AND ' + phraseGroup(geneTerms, tier);
    for (var i = 0; i < LNCRNA.length; i++) q += ' NOT "' + LNCRNA[i] + '"';
    return q;
  }

  // ── glossary (every tip defines the term AND what it is not, §2.7) ─────────
  var GLOSSARY = {
    hub: 'The two subject hubs: CtBP1 and CtBP2, the paralogous NAD(H)-sensing transcriptional corepressors. "Both" shows the union of their two top-250 STRING neighbourhoods, with each partner attributed to the hub(s) it actually connects to.',
    focus: 'Pick one partner gene to trace how the selected hub(s) reach it: a direct STRING edge where one exists, otherwise the strongest mediated route through one or two intermediary genes (depth up to 3). It is a path through real edges, not a claim of biological mechanism.',
    fields: 'The ten biology/disease lenses are an editorial choice of what to display. Which genes belong to each is decided only by the data (EFO area-sums, disease-name matches, or GenAge/LongevityMap membership), never by hand. The lenses are filters over the data, not objective facts about a gene.',
    composite: 'A heuristic prioritisation score (0 to 100) blending physical evidence (0.5), co-mention literature (0.3) and network context (0.2). The weights are a fixed editorial choice. It is not a probability, and not a measure of biological importance.',
    physical: 'STRING experiment + curated-database confidence (the combined score is deliberately excluded so text-mining is not double-counted). It is confidence, not proof of direct binding; "Core complex" and "Physical interactor" are labels of strong support, not proven complexes.',
    literature: 'Synonym-aware co-mention counts from Europe PMC, in nested scopes: in title, then title+abstract (includes the title hits), then full text (includes both). For a shared gene a "both" row counts papers naming the gene with CTBP1 and CTBP2 together. Co-mention is correlation and is biased toward well-studied genes. It is not evidence of a physical or functional interaction.',
    ctx: 'Network context: the summed strength of a gene\'s partner-to-partner STRING edges (the two hubs excluded). It is topology, not functional proof.',
    conntype: 'A label derived from the physical evidence and IntAct, never from the database channel alone. It summarises the kind of support on record; it is not a verified molecular relationship.',
    mech: 'Mechanism tags are keyword matches against the gene\'s function text. They are suggestive, not evidential.',
    reactome: 'Reactome pathways are the gene\'s own annotations. They are not a claim that the pathway is shared with CtBP, nor patient-specific.',
    hpo: 'HPO clinical-phenotype terms are the gene\'s own annotations from the database. They are not a shared-with-CtBP or patient-specific claim.',
    clinvar: 'ClinVar P/LP and VUS are gene-level database tallies. They are not a clinical interpretation of any individual, and not medical advice.',
    aging: 'Membership comes from GenAge (human ageing genes) and LongevityMap (significant longevity associations). Aging is an overlay, not a disease sector; it never decides a gene\'s constellation colour, only a gold halo.',
    aictx: 'This export is everything shown here: the values, scores and the source links. Copy it with ⧉ Copy, paste it into your preferred AI assistant as context, then ask your question. The model can read the figures and follow the links to verify them. An LLM can over-interpret, so check its answers against the linked sources.',
    string: 'STRING channel confidences (0 to 1): combined, experiments, databases, text-mining, co-expression, fusion, neighborhood, co-occurrence. They are confidence scores, not proof of direct binding.',
    attribution: 'In the combined view, each partner is attributed to the hub(s) it scores against: shared (both paralogs), CTBP1-only, or CTBP2-only. Shared partners are the likely common corepressor core.'
  };

  // ── tooltip (instant, body-level; NOT native title) ───────────────────────
  var tipEl;
  function showTip(target, text) {
    tipEl.innerHTML = text; tipEl.classList.add('show');
    var r = target.getBoundingClientRect(), tr = tipEl.getBoundingClientRect();
    var x = r.left + r.width / 2 - tr.width / 2;
    var y = r.top - tr.height - 8;
    if (y < 6) y = r.bottom + 8;
    x = Math.max(6, Math.min(x, window.innerWidth - tr.width - 6));
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
  }
  function hideTip() { tipEl.classList.remove('show'); }
  function bindGloss(root) {
    (root || document).querySelectorAll('.gloss[data-gloss]').forEach(function (g) {
      if (g.__bound) return; g.__bound = 1; g.tabIndex = 0;
      var txt = GLOSSARY[g.getAttribute('data-gloss')] || '';
      g.addEventListener('mouseenter', function () { showTip(g, txt); });
      g.addEventListener('mouseleave', hideTip);
      g.addEventListener('focus', function () { showTip(g, txt); });
      g.addEventListener('blur', hideTip);
      // an ⓘ inside a <summary> must show its tip without toggling the section (§2.7)
      g.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); showTip(g, txt); });
    });
  }
  function gloss(key) { return '<span class="gloss" data-gloss="' + key + '">i</span>'; }

  // ── theme ───────────────────────────────────────────────────────────────
  function initTheme() {
    var t = 'light';
    try { t = localStorage.getItem('ctbp-theme') || 'light'; } catch (e) {}
    document.documentElement.setAttribute('data-theme', t);
    updateThemeBtn();
  }
  function updateThemeBtn() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    $('themeBtn').textContent = dark ? '☀' : '☾';
  }
  function toggleTheme() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var t = dark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('ctbp-theme', t); } catch (e) {}
    updateThemeBtn(); renderActiveView();
  }

  // ── insight strip ─────────────────────────────────────────────────────────
  function dbPills(hub) {
    var b = D.hubs[hub], ids = b.ids;
    var items = [
      ['STRING', L.stringGene(hub)],
      ['Open Targets', L.ot(ids.ensembl)],
      ['UniProt', L.uniprot(ids.uniprot)],
      ['NCBI Gene', L.ncbiGene(ids.entrez)],
      ['Ensembl', L.ensembl(ids.ensembl)]
    ];
    if (b.mim) items.push(['OMIM', L.omim(b.mim)]);
    return items.map(function (it) {
      return '<a class="links" href="' + it[1] + '" target="_blank" rel="noopener">' + esc(it[0]) + ' <span class="ext">↗</span></a>';
    }).join('');
  }
  function renderInsight() {
    var hubs = state.hub === 'Both' ? ['CTBP1', 'CTBP2'] : [state.hub];
    var row = $('srcLinks'); clear(row);
    hubs.forEach(function (h) {
      var g = el('span', 'hubgroup');
      g.innerHTML = '<span class="glabel">' + h + '</span>' + dbPills(h);
      row.appendChild(g);
    });
    row.insertAdjacentHTML('beforeend',
      '<a class="links" href="' + L.method() + '" target="_blank" rel="noopener" title="How this was built (the build prompt)">Method <span class="ext">↗</span></a>');

    var meta = $('metaItems'); clear(meta);
    var nb = D.meta.neighborhood;
    meta.innerHTML =
      '<button class="export-btn" id="exportBtn" title="Copies the full sourced AI context: both hubs, all ten fields, and every interactor with its per-hub attribution and connection (about 500,000 tokens), as plain text for pasting into an LLM."><span class="cp">⧉</span> Export AI Context of all Interactions</button>' +
      '<span class="meta-item"><span class="ml">Built</span><span class="mv">' + esc(D.meta.date) + '</span></span>' +
      '<span class="meta-item"><span class="ml">Genes</span><span class="mv">' + fmtN(nb.union) + '</span></span>' +
      '<span class="meta-item"><span class="ml">Edges</span><span class="mv">' + fmtN(D.meta.edgeCount) + '</span></span>';
    $('exportBtn').addEventListener('click', exportAll);

    var c = D.meta.counts;
    $('captionLead').innerHTML = esc(nb.union + ' STRING interactors of human CTBP1 and CTBP2, the top-250 of each paralog by combined score, merged into one union (' +
      c.shared + ' shared, ' + c['CTBP1-only'] + ' CTBP1-only, ' + c['CTBP2-only'] + ' CTBP2-only). Snapshot ' + D.meta.date + '.');
    var srcs = D.meta.sources.map(function (s) { return '<a href="' + s.url + '" target="_blank" rel="noopener">' + esc(s.name) + '</a>'; }).join(' · ');
    $('captionSrc').innerHTML = 'Sources: ' + srcs + '.';
  }

  // ── controls ──────────────────────────────────────────────────────────────
  function renderControls() {
    // hub segmented active
    document.querySelectorAll('#hubSel button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-hub') === state.hub);
    });
    // hub roll-up
    var nb = D.meta.neighborhood, c = D.meta.counts, ru = $('hubRollup');
    if (state.hub === 'Both') {
      ru.innerHTML = '<b>' + c.shared + '</b> shared · <b>' + c['CTBP1-only'] + '</b> CTBP1-only · <b>' + c['CTBP2-only'] + '</b> CTBP2-only ' + gloss('attribution');
    } else {
      ru.innerHTML = nb[state.hub] + ' interactors of ' + state.hub + '.';
    }
    bindGloss(ru);

    // focus datalist
    var dl = $('geneList');
    if (!dl.__filled) {
      dl.__filled = 1;
      var opts = analysed.map(function (o) { return '<option value="' + esc(o.sym) + '">'; }).join('');
      // include all union syms regardless of hubSel
      var all = D.nodes.map(function (n) { return '<option value="' + esc(n.sym) + '">'; }).join('');
      dl.innerHTML = all;
    }
    $('focusClear').style.display = state.focus ? 'block' : 'none';
    // don't overwrite the box while the user is typing in it (would jump the cursor)
    if (document.activeElement !== $('focusInput')) $('focusInput').value = state.focus || '';
    $('focusState').innerHTML = state.focus
      ? 'Focus: <b>' + esc(state.focus) + '</b>. Network view shows how the hub(s) reach it.'
      : 'Showing the whole neighbourhood.';

    // fields list
    var summary = EN.themeSummary(D, state.hub);
    var fl = $('fieldList'); clear(fl);
    EN.THEME_ORDER.forEach(function (key, idx) {
      var th = EN.THEMES[key], s = summary[key];
      if (idx === 5) { var note = el('div', 'field-divider-note', 'cross-cutting overlays (filter every view)'); fl.appendChild(note); }
      var row = el('div', 'field-row' + (th.sector ? '' : ' sectorless') + (state.lens === key ? ' active' : ''));
      row.innerHTML = '<span class="field-dot" style="background:' + th.color + '"></span>' +
        '<span class="field-name">' + esc(th.label) + '</span>' +
        '<span class="field-count">' + s.count + '</span>' +
        gloss(key === 'aging' ? 'aging' : 'fields');
      row.addEventListener('click', function (e) { if (e.target.classList.contains('gloss')) return; toggleLens(key); });
      fl.appendChild(row);
    });
    bindGloss(fl);
    $('limitRange').value = state.limit; $('limitVal').textContent = state.limit;
  }

  function toggleLens(key) { state.lens = (state.lens === key) ? null : key; if (state.lens) openLens(state.lens); renderAll(); }

  // ── scoped list for the views ───────────────────────────────────────────
  function scoped() {
    var list = analysed.slice();
    if (state.lens) list = list.filter(function (o) { return o.fields.some(function (f) { return f.key === state.lens; }); });
    return list;
  }
  function topN(list) { return list.slice(0, state.limit); }

  // ── render dispatch ───────────────────────────────────────────────────────
  function recompute() {
    analysed = EN.analyse(D, state.hub);
    bySym = {}; D.nodes.forEach(function (n) { bySym[n.sym] = n; });
  }
  function renderAll() { recompute(); renderControls(); renderInsight(); renderActiveView(); renderDrawer(); }
  function renderActiveView() {
    var v = state.view;
    if (v === 'constellation') drawConstellation();
    else if (v === 'table') renderTable();
    else if (v === 'findings') renderFindings();
    else if (v === 'discoveries') renderDiscoveries();
    else if (v === 'network') drawNetwork();
  }
  function setView(v) {
    state.view = v;
    document.querySelectorAll('#viewTabs .tab').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-view') === v); });
    document.querySelectorAll('.view').forEach(function (el2) { el2.classList.toggle('active', el2.getAttribute('data-view') === v); });
    renderActiveView();
  }

  // ── attribution helpers ────────────────────────────────────────────────────
  function attrBadge(attr) {
    if (attr === 'shared') return '<span class="attr shared">1+2</span>';
    if (attr === 'CTBP1-only') return '<span class="attr c1">1</span>';
    return '<span class="attr c2">2</span>';
  }
  function headlineConn(o) {
    if (state.hub !== 'Both') return o.conn[state.hub];
    var best = null;
    ['CTBP1', 'CTBP2'].forEach(function (h) { var c = o.conn[h]; if (c && (!best || c.composite > best.composite)) best = c; });
    return best;
  }

  // =========================================================================
  //  CONSTELLATION
  // =========================================================================
  var cPos = [];   // hit-test cache {x,y,r,sym}
  function drawConstellation() {
    var cv = $('constellation'), wrap = cv.parentElement;
    var W = wrap.clientWidth, H = wrap.clientHeight, dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; var ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    var cx = W / 2, cy = H / 2;
    var inner = 48, outer = Math.min(W, H) / 2 - 36;
    var sectors = EN.SECTORS, nSec = sectors.length;
    var onSurface = cssVar('--on-surface'), variant = cssVar('--on-surface-variant');

    // faint sector wedges + labels
    for (var i = 0; i < nSec; i++) {
      var a0 = (i / nSec) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 1) / nSec) * Math.PI * 2 - Math.PI / 2;
      var col = EN.THEMES[sectors[i]].color;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, outer, a0, a1); ctx.closePath();
      ctx.fillStyle = hexA(col, 0.05); ctx.fill();
      var am = (a0 + a1) / 2;
      ctx.fillStyle = variant; ctx.font = '600 10px ' + cssVar('--sans');
      ctx.textAlign = 'center';
      var lx = cx + Math.cos(am) * (outer - 12), ly = cy + Math.sin(am) * (outer - 12);
      ctx.fillText(EN.THEMES[sectors[i]].label.split(' ')[0], lx, ly);
    }

    var list = topN(scoped());
    cPos = [];
    // edges from hub centre to nodes (faint)
    list.forEach(function (o) {
      var p = nodePos(o, cx, cy, inner, outer, sectors);
      ctx.strokeStyle = hexA(attrColor(o.attribution), 0.10); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p.x, p.y); ctx.stroke();
    });
    // nodes
    list.forEach(function (o) {
      var p = nodePos(o, cx, cy, inner, outer, sectors);
      var color = o.dominantSector ? EN.THEMES[o.dominantSector].color : (o.dominant ? EN.THEMES[o.dominant].color : variant);
      var r = 4 + (headlineConn(o) ? headlineConn(o).composite : 0) / 100 * 7;
      var isFocus = (state.focus === o.sym) || (state.selected === o.sym);
      // aging halo
      if (o.fields.some(function (f) { return f.key === 'aging'; })) {
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2);
        ctx.fillStyle = hexA(EN.THEMES.aging.color, 0.30); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = o.dominantSector ? color : hexA(variant, 0.55); ctx.fill();
      // shared marker: split ring
      if (o.attribution === 'shared') { ctx.lineWidth = 1.6; ctx.strokeStyle = cssVar('--tertiary'); ctx.stroke(); }
      if (isFocus) { ctx.lineWidth = 2.5; ctx.strokeStyle = cssVar('--primary-bright'); ctx.beginPath(); ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2); ctx.stroke(); }
      cPos.push({ x: p.x, y: p.y, r: Math.max(r, 7), sym: o.sym });
    });
    // centre hub(s)
    var hubFill = cssVar('--primary');
    var hubs = state.hub === 'Both' ? ['CTBP1', 'CTBP2'] : [state.hub];
    hubs.forEach(function (h, k) {
      var hx = cx + (hubs.length > 1 ? (k === 0 ? -13 : 13) : 0);
      ctx.beginPath(); ctx.arc(hx, cy, 13, 0, Math.PI * 2);
      ctx.fillStyle = hubFill; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '700 9px ' + cssVar('--mono'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(h === 'CTBP1' ? '1' : (h === 'CTBP2' ? '2' : 'B'), hx, cy);
    });
    ctx.textBaseline = 'alphabetic';
    renderConstLegend();
  }
  function nodePos(o, cx, cy, inner, outer, sectors) {
    if (o.__p) return o.__p;
    var comp = headlineConn(o) ? headlineConn(o).composite : 0;
    var rad = outer - (comp / 100) * (outer - inner);     // strong = closer in
    var ang;
    if (o.dominantSector) {
      var si = sectors.indexOf(o.dominantSector);
      var base = (si / sectors.length) * Math.PI * 2 - Math.PI / 2;
      var span = (Math.PI * 2 / sectors.length);
      ang = base + span * (0.18 + 0.64 * hashUnit(o.sym));
    } else {
      ang = hashUnit(o.sym + 'x') * Math.PI * 2;
    }
    o.__p = { x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad };
    return o.__p;
  }
  function renderConstLegend() {
    var lg = $('constLegend'); var rows = '';
    EN.SECTORS.forEach(function (k) { rows += '<div class="lg-row"><span class="lg-dot" style="background:' + EN.THEMES[k].color + '"></span>' + esc(EN.THEMES[k].label) + '</div>'; });
    rows += '<div class="lg-row"><span class="lg-halo" style="background:' + EN.THEMES.aging.color + '"></span>Aging / longevity (overlay)</div>';
    rows += '<div class="lg-row"><span class="attr shared">1+2</span> shared &nbsp; <span class="attr c1">1</span> CTBP1 &nbsp; <span class="attr c2">2</span> CTBP2</div>';
    lg.innerHTML = rows;
  }
  function attrColor(a) { return a === 'shared' ? cssVar('--tertiary') : (a === 'CTBP1-only' ? cssVar('--primary') : cssVar('--secondary')); }

  // =========================================================================
  //  TABLE
  // =========================================================================
  var tableSort = { key: 'composite', dir: -1 };
  function renderTable() {
    var both = state.hub === 'Both';
    var list = topN(scoped());
    var cols = [{ k: 'sym', l: 'Gene', cls: 'l' }];
    if (both) cols.push({ k: 'attribution', l: 'Hub', cls: 'l' });
    cols.push({ k: 'composite', l: 'Composite' }, { k: 'type', l: 'Type', cls: 'l' });
    if (both) {
      cols.push({ k: 'c1', l: 'CTBP1 comp' }, { k: 'p1', l: 'CTBP1 phys' }, { k: 'l1', l: 'CTBP1 lit' });
      cols.push({ k: 'c2', l: 'CTBP2 comp' }, { k: 'p2', l: 'CTBP2 phys' }, { k: 'l2', l: 'CTBP2 lit' });
    } else {
      cols.push({ k: 'phys', l: 'Physical' }, { k: 'lit', l: 'Literature' }, { k: 'ctx', l: 'Network' }, { k: 'litc', l: 'Co-mention' });
    }
    cols.push({ k: 'dom', l: 'Dominant area', cls: 'l' });

    function val(o, k) {
      var hc = headlineConn(o);
      switch (k) {
        case 'sym': return o.sym; case 'attribution': return o.attribution;
        case 'composite': return o.composite; case 'type': return hc ? hc.type : '';
        case 'c1': return o.conn.CTBP1 ? o.conn.CTBP1.composite : null;
        case 'c2': return o.conn.CTBP2 ? o.conn.CTBP2.composite : null;
        case 'p1': return o.conn.CTBP1 ? o.conn.CTBP1.phys : null;
        case 'p2': return o.conn.CTBP2 ? o.conn.CTBP2.phys : null;
        case 'l1': return o.conn.CTBP1 ? o.conn.CTBP1.litEff : null;
        case 'l2': return o.conn.CTBP2 ? o.conn.CTBP2.litEff : null;
        case 'phys': return hc ? hc.phys : null; case 'lit': return hc ? hc.lit : null;
        case 'ctx': return hc ? hc.ctx : null;
        case 'litc': return Math.max(o.conn.CTBP1 ? o.conn.CTBP1.litEff : 0, o.conn.CTBP2 ? o.conn.CTBP2.litEff : 0);
        case 'dom': return o.dominant ? EN.THEMES[o.dominant].label : '—';
      }
    }
    list.sort(function (a, b) {
      var x = val(a, tableSort.key), y = val(b, tableSort.key);
      if (typeof x === 'string' || typeof y === 'string') return (String(x) < String(y) ? -1 : 1) * tableSort.dir;
      return ((x == null ? -1 : x) - (y == null ? -1 : y)) * tableSort.dir;
    });

    var th = cols.map(function (c) { return '<th class="' + (c.cls || '') + (tableSort.key === c.k ? ' sorted' : '') + '" data-k="' + c.k + '">' + esc(c.l) + '</th>'; }).join('');
    var rows = list.map(function (o) {
      var hc = headlineConn(o), tds = [];
      tds.push('<td class="l"><b>' + esc(o.sym) + '</b></td>');
      if (both) tds.push('<td class="l"><span class="hub-badge ' + (o.attribution === 'shared' ? 'shared' : '') + '">' + (o.attribution === 'shared' ? 'shared' : o.attribution.replace('-only', '')) + '</span></td>');
      tds.push('<td class="num">' + fmtC(o.composite) + '</td>');
      tds.push('<td class="l">' + esc(hc ? hc.type : '—') + '</td>');
      if (both) {
        ['CTBP1', 'CTBP2'].forEach(function (h) {
          var c = o.conn[h];
          tds.push('<td class="num">' + (c ? fmtC(c.composite) : '·') + '</td>');
          tds.push('<td class="num">' + (c ? fmtS(c.phys) : '·') + '</td>');
          tds.push('<td class="num">' + (c ? fmtN(c.litEff) : '·') + '</td>');
        });
      } else {
        tds.push('<td class="num">' + (hc ? fmtS(hc.phys) : '—') + '</td>');
        tds.push('<td class="num">' + (hc ? fmtS(hc.lit) : '—') + '</td>');
        tds.push('<td class="num">' + (hc ? fmtS(hc.ctx) : '—') + '</td>');
        tds.push('<td class="num">' + fmtN(val(o, 'litc')) + '</td>');
      }
      tds.push('<td class="l">' + (o.dominant ? '<span class="chip" style="--c:' + EN.THEMES[o.dominant].color + '"><span class="cdot" style="background:' + EN.THEMES[o.dominant].color + '"></span>' + esc(EN.THEMES[o.dominant].label) + '</span>' : '—') + '</td>');
      return '<tr data-sym="' + esc(o.sym) + '">' + tds.join('') + '</tr>';
    }).join('');

    $('tableWrap').innerHTML = '<table class="evtbl"><thead><tr>' + th + '</tr></thead><tbody>' + rows + '</tbody></table>';
    $('tableWrap').querySelectorAll('th').forEach(function (h) {
      h.addEventListener('click', function () { var k = h.getAttribute('data-k'); if (tableSort.key === k) tableSort.dir *= -1; else { tableSort.key = k; tableSort.dir = (k === 'sym' || k === 'type' || k === 'dom' || k === 'attribution') ? 1 : -1; } renderTable(); });
    });
    $('tableWrap').querySelectorAll('tbody tr').forEach(function (tr) {
      tr.addEventListener('click', function () { openGene(tr.getAttribute('data-sym')); });
      tr.addEventListener('dblclick', function () { focusGene(tr.getAttribute('data-sym')); });
    });
  }

  // =========================================================================
  //  FINDINGS
  // =========================================================================
  function renderFindings() {
    var rows = EN.findings(D, state.hub);
    if (state.lens) rows = rows.filter(function (r) { return r.key === state.lens; });
    var chips = $('findingChips'); clear(chips);
    var summary = EN.themeSummary(D, state.hub);
    EN.THEME_ORDER.forEach(function (key) {
      if (!summary[key].count) return;
      var th = EN.THEMES[key];
      var c = el('span', 'chip area' + (state.lens === key ? ' active' : ''));
      c.style.setProperty('--c', th.color);
      c.innerHTML = '<span class="cdot" style="background:' + th.color + '"></span>' + esc(th.label) + ' <span class="num" style="font-size:10px">' + summary[key].count + '</span>';
      c.addEventListener('click', function () { toggleLens(key); });
      chips.appendChild(c);
    });

    var box = $('findingRows'); clear(box);
    rows.forEach(function (r) {
      var th = EN.THEMES[r.key];
      var ev = '';
      if (r.top && r.top.disease) ev = 'Open Targets: ' + esc(r.top.disease) + ' (score ' + fmtS(r.top.score) + ')';
      else if (r.top && r.top.areaSum != null) ev = 'EFO area-sum ' + fmtS(r.top.areaSum) + (r.matches && r.matches[0] ? ', e.g. ' + esc(r.matches[0].n) : '');
      else if (r.top && r.top.why) ev = esc(r.top.why) + (r.top.pmids && r.top.pmids.length ? ' (PMID ' + esc(r.top.pmids[0]) + ')' : '');
      var src = r.source ? ' <a class="links" href="' + r.source.url + '" target="_blank" rel="noopener">' + esc(r.source.label) + ' <span class="ext">↗</span></a>' : '';
      var pips = '<span class="sev-pips">' + [1, 2, 3].map(function (i) { return '<i style="background:' + (i <= r.sev ? th.color : '') + '"></i>'; }).join('') + '</span>';
      var hubTag = state.hub === 'Both' ? ' ' + attrBadge(r.attribution) : '';
      var row = el('div', 'finding-row'); row.style.borderLeftColor = th.color;
      row.innerHTML = '<div class="finding-main"><div class="finding-gene">' + esc(r.sym) + ' ' + hubTag +
        ' <span class="chip" style="font-size:10px;--c:' + th.color + '"><span class="cdot" style="background:' + th.color + '"></span>' + esc(r.label) + '</span></div>' +
        '<div class="finding-ev">' + ev + src + '</div></div>' + pips;
      row.addEventListener('click', function (e) { if (e.target.tagName === 'A') return; openGene(r.sym); });
      row.addEventListener('dblclick', function (e) { if (e.target.tagName === 'A') return; focusGene(r.sym); });
      box.appendChild(row);
    });
    if (!rows.length) box.innerHTML = '<p class="muted">No memberships in this scope.</p>';
  }

  // =========================================================================
  //  DISCOVERIES
  // =========================================================================
  function renderDiscoveries() {
    var feed = EN.discoveries(D, state.hub);
    if (state.lens) feed = feed.filter(function (o) { return o.fields.some(function (f) { return f.key === state.lens; }); });
    var grid = $('discGrid'); clear(grid);
    feed.forEach(function (o) {
      var hc = headlineConn(o);
      var color = o.dominant ? EN.THEMES[o.dominant].color : cssVar('--outline');
      var sub = o.dominant ? EN.THEMES[o.dominant].label : (o.mech[0] ? o.mech[0].label : 'No disease lens');
      var card = el('div', 'disc-card'); card.style.borderTopColor = color;
      card.innerHTML = '<div class="disc-reason">' + esc(o.reason) + '</div>' +
        '<div class="disc-gene">' + esc(o.sym) + (state.hub === 'Both' ? ' ' + attrBadge(o.attribution) : '') + '</div>' +
        '<div class="disc-sub">' + esc(sub) + '</div>' +
        '<div class="disc-stat"><span class="muted">Composite</span><span class="num">' + fmtC(o.composite) + '</span></div>' +
        '<div class="disc-stat"><span class="muted">Type</span><span class="num" style="font-weight:600">' + esc(hc ? hc.type : '—') + '</span></div>';
      card.addEventListener('click', function () { openGene(o.sym); });
      card.addEventListener('dblclick', function () { focusGene(o.sym); });
      grid.appendChild(card);
    });
    if (!feed.length) grid.innerHTML = '<p class="muted">No discoveries in this scope.</p>';
  }

  // =========================================================================
  //  NETWORK  (focus subgraph, or Both two-hub overview)
  // =========================================================================
  var nPos = [];
  function drawNetwork() {
    var cv = $('network'), wrap = cv.parentElement;
    var W = wrap.clientWidth, H = wrap.clientHeight, dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; var ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    nPos = [];
    $('netClear').style.display = state.focus ? 'inline-flex' : 'none';
    if (state.focus) drawFocusGraph(ctx, W, H);
    else drawOverview(ctx, W, H);
  }

  function drawFocusGraph(ctx, W, H) {
    var G = state.focus;
    var hubs = state.hub === 'Both' ? ['CTBP1', 'CTBP2'] : [state.hub];
    var pos = {}, used = {};
    // layout: hubs left column, target right, intermediaries middle
    var allRoutes = [];
    hubs.forEach(function (h) { EN.routes(D, h, G, { maxDepth: 3, top: 4 }).forEach(function (r) { r.hub = h; allRoutes.push(r); }); });
    // collect intermediary nodes
    var mids = {};
    allRoutes.forEach(function (r) { r.hops.forEach(function (hp, i) { if (i < r.hops.length - 1 && hp.to !== G) mids[hp.to] = 1; }); });
    var midList = Object.keys(mids);
    hubs.forEach(function (h, i) { pos[h] = { x: 80, y: H / 2 + (i - (hubs.length - 1) / 2) * 90, kind: 'hub' }; });
    midList.forEach(function (m, i) { pos[m] = { x: W / 2, y: 50 + (i + 1) * (H - 80) / (midList.length + 1), kind: 'mid' }; });
    pos[G] = { x: W - 90, y: H / 2, kind: 'target' };

    // edges
    ctx.lineWidth = 1.4;
    allRoutes.forEach(function (r) {
      r.hops.forEach(function (hp) {
        var a = pos[hp.from], b = pos[hp.to]; if (!a || !b) return;
        ctx.strokeStyle = hexA(cssVar('--on-surface-variant'), 0.5);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        ctx.fillStyle = cssVar('--on-surface-variant'); ctx.font = '600 9px ' + cssVar('--mono'); ctx.textAlign = 'center';
        ctx.fillText(fmtS(hp.score), mx, my - 3);
      });
    });
    // nodes
    Object.keys(pos).forEach(function (sym) {
      var p = pos[sym], r = p.kind === 'hub' ? 16 : (p.kind === 'target' ? 14 : 10);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = p.kind === 'hub' ? cssVar('--primary') : (p.kind === 'target' ? EN.THEMES.aging.color : cssVar('--surface-container-high'));
      ctx.fill();
      if (p.kind === 'mid') { ctx.strokeStyle = cssVar('--outline'); ctx.lineWidth = 1; ctx.stroke(); }
      // label: centered on hubs/target, above the small intermediary nodes
      ctx.font = '700 10px ' + cssVar('--sans'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (p.kind === 'mid') { ctx.fillStyle = cssVar('--on-surface'); ctx.fillText(sym, p.x, p.y - r - 9); }
      else { ctx.fillStyle = p.kind === 'target' ? '#3a2a00' : '#fff'; ctx.fillText(sym, p.x, p.y); }
      nPos.push({ x: p.x, y: p.y, r: r + 6, sym: sym });
    });
    ctx.textBaseline = 'alphabetic';
    $('networkHint').innerHTML = 'Focus: <b>' + esc(G) + '</b>. ' + (allRoutes.length ? 'Showing how ' + hubs.join(' & ') + ' reach it.' : 'No route found within depth 3.') ;
  }

  function drawOverview(ctx, W, H) {
    var list = topN(scoped());
    var cxL = W * 0.30, cxR = W * 0.70, cy = H / 2;
    // hubs
    var pts = [];
    list.forEach(function (o) {
      var x, y, base;
      if (o.attribution === 'CTBP1-only') base = cxL - W * 0.16;
      else if (o.attribution === 'CTBP2-only') base = cxR + W * 0.16;
      else base = (cxL + cxR) / 2;
      var ang = hashUnit(o.sym) * Math.PI * 2, rad = 30 + hashUnit(o.sym + 'r') * Math.min(W, H) * 0.30;
      x = base + Math.cos(ang) * rad * 0.5; y = cy + Math.sin(ang) * rad * 0.6;
      var color = o.dominantSector ? EN.THEMES[o.dominantSector].color : cssVar('--on-surface-variant');
      pts.push({ x: x, y: y, o: o, color: color });
    });
    // links to relevant hub centres (faint)
    pts.forEach(function (p) {
      ctx.strokeStyle = hexA(attrColor(p.o.attribution), 0.08); ctx.lineWidth = 1;
      if (p.o.attribution !== 'CTBP2-only') { ctx.beginPath(); ctx.moveTo(cxL, cy); ctx.lineTo(p.x, p.y); ctx.stroke(); }
      if (p.o.attribution !== 'CTBP1-only') { ctx.beginPath(); ctx.moveTo(cxR, cy); ctx.lineTo(p.x, p.y); ctx.stroke(); }
    });
    pts.forEach(function (p) {
      var r = 4 + (p.o.composite / 100) * 6;
      if (p.o.fields.some(function (f) { return f.key === 'aging'; })) { ctx.beginPath(); ctx.arc(p.x, p.y, r + 4, 0, 7); ctx.fillStyle = hexA(EN.THEMES.aging.color, 0.3); ctx.fill(); }
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = p.o.dominantSector ? p.color : hexA(cssVar('--on-surface-variant'), 0.5); ctx.fill();
      nPos.push({ x: p.x, y: p.y, r: Math.max(r, 7), sym: p.o.sym });
    });
    [['CTBP1', cxL], ['CTBP2', cxR]].forEach(function (hh) {
      ctx.beginPath(); ctx.arc(hh[1], cy, 18, 0, Math.PI * 2); ctx.fillStyle = cssVar('--primary'); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '700 12px ' + cssVar('--sans'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(hh[0], hh[1], cy);
    });
    ctx.textBaseline = 'alphabetic';
    $('networkHint').innerHTML = 'Two-hub overview: CTBP1-only (left), shared (centre), CTBP2-only (right). Pick a focus gene (or double-click a node) to see mediated routes.';
  }

  // =========================================================================
  //  DRAWER  (hub / gene / lens dossiers)
  // =========================================================================
  function renderDrawer() {
    if (drawer.mode === 'gene' && drawer.sym) renderGeneDossier(drawer.sym);
    else if (drawer.mode === 'lens' && drawer.lens) renderLensDossier(drawer.lens);
    else renderHubDossier();
    $('drawerHome').style.display = (drawer.mode === 'hub') ? 'none' : 'inline-block';
    bindGloss($('drawerBody')); bindGloss(document.querySelector('.drawer-head'));
  }
  function openGene(sym) { drawer.mode = 'gene'; drawer.sym = sym; openDrawerMobile(); renderDrawer(); if (state.view === 'constellation') drawConstellation(); }
  function openLens(key) { drawer.mode = 'lens'; drawer.lens = key; openDrawerMobile(); renderDrawer(); }
  function goHub() { drawer.mode = 'hub'; state.focus = null; state.selected = null; state.lens = null; renderAll(); }
  // Enter focus mode for a found gene: open its dossier and surface the route
  // subgraph in the Network view. Called the moment a gene is typed/picked.
  function focusGene(sym) {
    // re-selecting the already-focused gene toggles focus OFF (a built-in way back)
    if (state.focus === sym) { $('focusInput').value = ''; clearFocus(); return; }
    state.focus = sym; state.selected = sym;
    drawer.mode = 'gene'; drawer.sym = sym; openDrawerMobile();
    renderControls();          // focus-state text + clear button (leaves the input value alone while typing)
    setView('network');        // Network is the home for the focus subgraph; setView always (re)draws it
    renderDrawer();            // gene dossier
  }
  function clearFocus() {
    if (!state.focus) { renderControls(); return; }
    state.focus = null;
    renderControls();
    renderActiveView();        // redraw the current view without focus
  }

  function sectionAI(title, key, text) {
    return '<div class="aiblock"><div class="aiblock-head"><span class="ttl">AI context — ' + esc(title) + '</span>' +
      gloss('aictx') + '<button class="copybtn" data-copy="' + key + '" title="Copy the AI context for ' + esc(title) + '"><span>⧉</span> Copy</button></div>' +
      '<pre id="ai-' + key + '">' + esc(text) + '</pre></div>';
  }

  function renderHubDossier() {
    var both = state.hub === 'Both';
    var hubs = both ? ['CTBP1', 'CTBP2'] : [state.hub];
    $('drawerTitle').innerHTML = both ? 'CtBP corepressor pair' : D.hubs[state.hub].name;
    $('drawerSub').innerHTML = both ? 'CTBP1 + CTBP2, paralogous NAD(H)-sensing corepressors' : state.hub;
    var syn = EN.synthesis(D, state.hub);
    var body = '<div class="dsec"><div class="dsec-h">Synthesis</div><p style="margin:0 0 4px"><b>' + esc(syn.lead) + '</b></p><p style="margin:0" class="muted">' + esc(syn.body) + '</p></div>';

    hubs.forEach(function (h) {
      var b = D.hubs[h];
      body += '<div class="dsec"><div class="dsec-h">' + esc(h) + ' · ' + esc(b.name) + '</div>';
      if (b.summary) body += '<p class="muted" style="margin:0 0 8px">' + esc(trunc(b.summary, 320)) + '</p>';
      if (b.cofactor) body += '<div class="kv"><span class="k">Cofactor</span><span class="v">' + esc(b.cofactor) + '</span></div>';
      if (b.litTotal != null) body += '<div class="kv"><span class="k">Literature (total) ' + gloss('literature') + '</span><span class="v"><a class="linkval" target="_blank" rel="noopener" href="' + L.epmc('(' + HUB_SYN[h].map(function (t) { return '"' + t + '"'; }).join(' OR ') + ')') + '">' + fmtN(b.litTotal) + ' ↗</a></span></div>';
      if (b.clinvar) body += clinvarRows(h, b.clinvar);
      body += '<div class="dsec-h" style="margin-top:10px">Open in databases</div><div class="links-block">' + dbPills(h) + ' <a class="links" target="_blank" rel="noopener" href="' + L.intact(h) + '">IntAct ↗</a></div>';
      if (b.note) body += '<p class="muted" style="margin-top:8px;font-size:11.5px">' + esc(b.note) + '</p>';
      body += '</div>';
    });

    // shared-vs-divergent roll-up (Both)
    if (both) {
      var c = D.meta.counts;
      body += '<div class="dsec"><div class="dsec-h">Shared vs divergent ' + gloss('attribution') + '</div>' +
        '<div class="kv"><span class="k">Shared (both paralogs)</span><span class="v">' + c.shared + '</span></div>' +
        '<div class="kv"><span class="k">CTBP1-only</span><span class="v">' + c['CTBP1-only'] + '</span></div>' +
        '<div class="kv"><span class="k">CTBP2-only</span><span class="v">' + c['CTBP2-only'] + '</span></div></div>';
    }
    body += sectionAI(both ? 'CtBP pair' : state.hub, 'hub', aiForHub());
    $('drawerBody').innerHTML = body;
    wireCopy();
  }

  function clinvarRows(sym, cv) {
    function row(label, which, val) {
      return '<div class="kv"><span class="k">' + label + '</span><span class="v"><a class="linkval" target="_blank" rel="noopener" href="' + L.clinvar(sym, which) + '">' + fmtN(val) + ' ↗</a></span></div>';
    }
    return '<div class="kv"><span class="k">ClinVar ' + gloss('clinvar') + '</span><span class="v"></span></div>' +
      row('· Pathogenic / likely-path', 'plp', cv.plp) + row('· VUS', 'vus', cv.vus) + row('· Total', 'total', cv.total);
  }

  function renderGeneDossier(sym) {
    var o = analysed.filter(function (x) { return x.sym === sym; })[0];
    var n = bySym[sym];
    if (!n) { renderHubDossier(); return; }
    if (!o) { // gene not in current scope (e.g. CTBP2-only while CTBP1 selected): build a minimal analysed view
      o = EN.analyse(D, 'Both').filter(function (x) { return x.sym === sym; })[0];
    }
    state.selected = sym;        // dossier highlight only; NOT focus mode
    $('drawerTitle').innerHTML = esc(sym) + ' ' + (state.hub === 'Both' ? attrBadge(o.attribution) : '');
    $('drawerSub').innerHTML = esc(n.name || '') + (n.syn && n.syn.length ? ' · aka ' + esc(n.syn.slice(0, 3).join(', ')) : '');
    var body = '';

    // IntAct
    if (n.intact) {
      var ia = n.intact;
      body += '<div class="dsec"><div class="dsec-h">IntAct (curated interactions) ' + gloss('physical') + '</div>' +
        '<div class="kv"><span class="k">Type</span><span class="v">' + esc(ia.type || '—') + (ia.direct ? ' (direct)' : '') + '</span></div>' +
        '<div class="kv"><span class="k">MI-score</span><span class="v">' + fmtS(ia.miscore) + '</span></div>' +
        '<div class="kv"><span class="k">Records</span><span class="v"><a class="linkval" target="_blank" rel="noopener" href="' + L.intact(sym) + '">' + fmtN(ia.count) + ' ↗</a></span></div>';
      if (ia.methods && ia.methods.length) body += '<div class="kv"><span class="k">Methods</span><span class="v" style="font-family:var(--sans);text-align:right;max-width:60%">' + esc(ia.methods.join(', ')) + '</span></div>';
      if (ia.pmids && ia.pmids.length) body += '<div style="margin-top:4px">' + ia.pmids.slice(0, 5).map(function (p) { return '<a class="links" target="_blank" rel="noopener" href="' + L.pubmed(p) + '">PMID ' + esc(p) + ' ↗</a>'; }).join(' ') + '</div>';
      body += '</div>';
    }

    // Literature (pulled up, above area memberships)
    body += litSection(n);

    // Area memberships
    if (o.fields.length) {
      body += '<div class="dsec"><div class="dsec-h">Area memberships ' + gloss('fields') + '</div>';
      o.fields.forEach(function (f) {
        var th = EN.THEMES[f.key];
        var ev = f.top && f.top.disease ? esc(f.top.disease) + ' (' + fmtS(f.top.score) + ')'
          : (f.top && f.top.areaSum != null ? 'EFO area-sum ' + fmtS(f.top.areaSum) : (f.top && f.top.why ? esc(f.top.why) : ''));
        body += '<div style="display:flex;align-items:center;gap:8px;margin:5px 0">' +
          '<span class="chip" style="--c:' + th.color + '"><span class="cdot" style="background:' + th.color + '"></span>' + esc(f.label) + '</span>' +
          '<span class="muted" style="font-size:11.5px;flex:1">' + ev + '</span>' +
          (f.source ? '<a class="links" target="_blank" rel="noopener" href="' + f.source.url + '">' + esc(f.source.label) + ' ↗</a>' : '') + '</div>';
      });
      body += '</div>';
    }

    // top disease associations
    if (n.dis && n.dis.length) {
      body += '<div class="dsec"><div class="dsec-h">Top disease associations <a class="links" target="_blank" rel="noopener" href="' + L.ot(n.ensembl) + '">Open Targets ↗</a></div>';
      n.dis.slice(0, 8).forEach(function (d) { body += '<div class="kv"><span class="k" style="font-family:var(--sans)">' + esc(d.n) + '</span><span class="v">' + fmtS(d.s) + '</span></div>'; });
      body += '</div>';
    }

    // Pathways (Reactome) — before ClinVar
    if (n.pathways && n.pathways.length) {
      body += '<div class="dsec"><div class="dsec-h">Pathways (Reactome) ' + gloss('reactome') + '</div><div class="links-block">' +
        n.pathways.slice(0, 12).map(function (p) { return '<a class="links" target="_blank" rel="noopener" href="' + L.reactome(p) + '">' + esc(p) + ' ↗</a>'; }).join('') + '</div></div>';
    }

    // Clinical variants (ClinVar)
    if (n.clinvar) body += '<div class="dsec"><div class="dsec-h">Clinical variants (ClinVar)</div>' + clinvarRows(sym, n.clinvar) + '</div>';

    // Clinical phenotypes (HPO)
    if (n.phenotypes && n.phenotypes.length) {
      body += '<div class="dsec"><div class="dsec-h">Clinical phenotypes (HPO) ' + gloss('hpo') + ' <a class="links" target="_blank" rel="noopener" href="' + L.monarch(n.entrez) + '">Monarch ↗</a></div><div class="links-block">' +
        n.phenotypes.slice(0, 14).map(function (p) { return '<span class="chip tag">' + esc(p) + '</span>'; }).join('') +
        '</div>' + (n.phenoCount ? '<div class="sec-note"><a class="linkval" target="_blank" rel="noopener" href="' + L.hpoApi(n.entrez) + '">' + n.phenoCount + ' terms ↗</a></div>' : '') + '</div>';
    }

    // mechanism tags
    if (o.mech && o.mech.length) {
      body += '<div class="dsec"><div class="dsec-h">Mechanism tags ' + gloss('mech') + '</div><div class="links-block">' +
        o.mech.map(function (m) { return '<span class="chip tag">' + esc(m.label) + '</span>'; }).join('') + '</div></div>';
    }

    // function text
    if (n.func) {
      body += '<div class="dsec"><div class="dsec-h">Function</div><p class="muted" style="margin:0;font-size:12px">' + esc(trunc(n.func, 360)) +
        (n.funcRefs && n.funcRefs.length ? ' ' + n.funcRefs.slice(0, 3).map(function (p) { return '<a class="links" target="_blank" rel="noopener" href="' + L.pubmed(p) + '">PMID ' + esc(p) + ' ↗</a>'; }).join(' ') : '') + '</p></div>';
    }

    // Open in databases
    body += '<div class="dsec"><div class="dsec-h">Open in databases</div><div class="links-block">' +
      '<a class="links" target="_blank" rel="noopener" href="' + L.stringGene(sym) + '">STRING ↗</a>' +
      '<a class="links" target="_blank" rel="noopener" href="' + L.ot(n.ensembl) + '">Open Targets ↗</a>' +
      (n.uniprot ? '<a class="links" target="_blank" rel="noopener" href="' + L.uniprot(n.uniprot) + '">UniProt ↗</a>' : '') +
      '<a class="links" target="_blank" rel="noopener" href="' + L.ncbiGene(n.entrez) + '">NCBI Gene ↗</a>' +
      '<a class="links" target="_blank" rel="noopener" href="' + L.ensembl(n.ensembl) + '">Ensembl ↗</a>' +
      (n.mim ? '<a class="links" target="_blank" rel="noopener" href="' + L.omim(n.mim) + '">OMIM ↗</a>' : '') +
      '</div></div>';

    // de-emphasised: Connection + STRING channels (collapsible, at the very bottom)
    body += connectionDetails(o, n) + channelDetails(n);

    // AI block (shown values only; no scoring-internals lines)
    body += sectionAI(sym, 'gene', aiForGene(sym));
    $('drawerBody').innerHTML = body;
    wireCopy();
  }

  function litSection(n) {
    var stop = EN.STOPLIST[n.sym];
    var body = '<div class="dsec"><div class="dsec-h">Literature (co-mention) ' + gloss('literature') + '</div>' +
      '<p class="muted" style="font-size:11px;margin:0 0 6px">Co-mention is hub-independent (a property of the papers), so both paralogs are shown for every gene. Tiers are nested scopes: in title ⊆ title+abstract ⊆ full text. Each count links to its exact Europe PMC query.</p>';
    if (stop) body += '<p class="muted" style="font-size:11.5px;margin:0 0 6px">' + esc(n.sym) + ' is an ambiguous / house-keeping symbol; its counts are shown but excluded from the literature score.</p>';
    var geneTerms = [n.sym].concat(n.syn || []);
    function tierRows(cm, qfn) {
      return [['title', 'in title'], ['abs', 'title+abstract'], ['all', 'full text']].map(function (t) {
        return '<div class="kv"><span class="k">' + t[1] + '</span><span class="v"><a class="linkval" target="_blank" rel="noopener" href="' + L.epmc(qfn(t[0])) + '">' + fmtN(cm[t[0]]) + ' ↗</a></span></div>';
      }).join('');
    }
    // both hubs are always shown (literature, not STRING); a hub the gene does not
    // structurally neighbour is flagged so the count reads as literature-only.
    [['CTBP1', n.comention1, n.s1], ['CTBP2', n.comention2, n.s2]].forEach(function (row) {
      var h = row[0], cm = row[1], neighbour = row[2];
      body += '<div style="margin-bottom:6px"><b style="font-size:12px">' + h + '</b>' +
        (neighbour ? '' : ' <span class="muted" style="font-size:10px">literature only; not a top-250 STRING neighbour of ' + h + '</span>');
      if (!cm) { body += ' <span class="muted" style="font-size:11.5px">co-mention not captured in this snapshot</span></div>'; return; }
      body += tierRows(cm, function (t) { return comentionQuery(HUB_SYN[h], geneTerms, t); }) + '</div>';
    });
    // both-hub co-mention: papers naming the gene alongside BOTH paralogs
    if (n.comentionB) {
      body += '<div style="margin-bottom:6px"><b style="font-size:12px">CTBP1 + CTBP2 (both)</b> <span class="muted" style="font-size:10.5px">papers naming the gene with both paralogs</span>' +
        tierRows(n.comentionB, function (t) { return comentionQueryBoth(geneTerms, t); }) + '</div>';
    }
    // papers
    if (n.refs && n.refs.length) {
      body += '<div style="margin-top:6px">';
      n.refs.slice(0, 6).forEach(function (p) {
        body += '<div class="paper"><div class="pt"><a target="_blank" rel="noopener" href="' + L.pubmed(p.pmid) + '">' + esc(p.t) + ' ↗</a></div>' +
          '<div class="pmeta">' + esc(p.a || '') + (p.y ? ' · ' + esc(p.y) : '') + (p.j ? ' · ' + esc(p.j) : '') + (p.c != null ? ' · cited ' + fmtN(p.c) : '') + '</div></div>';
      });
      body += '</div>';
    }
    return body + '</div>';
  }

  function connectionDetails(o, n) {
    var hubs = (state.hub === 'Both') ? o.hubs : [state.hub];
    var blocks = '';
    hubs.forEach(function (h) {
      var c = o.conn[h]; if (!c) return;
      blocks += '<details class="collapse"><summary><span>Connection · ' + h + ' ' + gloss('composite') + '</span><span class="sumval">Composite ' + fmtC(c.composite) + '/100</span></summary><div class="dc-body">' +
        '<div class="kv"><span class="k">Type ' + gloss('conntype') + '</span><span class="v"><span class="conn-type">' + esc(c.type) + '</span></span></div>' +
        subscore('Physical', c.phys, 'physical') + subscore('Literature', c.lit, 'literature') + subscore('Network context', c.ctx, 'ctx') +
        '<div class="sec-note">Composite = 100 × (0.5·physical + 0.3·literature + 0.2·network). Weights are fixed.</div>' +
        '</div></details>';
    });
    return blocks;
  }
  function subscore(label, v, gl) {
    return '<div class="subscore"><span class="sb-label">' + label + ' ' + gloss(gl) + '</span><span class="sb-bar"><span class="sb-fill" style="width:' + Math.round((v || 0) * 100) + '%"></span></span><span class="num">' + fmtS(v) + '</span></div>';
  }
  function channelDetails(n) {
    var legend = D.meta.channelLegend;
    var hubs = state.hub === 'Both' ? ['CTBP1', 'CTBP2'] : [state.hub];
    var blocks = '';
    hubs.forEach(function (h) {
      var s = h === 'CTBP1' ? n.s1 : n.s2; if (!s) return;
      var keys = ['c', 'e', 'd', 't', 'a', 'p', 'n', 'f'];
      var combinedOnly = keys.slice(1).every(function (k) { return s[k] == null; });
      var grid = keys.map(function (k) { return s[k] == null ? '' : '<div>' + esc(legend[k]) + ': <span class="num">' + fmtS(s[k]) + '</span></div>'; }).join('');
      blocks += '<details class="collapse"><summary><span>STRING channels · ' + h + ' ' + gloss('string') + '</span><span class="sumval">Combined ' + fmtS(s.c) + '</span></summary>' +
        '<div class="dc-body"><div class="channel-grid">' + grid + '</div>' +
        (combinedOnly ? '<div class="combined-only">Combined score only on record for this edge.</div>' : '') +
        '<div class="sec-note"><a class="linkval" target="_blank" rel="noopener" href="' + L.stringPair(h, n.sym) + '">View on STRING ↗</a></div></div></details>';
    });
    return blocks;
  }

  function renderLensDossier(key) {
    var th = EN.THEMES[key];
    state.lens = key;
    $('drawerTitle').innerHTML = '<span class="chip" style="--c:' + th.color + '"><span class="cdot" style="background:' + th.color + '"></span>' + esc(th.label) + '</span>';
    $('drawerSub').innerHTML = th.sector ? 'Sector field (constellation wedge)' : (key === 'aging' ? 'Overlay (gold halo)' : 'Cross-cutting overlay');
    var rows = EN.findings(D, state.hub).filter(function (r) { return r.key === key; });
    var body = '<div class="dsec"><div class="dsec-h">Membership rule ' + gloss(key === 'aging' ? 'aging' : 'fields') + '</div><p class="muted" style="margin:0;font-size:12px">' + esc(th.rule) + '</p></div>';
    body += '<div class="dsec"><div class="dsec-h">Members (' + rows.length + '), ranked by strength</div>';
    rows.forEach(function (r) {
      var ev = r.top && r.top.disease ? esc(r.top.disease) + ' (' + fmtS(r.top.score) + ')' : (r.top && r.top.areaSum != null ? 'area-sum ' + fmtS(r.top.areaSum) : (r.top && r.top.why ? esc(r.top.why) : ''));
      body += '<div class="finding-row" data-sym="' + esc(r.sym) + '" style="border-left-color:' + th.color + '"><div class="finding-main"><div class="finding-gene">' + esc(r.sym) + (state.hub === 'Both' ? ' ' + attrBadge(r.attribution) : '') + '</div><div class="finding-ev">' + ev + (r.source ? ' <a class="links" target="_blank" rel="noopener" href="' + r.source.url + '">' + esc(r.source.label) + ' ↗</a>' : '') + '</div></div></div>';
    });
    body += '</div>';

    // Aging lens: curated ortholog-aware reading list (the one place a lens carries hub papers)
    if (key === 'aging') {
      var hubs = state.hub === 'Both' ? ['CTBP1', 'CTBP2'] : [state.hub];
      hubs.forEach(function (h) {
        var ar = D.hubs[h].agingRefs || [];
        if (!ar.length) return;
        body += '<div class="dsec"><div class="dsec-h">' + h + ' aging/longevity reading list</div>' +
          '<p class="muted" style="font-size:11px;margin:0 0 6px">Curated, ortholog-aware reading list (a human-only co-mention search misses model-organism orthologue work). This is a reading list, not a discovery claim.</p>';
        ar.slice(0, 8).forEach(function (p) {
          body += '<div class="paper"><div class="pt"><a target="_blank" rel="noopener" href="' + L.pubmed(p.pmid) + '">' + esc(p.t) + ' ↗</a></div><div class="pmeta">' + esc(p.a || '') + (p.y ? ' · ' + esc(p.y) : '') + (p.j ? ' · ' + esc(p.j) : '') + '</div></div>';
        });
        body += '</div>';
      });
    }
    body += sectionAI(th.label + ' lens', 'lens', aiForLens(key));
    $('drawerBody').innerHTML = body;
    $('drawerBody').querySelectorAll('.finding-row[data-sym]').forEach(function (r) {
      r.addEventListener('click', function (e) { if (e.target.tagName === 'A') return; openGene(r.getAttribute('data-sym')); });
      r.addEventListener('dblclick', function (e) { if (e.target.tagName === 'A') return; focusGene(r.getAttribute('data-sym')); });
    });
    wireCopy();
  }

  // =========================================================================
  //  AI CONTEXT BUILDERS
  // =========================================================================
  function aiHead(scope) { return 'CTBP INTERACTOME ATLAS: ' + scope + '\nSnapshot ' + D.meta.date + ' · ' + D.meta.species + '\n'; }
  function aiForHub() {
    var both = state.hub === 'Both', hubs = both ? ['CTBP1', 'CTBP2'] : [state.hub];
    var s = aiHead(both ? 'CtBP corepressor pair (CTBP1 + CTBP2)' : state.hub);
    var syn = EN.synthesis(D, state.hub); s += '\n' + syn.lead + '\n' + syn.body + '\n';
    hubs.forEach(function (h) {
      var b = D.hubs[h];
      s += '\n[' + h + '] ' + b.name + '\n';
      s += '  IDs: Ensembl ' + b.ids.ensembl + ' (' + L.ensembl(b.ids.ensembl) + '); Entrez ' + b.ids.entrez + '; UniProt ' + b.ids.uniprot + '\n';
      if (b.cofactor) s += '  Cofactor: ' + b.cofactor + '\n';
      if (b.litTotal != null) s += '  Literature total: ' + b.litTotal + '\n';
      if (b.clinvar) s += '  ClinVar: P/LP ' + b.clinvar.plp + ', VUS ' + b.clinvar.vus + ', total ' + b.clinvar.total + ' (' + L.clinvar(h, 'total') + ')\n';
      if (b.note) s += '  Note: ' + b.note + '\n';
    });
    if (both) { var c = D.meta.counts; s += '\nShared ' + c.shared + ' · CTBP1-only ' + c['CTBP1-only'] + ' · CTBP2-only ' + c['CTBP2-only'] + '\n'; }
    return s;
  }
  function aiForGene(sym) {
    var n = bySym[sym]; var o = analysed.filter(function (x) { return x.sym === sym; })[0] || EN.analyse(D, 'Both').filter(function (x) { return x.sym === sym; })[0];
    var hc = headlineConn(o);
    var s = aiHead('partner gene ' + sym + (n.name ? ' (' + n.name + ')' : ''));
    s += '\nHub attribution: ' + o.attribution + ' (hubs: ' + o.hubs.join(', ') + ')\n';
    s += 'Rank in neighbourhood: ' + (n.rank1 ? 'CTBP1 #' + n.rank1 : '') + (n.rank2 ? (n.rank1 ? ', ' : '') + 'CTBP2 #' + n.rank2 : '') + '\n';
    if (hc) s += 'Connection type: ' + hc.type + '\n';     // rank + type kept; NO composite/weights or channels line
    if (n.intact) s += 'IntAct: ' + (n.intact.type || '') + (n.intact.direct ? ' (direct)' : '') + ', MI ' + n.intact.miscore + ', ' + n.intact.count + ' records (' + L.intact(sym) + ')\n';
    ['CTBP1', 'CTBP2'].forEach(function (h) { var cm = h === 'CTBP1' ? n.comention1 : n.comention2; var nb = h === 'CTBP1' ? n.s1 : n.s2; if (cm) s += 'Co-mention with ' + h + (nb ? '' : ' (literature only, not a STRING neighbour)') + ': title ' + fmtN(cm.title) + ', title+abs ' + fmtN(cm.abs) + ', full-text ' + fmtN(cm.all) + '\n'; });
    if (n.comentionB) s += 'Co-mention with BOTH (CTBP1 + CTBP2): title ' + fmtN(n.comentionB.title) + ', title+abs ' + fmtN(n.comentionB.abs) + ', full-text ' + fmtN(n.comentionB.all) + '\n';
    if (o.fields.length) { s += 'Area memberships: ' + o.fields.map(function (f) { return f.label + (f.top && f.top.disease ? ' [' + f.top.disease + ' ' + fmtS(f.top.score) + ']' : (f.top && f.top.why ? ' [' + f.top.why + ']' : '')); }).join('; ') + '\n'; }
    if (n.dis) s += 'Top diseases: ' + n.dis.slice(0, 6).map(function (d) { return d.n + ' (' + fmtS(d.s) + ')'; }).join('; ') + ' (' + L.ot(n.ensembl) + ')\n';
    if (n.pathways) s += 'Reactome: ' + n.pathways.slice(0, 8).join('; ') + '\n';
    if (n.clinvar) s += 'ClinVar: P/LP ' + n.clinvar.plp + ', VUS ' + n.clinvar.vus + ', total ' + n.clinvar.total + ' (' + L.clinvar(sym, 'total') + ')\n';
    if (n.phenotypes) s += 'HPO phenotypes (' + (n.phenoCount || n.phenotypes.length) + '): ' + n.phenotypes.slice(0, 10).join('; ') + ' (' + L.monarch(n.entrez) + ')\n';
    if (o.mech.length) s += 'Mechanism tags: ' + o.mech.map(function (m) { return m.label; }).join(', ') + '\n';
    if (n.func) s += 'Function: ' + n.func + '\n';
    s += 'STRING network: ' + L.stringGene(sym) + '\n';
    if (n.refs && n.refs.length) s += 'Key papers: ' + n.refs.slice(0, 4).map(function (p) { return 'PMID ' + p.pmid + ' (' + (p.y || '') + ')'; }).join('; ') + '\n';
    return s;
  }
  function aiForLens(key) {
    var th = EN.THEMES[key];
    var rows = EN.findings(D, state.hub).filter(function (r) { return r.key === key; });
    var s = aiHead(th.label + ' lens');
    s += '\nMembership rule: ' + th.rule + '\nMembers (' + rows.length + '):\n';
    rows.forEach(function (r) { s += '  ' + r.sym + ' [' + r.attribution + ']' + (r.top && r.top.disease ? ': ' + r.top.disease + ' (' + fmtS(r.top.score) + ')' : (r.top && r.top.areaSum != null ? ': area-sum ' + fmtS(r.top.areaSum) : (r.top && r.top.why ? ': ' + r.top.why : ''))) + (r.source ? ' (' + r.source.url + ')' : '') + '\n'; });
    if (key === 'aging') {
      ['CTBP1', 'CTBP2'].forEach(function (h) { var ar = D.hubs[h].agingRefs || []; if (ar.length) { s += '\n' + h + ' aging reading list:\n'; ar.slice(0, 8).forEach(function (p) { s += '  PMID ' + p.pmid + ': ' + p.t + ' (' + (p.y || '') + ')\n'; }); } });
    }
    return s;
  }
  function aiForAll() {
    var s = aiHead('full dual-hub interactome export');
    s += aiForHub() + '\n\n=== ALL INTERACTORS (' + D.nodes.length + ') ===\n';
    var A = EN.analyse(D, 'Both');
    A.forEach(function (o) {
      var n = o.node;
      s += '\n# ' + o.sym + ' [' + o.attribution + '] composite(max) ' + fmtC(o.composite) + '\n';
      ['CTBP1', 'CTBP2'].forEach(function (h) { var c = o.conn[h]; if (c) s += '  ' + h + ': ' + c.type + ' · composite ' + fmtC(c.composite) + ' · physical ' + fmtS(c.phys) + ' · literature ' + fmtS(c.lit) + ' · network ' + fmtS(c.ctx) + '\n'; });
      if (o.fields.length) s += '  areas: ' + o.fields.map(function (f) { return f.label; }).join(', ') + '\n';
      if (n.dis) s += '  top disease: ' + (n.dis[0] ? n.dis[0].n + ' (' + fmtS(n.dis[0].s) + ')' : '—') + '\n';
      if (n.clinvar) s += '  ClinVar P/LP ' + n.clinvar.plp + ' / total ' + n.clinvar.total + '\n';
      s += '  STRING ' + L.stringGene(o.sym) + ' · OpenTargets ' + L.ot(n.ensembl) + '\n';
    });
    return s;
  }
  function copyText(txt, btn) {
    var done = function () { if (btn) { var o = btn.innerHTML; btn.classList.add('ok'); btn.innerHTML = '<span>✓</span> Copied'; setTimeout(function () { btn.classList.remove('ok'); btn.innerHTML = o; }, 1400); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, function () { fallbackCopy(txt); done(); });
    else { fallbackCopy(txt); done(); }
  }
  function fallbackCopy(txt) { var ta = el('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); }
  function wireCopy() {
    $('drawerBody').querySelectorAll('.copybtn[data-copy]').forEach(function (b) {
      b.addEventListener('click', function () {
        var pre = $('ai-' + b.getAttribute('data-copy')); if (pre) copyText(pre.textContent, b);
      });
    });
  }
  function exportAll() { copyText(aiForAll(), $('exportBtn')); }

  // ── misc helpers ────────────────────────────────────────────────────────
  function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s; }
  function hashUnit(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; }
  function hexA(hex, a) {
    hex = (hex || '#888').trim();
    if (hex[0] !== '#') return hex;
    var n = hex.length === 4 ? hex.replace(/#(.)(.)(.)/, '#$1$1$2$2$3$3') : hex;
    var r = parseInt(n.slice(1, 3), 16), g = parseInt(n.slice(3, 5), 16), b = parseInt(n.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  function clearNodeCache() { analysed.forEach(function (o) { o.__p = null; }); }

  // ── mobile drawer/panel ────────────────────────────────────────────────────
  function openDrawerMobile() { if (window.innerWidth < 1024) { $('drawer').classList.add('open'); $('scrim').classList.add('show'); } }
  function closeOverlays() { $('drawer').classList.remove('open'); $('left').classList.remove('open'); $('scrim').classList.remove('show'); }

  // ── events ────────────────────────────────────────────────────────────────
  function wire() {
    document.querySelectorAll('#hubSel button').forEach(function (b) {
      b.addEventListener('click', function () { state.hub = b.getAttribute('data-hub'); clearNodeCache(); renderAll(); });
    });
    document.querySelectorAll('#viewTabs .tab').forEach(function (t) { t.addEventListener('click', function () { setView(t.getAttribute('data-view')); }); });
    function matchedSym() {
      var v = $('focusInput').value.trim().toUpperCase();
      if (!v) return null;
      var m = D.nodes.filter(function (n) { return n.sym.toUpperCase() === v; })[0];
      return m ? m.sym : null;
    }
    // Apply focus the MOMENT a gene is typed in and found. `input` fires on every
    // keystroke and when an option is picked from the datalist, so the views update
    // immediately (not only on blur/Enter, which is what `change` waits for).
    $('focusInput').addEventListener('input', function () {
      if (!$('focusInput').value.trim()) { clearFocus(); return; }
      var sym = matchedSym();
      if (sym && sym !== state.focus) focusGene(sym);
    });
    $('focusInput').addEventListener('change', function () {   // fallback: Enter / blur
      var sym = matchedSym();
      if (sym && sym !== state.focus) focusGene(sym);
    });
    $('focusInput').addEventListener('keydown', function (e) { if (e.key === 'Escape') { $('focusInput').value = ''; clearFocus(); } });
    $('focusClear').addEventListener('click', function () { $('focusInput').value = ''; clearFocus(); $('focusInput').focus(); });
    $('netClear').addEventListener('click', function () { $('focusInput').value = ''; clearFocus(); });
    $('limitRange').addEventListener('input', function () { state.limit = +$('limitRange').value; $('limitVal').textContent = state.limit; renderActiveView(); });
    $('themeBtn').addEventListener('click', toggleTheme);
    $('srcBtn').addEventListener('click', function () { var ins = $('insight'); var open = ins.classList.toggle('hidden') === false; $('srcBtn').setAttribute('aria-pressed', open ? 'true' : 'false'); });
    $('insightClose').addEventListener('click', function () { $('insight').classList.add('hidden'); $('srcBtn').setAttribute('aria-pressed', 'false'); });
    $('brandHome').addEventListener('click', goHub);
    $('drawerHome').addEventListener('click', goHub);
    $('menuBtn').addEventListener('click', function () { $('left').classList.toggle('open'); $('scrim').classList.toggle('show'); });
    $('dossierBtn').addEventListener('click', function () { $('drawer').classList.toggle('open'); $('scrim').classList.toggle('show'); });
    $('scrim').addEventListener('click', closeOverlays);
    // canvas clicks: single = open dossier, double = trace (enter focus mode)
    $('constellation').addEventListener('click', function (e) { var s = hitTest(cPos, e, $('constellation')); if (s) openGene(s); });
    $('constellation').addEventListener('dblclick', function (e) { var s = hitTest(cPos, e, $('constellation')); if (s) focusGene(s); });
    $('network').addEventListener('click', function (e) { var s = hitTest(nPos, e, $('network')); if (s) openGene(s); });
    $('network').addEventListener('dblclick', function (e) { var s = hitTest(nPos, e, $('network')); if (s) focusGene(s); });
    window.addEventListener('resize', function () { clearNodeCache(); renderActiveView(); });
  }
  function hitTest(cache, e, cv) {
    var r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, best = null, bd = 1e9;
    cache.forEach(function (p) { var d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y); if (d < p.r * p.r && d < bd) { bd = d; best = p.sym; } });
    return best;
  }

  // ── init ────────────────────────────────────────────────────────────────
  function init() {
    tipEl = $('tooltip');
    if (!D || !EN) { document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif">Could not load data. Run the pipeline (python3 data/run_all.py) to produce app-data.js.</div>'; return; }
    initTheme();
    wire();
    bindGloss(document);
    recompute();
    renderControls(); renderInsight(); renderDrawer(); setView('constellation');
    // intro
    var noboot = /[?&]noboot\b/.test(location.search);
    var intro = $('intro');
    if (noboot) intro.classList.add('done');
    else setTimeout(function () { intro.classList.add('done'); }, 1150);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
