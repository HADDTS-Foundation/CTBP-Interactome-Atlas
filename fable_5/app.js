/*
 * app.js  -  CTBP Interactome Atlas front end (rendering, interaction, views,
 * drawer, discoveries, export). Reads window.CTBP_DATA + window.CTBP_ENGINE.
 * Offline-first: no network at load; every shown value links to a live record,
 * user-triggered only. Owns hub selection (CTBP1 / CTBP2 / Both, default Both)
 * and the focus-gene state.
 */
(function () {
  "use strict";
  var D = window.CTBP_DATA, E = window.CTBP_ENGINE;
  if (!D || !E) { document.getElementById("intro").innerHTML = "<div class='muted'>Data or engine failed to load.</div>"; return; }

  // ---------------------------------------------------------------- state -----
  var S = {
    hub: "Both", focus: null, selected: null, lens: null,
    view: "constellation", limit: 120, drawerMode: "hub"
  };
  var isMobile = matchMedia("(max-width:1023px)").matches;
  if (isMobile) S.limit = 60;

  var bySym = {}; D.nodes.forEach(function (n) { bySym[n.sym] = n; });
  var HUBS = E.HUBS, TH = E.THEMES, ORDER = E.THEME_ORDER;
  var VIEWS = [
    { k: "constellation", label: "Constellation", ic: "✦" },
    { k: "table", label: "Table", ic: "▦" },
    { k: "findings", label: "Findings", ic: "◆" },
    { k: "discoveries", label: "Discoveries", ic: "✷" },
    { k: "network", label: "Network", ic: "⬡" }
  ];

  // ---------------------------------------------------------------- helpers ---
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function num(x) { return (typeof x === "number" && !isNaN(x)) ? x : null; }
  function f2(x) { return x == null ? "—" : (Math.round(x * 100) / 100).toFixed(2); }
  function cvar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function areaColor(key) { return cvar("--area-" + key) || "#888"; }
  function tint(key, pct) { return "color-mix(in srgb, var(--area-" + key + ") " + pct + "%, var(--surface-container-lowest))"; }
  function ext(url, text) { return '<a class="ext" target="_blank" rel="noopener" href="' + esc(url) + '">' + esc(text) + "</a>"; }
  function gi(key) { return '<i class="gi" data-gloss="' + key + '" tabindex="0" aria-label="definition">i</i>'; }

  // ---------------------------------------------------------------- provenance -
  var P = {
    string: function (sym) { return "https://string-db.org/cgi/network?identifiers=" + encodeURIComponent(sym) + "&species=9606"; },
    stringPair: function (a, b) { return "https://string-db.org/cgi/network?identifiers=" + encodeURIComponent(a + "\r" + b) + "&species=9606"; },
    ot: function (ensg) { return "https://platform.opentargets.org/target/" + ensg; },
    otAssoc: function (ensg) { return "https://platform.opentargets.org/target/" + ensg + "/associations"; },
    uniprot: function (acc) { return "https://www.uniprot.org/uniprotkb/" + acc + "/entry"; },
    ncbi: function (ent) { return "https://www.ncbi.nlm.nih.gov/gene/" + ent; },
    ensembl: function (ensg) { return "https://www.ensembl.org/Homo_sapiens/Gene/Summary?g=" + ensg; },
    omim: function (mim) { return "https://www.omim.org/entry/" + mim; },
    reactome: function (stid) { return "https://reactome.org/content/detail/" + stid; },
    pubmed: function (pmid) { return "https://pubmed.ncbi.nlm.nih.gov/" + pmid + "/"; },
    hpoApi: function (ent) { return "https://ontology.jax.org/api/network/annotation/NCBIGene:" + ent; },
    monarch: function (ent) { return "https://monarchinitiative.org/NCBIGene:" + ent; },
    biogrid: function (sym) { return "https://thebiogrid.org/search.php?search=" + encodeURIComponent(sym) + "&organism=9606"; },
    clinvar: function (sym, kind) {
      var base = "https://www.ncbi.nlm.nih.gov/clinvar/?term=" + encodeURIComponent(sym) + "%5Bgene%5D";
      if (kind === "plp") return base + "+AND+" + encodeURIComponent('(clinsig_pathogenic[Filter] OR clinsig_likely_path[Filter])');
      if (kind === "vus") return base + "+AND+" + encodeURIComponent("clinsig_vus[Filter]");
      return base;
    }
  };
  // Europe PMC query builder — BYTE-IDENTICAL to data/epmc.py (reproducibility invariant).
  var EPMC_EXCL = ' NOT "CTBP1-AS2" NOT "CTBP1-DT" NOT "CTBP1-AS1"';
  function epmcGroup(terms, tier) {
    var inner;
    if (tier === "title") inner = terms.map(function (t) { return 'TITLE:"' + t + '"'; }).join(" OR ");
    else if (tier === "abs") inner = terms.map(function (t) { return 'TITLE:"' + t + '" OR ABSTRACT:"' + t + '"'; }).join(" OR ");
    else inner = terms.map(function (t) { return '"' + t + '"'; }).join(" OR ");
    return "(" + inner + ")";
  }
  function epmcQuery(geneSyn, hubs, tier) {
    var parts = [epmcGroup(geneSyn, tier)];
    hubs.forEach(function (h) { parts.push(epmcGroup([h], tier)); });
    return parts.join(" AND ") + EPMC_EXCL;
  }
  function epmcUrl(geneSyn, hubs, tier) { return "https://europepmc.org/search?query=" + encodeURIComponent(epmcQuery(geneSyn, hubs, tier)); }

  // ---------------------------------------------------------------- glossary --
  var GLOSS = {
    composite: "A heuristic prioritisation score (0–100), not a probability or a measure of importance. Fixed editorial weights: physical 0.5, literature 0.3, network 0.2. It ranks partners for attention; it does not rank their biological significance.",
    phys: "Physical evidence from STRING experiment + curated-database channels only (the combined score is deliberately excluded so text-mining does not inflate it). Confidence of support, not proof of direct binding.",
    lit: "Co-mention in the literature, log-scaled. Correlation, biased toward well-studied genes. It is not evidence of interaction.",
    ctx: "Network context: how connected a partner is to the rest of the neighbourhood. Topology, not functional proof.",
    string: "STRING association confidence per channel (0–1). Confidence, not proof of direct binding; 'Core complex' / 'Physical interactor' are labels of strong support, not proven complexes.",
    intact: "IntAct curated experimental interactions (human–human). Strong support, not proof of a complex.",
    biogrid: "BioGRID curated PHYSICAL interactions, human only, yeast-two-hybrid excluded. Experimental support beside IntAct, not the STRING database channel.",
    comention: "Synonym-aware co-mention counts across three NESTED scopes: in title ⊆ title+abstract ⊆ full text (so title ≤ abs ≤ all). Correlation in the literature, biased toward well-studied genes; not interaction.",
    network: "Partner-to-partner topology within the neighbourhood. Structural context, not functional proof.",
    mech: "Mechanism tags are keyword matches against the function text. Suggestive, not evidential.",
    reactome: "Reactome pathways the gene is annotated to (specific leaves, umbrellas removed). The gene's own annotation, not a shared-with-CTBP or patient-specific claim.",
    hpo: "Human Phenotype Ontology terms annotated to the gene. The gene's own annotations, not a patient-specific claim.",
    clinvar: "Gene-level ClinVar tallies (P/LP, VUS, total). A database count, not a clinical interpretation of any individual, and not medical advice.",
    fields: "Fields are editorial lenses (which disease areas to show). Which GENES belong is decided only by the data, never by hand; the test harness proves it.",
    aictx: "This export is everything shown here — values, scores and the source links. Copy it with Copy, paste it into your AI assistant as context, then ask your question; the model can read the figures and follow the links to verify them. An LLM can over-interpret, so check answers against the linked sources.",
    tract: "Open Targets tractability estimates whether a molecule could engage the protein, not whether it should. Kept one click away, not shown as a badge.",
    aging: "Aging/longevity membership from GenAge ∪ LongevityMap (significant). An overlay (gold halo), never a disease sector. NAD+/redox is a mechanism tag, not this area.",
    attribution: "Which hub(s) a partner STRING-neighbours: shared (both), CTBP1-only, or CTBP2-only. Co-mention literature is hub-independent and shown for both hubs regardless."
  };

  // ---------------------------------------------------------------- tooltip ---
  var tt = $("#tt"), ttPinned = false;
  function showTT(el) {
    var key = el.getAttribute("data-gloss"); if (!GLOSS[key]) return;
    tt.textContent = GLOSS[key];
    tt.classList.add("show");
    var r = el.getBoundingClientRect(), tr = tt.getBoundingClientRect();
    var top = r.top - tr.height - 8, left = r.left + r.width / 2 - tr.width / 2;
    if (top < 6) top = r.bottom + 8;
    left = Math.max(6, Math.min(left, innerWidth - tr.width - 6));
    tt.style.top = top + "px"; tt.style.left = left + "px";
  }
  function hideTT() { tt.classList.remove("show"); ttPinned = false; }
  document.addEventListener("mouseover", function (e) { var g = e.target.closest && e.target.closest("[data-gloss]"); if (g && !isMobile) showTT(g); });
  document.addEventListener("mouseout", function (e) { if (!isMobile && !ttPinned && e.target.closest && e.target.closest("[data-gloss]")) hideTT(); });
  document.addEventListener("focusin", function (e) { var g = e.target.closest && e.target.closest("[data-gloss]"); if (g) showTT(g); });
  document.addEventListener("focusout", hideTT);
  document.addEventListener("click", function (e) {
    var g = e.target.closest && e.target.closest("[data-gloss]");
    if (g && isMobile) { e.preventDefault(); if (ttPinned) hideTT(); else { showTT(g); ttPinned = true; } return; }
    if (ttPinned) hideTT();
  });

  // ---------------------------------------------------------------- clipboard -
  function copyText(txt, btn) {
    function done() { if (btn) { var o = btn.innerHTML; btn.innerHTML = "✓ Copied"; setTimeout(function () { btn.innerHTML = o; }, 1400); } }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, function () { fallbackCopy(txt); done(); });
    else { fallbackCopy(txt); done(); }
  }
  function fallbackCopy(txt) { var ta = document.createElement("textarea"); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {} document.body.removeChild(ta); }

  // ================================================================ CONTROLS ==
  function hubSegHTML(idPrefix) {
    return '<div class="seg" data-seg="hub">' + ["CTBP1", "CTBP2", "Both"].map(function (h) {
      return '<button data-hub="' + h + '" class="' + (S.hub === h ? "on" : "") + '">' + h + "</button>";
    }).join("") + "</div>";
  }
  function rollupHTML() {
    if (S.hub !== "Both") return "";
    var nb = D.meta.neighborhood;
    return '<div class="rollup"><span><b>' + nb.shared + "</b> shared</span><span><b>" + (nb.CTBP1 - nb.shared) +
      "</b> CTBP1-only</span><span><b>" + (nb.CTBP2 - nb.shared) + "</b> CTBP2-only</span></div>";
  }
  function focusHTML() {
    var v = S.focus || "";
    return '<div class="focuswrap"><input id="focusInput" type="text" autocomplete="off" spellcheck="false" placeholder="Focus a gene (trace its route)…" value="' + esc(v) + '">' +
      (v ? '<button class="clr" id="focusClr" title="Clear focus (Esc)">✕</button>' : "") +
      '<div class="ac" id="focusAC"></div></div>';
  }

  function renderLeft() {
    var counts = E.themeSummary(D, S.hub);
    var html = "";
    html += '<div class="section"><div class="lbl">Hub</div>' + hubSegHTML() + rollupHTML() + "</div>";
    html += '<div class="section"><div class="lbl">Focus gene ' + gi("attribution") + "</div>" + focusHTML() +
      '<div class="muted tiny" style="margin-top:5px">Type or pick a gene to trace how the selected hub(s) reach it. Double-click any gene to trace it too.</div></div>';
    html += '<div class="section"><div class="lbl">Fields (lenses) ' + gi("fields") + "</div>";
    ORDER.forEach(function (k) {
      var t = TH[k], on = S.lens === k;
      html += '<div class="lens ' + (t.sector ? "sector " : "") + (on ? "on" : "") + '" data-lens="' + k + '">' +
        '<span class="dot" style="background:' + areaColor(k) + '"></span><span class="nm">' + esc(t.label) + "</span>" +
        '<span class="ct">' + (counts[k] || 0) + "</span></div>";
    });
    html += "</div>";
    html += '<div class="section limitrow"><div class="lbl">Display limit</div>' +
      '<input type="range" id="limit" min="20" max="' + D.nodes.length + '" step="10" value="' + S.limit + '">' +
      '<div class="muted tiny" style="margin-top:4px">Drawing top <b id="limitv">' + S.limit + "</b> partners by composite score.</div></div>";
    $("#left").innerHTML = html;
  }

  function renderMobileBar() {
    if (!isMobile) return;
    $("#mbar").innerHTML = hubSegHTML() + focusHTML() + rollupHTML();
  }

  // ================================================================ INSIGHT ===
  function sourcePills() {
    return (D.meta.sources || []).map(function (s) { return '<a class="ext" target="_blank" rel="noopener" href="' + esc(s.url) + '">' + esc(s.name) + "</a>"; }).join("");
  }
  function hubIdLinks(h) {
    var hb = D.hubs[h], id = hb.ids || {};
    var a = [];
    if (id.string) a.push(ext("https://string-db.org/network/" + id.string, "STRING"));
    a.push(ext(P.ot(id.ensembl), "Open Targets"));
    a.push(ext(P.uniprot(id.uniprot), "UniProt"));
    a.push(ext(P.ncbi(id.entrez), "NCBI Gene"));
    a.push(ext(P.ensembl(id.ensembl), "Ensembl"));
    if (hb.mim) a.push(ext(P.omim(hb.mim), "OMIM"));
    return a.join("");
  }
  function hubIdPills(h) { return '<span class="hubgroup"><span class="hl">' + h + '</span>' + hubIdLinks(h) + "</span>"; }
  function renderInsight() {
    var hubs = S.hub === "Both" ? HUBS : [S.hub];
    var idrow = hubs.map(hubIdPills).join("");
    var m = D.meta;
    var caption = '<div class="caption"><div class="lead">' +
      (m.neighborhood.union) + " STRING interactors of human CTBP1 + CTBP2, the top-250 by combined score for each paralog, merged. Snapshot " + esc(m.date) + ".</div>" +
      '<div class="muted small" style="margin-top:5px">Sources: ' + sourcePills() + "</div></div>";
    var meta = '<div class="meta-items"><span class="mi">Built <b>' + esc(m.date) + '</b></span>' +
      '<span class="mi">Genes <b>' + m.nodeCount + '</b></span><span class="mi">Edges <b>' + m.edgeCount + '</b></span>' +
      '<span class="mi">BioGRID <b>' + esc(m.biogridRelease || "—") + "</b></span></div>";
    var actions = '<div class="links" style="margin-top:10px">' +
      ext("app_build_prompt.md", "Method") +
      ' <button class="cta" id="exportBtn" title="Copies the entire sourced AI context (both hubs, all ten fields, every interactor with its per-hub attribution and connection) as plain text (~500,000 tokens) for pasting into an LLM.">⧉ Export AI Context of all Interactions</button></div>';
    var offline = '<div class="offline-note"><h4>Consider running this tool offline</h4>' +
      '<div class="muted small">This page may be served over the internet via GitHub Pages. For a permanent, fully self-contained copy that works anywhere with no connection, download it from the HADDTS Foundation on ' +
      ext("https://github.com/haddtsfoundation", "GitHub") + ".</div></div>";
    $("#insight").innerHTML = '<button class="iconbtn closeX" id="insightClose" title="Close">✕</button>' +
      '<div class="links">' + idrow + '</div>' + meta + caption + actions + offline;
  }

  // ================================================================ TABS ======
  function renderTabs() {
    $("#tabs").innerHTML = VIEWS.map(function (v) { return '<button data-view="' + v.k + '" class="' + (S.view === v.k ? "on" : "") + '">' + v.label + "</button>"; }).join("");
    if (isMobile) $("#bnav").innerHTML = VIEWS.map(function (v) { return '<button data-view="' + v.k + '" class="' + (S.view === v.k ? "on" : "") + '"><span class="ic">' + v.ic + "</span>" + v.label + "</button>"; }).join("");
    VIEWS.forEach(function (v) { $("#v-" + v.k).classList.toggle("on", S.view === v.k); });
  }

  // scoped, limited node rows (respect lens filter + focus)
  function scopedRows() {
    var rows = E.analyse(D, S.hub);
    if (S.lens) rows = rows.filter(function (r) { return r.themes.some(function (t) { return t.key === S.lens; }); });
    return rows;
  }
  function limitedRows() { return scopedRows().slice(0, S.limit); }

  // ================================================================ VIEWS =====
  function renderView() {
    if (S.view === "constellation") drawConstellation();
    else if (S.view === "table") renderTable();
    else if (S.view === "findings") renderFindings();
    else if (S.view === "discoveries") renderDiscoveries();
    else if (S.view === "network") drawNetwork();
  }

  // ---- Table ----
  var sortKey = "composite", sortDir = -1;
  function renderTable() {
    var rows = limitedRows(), both = S.hub === "Both";
    rows = rows.slice().sort(function (a, b) {
      var av = tval(a, sortKey), bv = tval(b, sortKey);
      if (av === bv) return 0; return (av > bv ? 1 : -1) * sortDir;
    });
    var cols = [["sym", "Gene"], ["attribution", "Hub"], ["composite", "Composite"], ["type", "Type"],
      ["c1", "CTBP1 comp"], ["c2", "CTBP2 comp"], ["p1", "CTBP1 phys"], ["p2", "CTBP2 phys"], ["lit", "Lit (max)"], ["dom", "Dominant area"]];
    if (!both) cols = [["sym", "Gene"], ["composite", "Composite"], ["type", "Type"], ["phys", "Physical"], ["lit", "Literature"], ["ctx", "Network"], ["dom", "Dominant area"]];
    var h = '<div class="tblscroll"><table class="evi"><thead><tr>' + cols.map(function (c) {
      var isNum = ["composite", "c1", "c2", "p1", "p2", "lit", "phys", "ctx"].indexOf(c[0]) >= 0;
      return '<th class="' + (isNum ? "num" : "") + '" data-sort="' + c[0] + '">' + c[1] + (sortKey === c[0] ? (sortDir < 0 ? " ▾" : " ▴") : "") + "</th>";
    }).join("") + "</tr></thead><tbody>";
    rows.forEach(function (r) {
      var c1 = r.conn.CTBP1, c2 = r.conn.CTBP2, dom = r.dominant;
      var domChip = dom ? '<span class="chip" style="background:' + tint(dom.key, 12) + ';border-color:' + areaColor(dom.key) + '"><span class="cd" style="background:' + areaColor(dom.key) + '"></span>' + esc(TH[dom.key].label) + "</span>" : '<span class="muted">—</span>';
      h += '<tr data-gene="' + r.sym + '"><td><b>' + r.sym + "</b></td>";
      if (both) {
        h += '<td><span class="attrbadge attr-' + r.attribution + '">' + (r.attribution === "shared" ? "1+2" : (r.attribution === "CTBP1" ? "1" : "2")) + "</span></td>";
        h += '<td class="num">' + r.composite.toFixed(1) + "</td><td>" + typeCell(r) + "</td>";
        h += '<td class="num">' + (c1 ? c1.composite.toFixed(1) : "—") + '</td><td class="num">' + (c2 ? c2.composite.toFixed(1) : "—") + "</td>";
        h += '<td class="num">' + (c1 ? f2(c1.phys) : "—") + '</td><td class="num">' + (c2 ? f2(c2.phys) : "—") + "</td>";
        h += '<td class="num">' + (Math.max(num(r.node.lit1) || 0, num(r.node.lit2) || 0)) + "</td><td>" + domChip + "</td>";
      } else {
        var c = S.hub === "CTBP1" ? c1 : c2;
        h += '<td class="num">' + r.composite.toFixed(1) + "</td><td>" + typeCell(r) + "</td>";
        h += '<td class="num">' + (c ? f2(c.phys) : "—") + '</td><td class="num">' + (c ? f2(c.lit) : "—") + '</td><td class="num">' + (c ? f2(c.ctx) : "—") + "</td><td>" + domChip + "</td>";
      }
      h += "</tr>";
    });
    h += "</tbody></table></div>";
    $("#v-table").innerHTML = h;
  }
  function typeCell(r) {
    var t = S.hub === "Both" ? (r.type.CTBP1 || r.type.CTBP2) : (S.hub === "CTBP1" ? r.type.CTBP1 : r.type.CTBP2);
    return '<span class="small">' + esc(t || "—") + "</span>";
  }
  function tval(r, k) {
    var c1 = r.conn.CTBP1, c2 = r.conn.CTBP2, c = S.hub === "CTBP1" ? c1 : c2;
    switch (k) {
      case "sym": return r.sym; case "attribution": return r.attribution;
      case "composite": return r.composite; case "type": return typeCell(r);
      case "c1": return c1 ? c1.composite : -1; case "c2": return c2 ? c2.composite : -1;
      case "p1": return c1 ? c1.phys : -1; case "p2": return c2 ? c2.phys : -1;
      case "phys": return c ? c.phys : -1; case "ctx": return c ? c.ctx : -1;
      case "lit": return Math.max(num(r.node.lit1) || 0, num(r.node.lit2) || 0);
      case "dom": return r.dominant ? r.dominant.label : "";
    }
    return 0;
  }

  // ---- Findings ----
  function renderFindings() {
    var fs = E.findings(D, S.hub);
    if (S.lens) fs = fs.filter(function (f) { return f.area === S.lens; });
    var expo = E.themeExposure(D, S.hub);
    var chips = '<div class="chips" style="margin-bottom:12px"><span class="chip" data-lens="" style="cursor:pointer;' + (!S.lens ? "border-color:var(--primary)" : "") + '">All areas</span>' +
      expo.map(function (e) {
        return '<span class="chip" data-lens="' + e.key + '" style="cursor:pointer;background:' + tint(e.key, 12) + ';border-color:' + (S.lens === e.key ? areaColor(e.key) : "var(--outline-variant)") + '"><span class="cd" style="background:' + areaColor(e.key) + '"></span>' + esc(e.label) + " · " + e.count + "</span>";
      }).join("") + "</div>";
    var h = chips;
    fs.slice(0, 300).forEach(function (f) {
      var col = areaColor(f.area);
      var prov = findingProv(f);
      h += '<div class="frow" data-gene="' + f.sym + '" style="border-left-color:' + col + '"><div class="fmain">' +
        '<b>' + f.sym + '</b> <span class="attrbadge attr-' + f.attribution + '">' + (f.attribution === "shared" ? "1+2" : (f.attribution === "CTBP1" ? "1" : "2")) + "</span> " +
        '<span class="chip" style="background:' + tint(f.area, 12) + ';border-color:' + col + '"><span class="cd" style="background:' + col + '"></span>' + esc(f.label) + "</span>" +
        '<div class="muted small" style="margin-top:4px">' + prov + "</div></div>" +
        '<div class="num small muted">sev ' + f.sev + "</div></div>";
    });
    if (fs.length === 0) h += '<div class="muted">No memberships in this scope.</div>';
    $("#v-findings").innerHTML = h;
  }
  function findingProv(f) {
    if (f.kind === "aging") {
      var ag = f.top || {};
      if (ag.genage) return "GenAge human ageing gene" + (ag.why ? " (" + esc(ag.why) + ")" : "") + (ag.id ? " · GenAge:" + esc(ag.id) : "");
      if (ag.pmids && ag.pmids.length) return "LongevityMap significant association · " + ext(P.pubmed(ag.pmids[0]), "PMID " + ag.pmids[0]);
      return "GenAge ∪ LongevityMap member";
    }
    if (f.kind === "ot") {
      var ex = (f.matches || []).slice(0, 3).map(function (d) { return esc(d.n) + " (" + f2(d.s) + ")"; }).join(", ");
      return "EFO area-sum " + f2(f.top.sum) + " > 0.15 · e.g. " + (ex || "—") + " · " + ext(P.otAssoc(bySym[f.sym].ensembl), "Open Targets");
    }
    var t = f.top || {};
    return "OT disease: " + esc(t.n) + " (score " + f2(t.s) + ") · " + ext(P.otAssoc(bySym[f.sym].ensembl), "Open Targets");
  }

  // ---- Discoveries ----
  function renderDiscoveries() {
    var feed = E.discoveries(D, S.hub);
    if (S.lens) feed = feed.filter(function (d) { return bySym[d.sym] && E.themesFor(bySym[d.sym]).some(function (t) { return t.key === S.lens; }); });
    var h = '<div class="muted small" style="margin-bottom:10px">A blended, de-duplicated lead feed: strongest connections, best exemplar per disease area, most co-mentioned, and under-explored (strong physical, thin literature)' + (S.hub === "Both" ? ", plus paralog contrasts (shared vs divergent)" : "") + '. Click a card to focus that gene.</div><div class="grid">';
    feed.forEach(function (d) {
      var dom = d.dominant, col = dom ? areaColor(dom.key) : "var(--outline)";
      h += '<div class="card" data-gene="' + d.sym + '" style="border-top-color:' + col + '">' +
        '<div class="cat">' + esc(d.category) + "</div><h4>" + d.sym + ' <span class="attrbadge attr-' + d.attribution + '">' + (d.attribution === "shared" ? "1+2" : (d.attribution === "CTBP1" ? "1" : "2")) + "</span></h4>" +
        '<div class="muted small" style="margin:4px 0">' + esc(bySym[d.sym].name || "") + "</div>" +
        '<div class="small">' + esc(d.reason) + "</div>" +
        (dom ? '<div class="chips"><span class="chip" style="background:' + tint(dom.key, 12) + ';border-color:' + col + '"><span class="cd" style="background:' + col + '"></span>' + esc(TH[dom.key].label) + "</span></div>" : "") +
        "</div>";
    });
    h += "</div>";
    $("#v-discoveries").innerHTML = h;
  }

  // ================================================================ CANVAS ====
  function fitCanvas(cv) {
    var wrap = cv.parentElement, dpr = Math.min(devicePixelRatio || 1, 2);
    var w = wrap.clientWidth, hh = wrap.clientHeight || 460;
    cv.width = w * dpr; cv.height = hh * dpr;
    var ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: hh };
  }
  var cvNodes = [];         // hit-test records for constellation
  var nvNodes = [];         // hit-test for network

  function drawConstellation() {
    ensureCanvasChrome("cv-wrap", constellationLegend(), constellationHint());
    var cv = $("#cv"), g = fitCanvas(cv), ctx = g.ctx, w = g.w, h = g.h;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = cvar("--constellation-bg"); ctx.fillRect(0, 0, w, h);
    var cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 30;
    var sectors = ORDER.filter(function (k) { return TH[k].sector; });
    // wedge guides
    ctx.save();
    ctx.strokeStyle = cvar("--outline-variant"); ctx.globalAlpha = .5;
    for (var i = 0; i < sectors.length; i++) {
      var a = (i / sectors.length) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke();
    }
    ctx.restore();
    var rows = limitedRows();
    cvNodes = [];
    var maxComp = 1; rows.forEach(function (r) { if (r.composite > maxComp) maxComp = r.composite; });
    rows.forEach(function (r, idx) {
      var sec = r.dominantSector, si = sec ? sectors.indexOf(sec.key) : -1;
      var baseA, colr;
      if (si >= 0) { baseA = (si / sectors.length) * Math.PI * 2 - Math.PI / 2; colr = areaColor(sec.key); }
      else { baseA = -Math.PI / 2; colr = cvar("--on-surface-variant"); }
      var wedge = (Math.PI * 2 / sectors.length) * 0.8;
      var jitter = (hashStr(r.sym) % 1000 / 1000 - 0.5) * wedge;
      var ang = baseA + jitter + (si < 0 ? (idx % 7 - 3) * 0.05 : 0);
      var rad = R * (1 - r.composite / (maxComp * 1.15)) * (0.55) + R * 0.28;
      var x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad;
      var sz = 3 + (r.composite / maxComp) * 6;
      // aging halo
      if (r.node.aging) { ctx.beginPath(); ctx.arc(x, y, sz + 5, 0, 7); ctx.fillStyle = "color-mix(in srgb," + areaColor("aging") + " 55%, transparent)"; ctx.globalAlpha = .5; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.beginPath(); ctx.arc(x, y, sz, 0, 7); ctx.fillStyle = colr; ctx.fill();
      // hub attribution ring (Both)
      if (S.hub === "Both") { ctx.lineWidth = 1.6; ctx.strokeStyle = r.attribution === "shared" ? cvar("--tertiary") : (r.attribution === "CTBP1" ? cvar("--primary") : cvar("--secondary")); ctx.stroke(); }
      if (r.sym === S.focus || r.sym === S.selected) { ctx.beginPath(); ctx.arc(x, y, sz + 3, 0, 7); ctx.lineWidth = 2; ctx.strokeStyle = cvar("--primary-bright"); ctx.stroke(); }
      cvNodes.push({ x: x, y: y, r: sz + 6, sym: r.sym });
    });
    // hub centre
    ctx.beginPath(); ctx.arc(cx, cy, 13, 0, 7); ctx.fillStyle = cvar("--brand-navy"); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = "700 10px " + cvar("--mono"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(S.hub === "Both" ? "CtBP" : S.hub, cx, cy);
    // sector labels
    ctx.font = "600 10px " + cvar("--sans"); ctx.fillStyle = cvar("--on-surface-variant");
    sectors.forEach(function (k, i) {
      var a = (i / sectors.length) * Math.PI * 2 - Math.PI / 2 + (Math.PI / sectors.length);
      var lx = cx + Math.cos(a) * (R + 4), ly = cy + Math.sin(a) * (R + 4);
      ctx.textAlign = Math.cos(a) < -0.3 ? "right" : (Math.cos(a) > 0.3 ? "left" : "center");
      ctx.fillText(TH[k].label.split(" ")[0], lx, ly);
    });
  }
  function constellationLegend() {
    var sectors = ORDER.filter(function (k) { return TH[k].sector; });
    return "<b>Disease sectors</b>" + sectors.map(function (k) { return '<div class="li"><i style="background:' + areaColor(k) + '"></i>' + esc(TH[k].label) + "</div>"; }).join("") +
      '<div class="li"><i style="background:' + areaColor("aging") + '"></i>gold halo = aging-linked</div>';
  }
  function constellationHint() { return "click a node for its dossier · double-click to trace its route · gold halo = aging-linked"; }

  function drawNetwork() {
    var focusG = S.focus && bySym[S.focus] ? S.focus : null;
    ensureCanvasChrome("nv-wrap", "", focusG ? "" : "Focus a gene (left panel or double-click) to trace how each hub reaches it.", focusG);
    var cv = $("#nv"), g = fitCanvas(cv), ctx = g.ctx, w = g.w, h = g.h;
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = cvar("--constellation-bg"); ctx.fillRect(0, 0, w, h);
    nvNodes = [];
    if (focusG) drawFocusGraph(ctx, w, h, focusG);
    else drawOverview(ctx, w, h);
  }

  function drawFocusGraph(ctx, w, h, G) {
    var hubs = S.hub === "Both" ? HUBS : [S.hub];
    var pos = {}, i;
    // hubs on the left, G on the right, intermediaries in the middle
    hubs.forEach(function (hh, k) { pos[hh] = { x: 70, y: h * (k + 1) / (hubs.length + 1), hub: true }; });
    pos[G] = { x: w - 70, y: h / 2, focus: true };
    var allRoutes = [], mids = {};
    hubs.forEach(function (hh) {
      var rs = E.routes(D, hh, G, { maxDepth: 3, top: 3 });
      rs.forEach(function (rt) { allRoutes.push({ hub: hh, rt: rt }); rt.path.forEach(function (p) { if (p !== hh && p !== G) mids[p] = 1; }); });
    });
    var midList = Object.keys(mids).filter(function (m) { return !pos[m]; }), midX = w / 2;
    midList.forEach(function (m, k) { pos[m] = { x: midX + (k % 2 ? 60 : -60), y: (h) * (k + 1) / (midList.length + 1), hub: HUBS.indexOf(m) >= 0 }; });
    // draw edges
    ctx.lineWidth = 1.5; ctx.font = "10px " + cvar("--mono");
    allRoutes.forEach(function (o) {
      o.rt.edges.forEach(function (e) {
        var pa = pos[e.a], pb = pos[e.b]; if (!pa || !pb) return;
        ctx.strokeStyle = cvar("--outline"); ctx.globalAlpha = .8;
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke(); ctx.globalAlpha = 1;
        var mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
        ctx.fillStyle = cvar("--on-surface-variant"); ctx.textAlign = "center";
        ctx.fillText(f2(e.s), mx, my - 3);
      });
    });
    // draw nodes
    for (var sym in pos) {
      var pnode = pos[sym], nd = bySym[sym], isHub = pnode.hub;
      var col = isHub ? cvar("--brand-navy") : (pnode.focus ? cvar("--primary-bright") : (nodeColor(sym)));
      var rr = isHub ? 15 : (pnode.focus ? 13 : 9);
      ctx.beginPath(); ctx.arc(pnode.x, pnode.y, rr, 0, 7); ctx.fillStyle = col; ctx.fill();
      if (pnode.focus) { ctx.lineWidth = 2; ctx.strokeStyle = cvar("--primary"); ctx.stroke(); }
      ctx.fillStyle = isHub ? "#fff" : cvar("--on-surface"); ctx.font = "600 11px " + cvar("--sans"); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(sym, pnode.x, pnode.y + (isHub ? 0 : rr + 10));
      if (isHub) ctx.fillText(sym, pnode.x, pnode.y);
      nvNodes.push({ x: pnode.x, y: pnode.y, r: rr + 8, sym: sym });
    }
    // legend of routes
    var txt = allRoutes.map(function (o) { return o.hub + ": " + o.rt.path.join(" → ") + (o.rt.direct ? " (direct)" : "") + " · " + f2(o.rt.score); });
    setChrome("nv-wrap", "<b>Routes to " + esc(G) + "</b>" + (txt.length ? txt.map(function (t) { return "<div class='li'>" + esc(t) + "</div>"; }).join("") : "<div class='li'>no route found</div>"), "");
  }
  function nodeColor(sym) { if (!bySym[sym]) return cvar("--brand-navy"); var s = E.dominantSector(bySym[sym]); return s ? areaColor(s.key) : cvar("--on-surface-variant"); }

  function drawOverview(ctx, w, h) {
    var rows = E.analyse(D, "Both").slice(0, S.limit);
    var cols = { CTBP1: w * 0.16, shared: w * 0.5, CTBP2: w * 0.84 };
    var centreY = h / 2;
    // hub centres
    var hubPos = { CTBP1: { x: w * 0.30, y: centreY }, CTBP2: { x: w * 0.70, y: centreY } };
    var buckets = { CTBP1: [], CTBP2: [], shared: [] };
    rows.forEach(function (r) { buckets[r.attribution].push(r); });
    function place(list, x) { list.forEach(function (r, i) { r._x = x + (hashStr(r.sym) % 40 - 20); r._y = 40 + (h - 80) * (i + 1) / (list.length + 1); }); }
    place(buckets.CTBP1, cols.CTBP1); place(buckets.CTBP2, cols.CTBP2); place(buckets.shared, cols.shared);
    // edges hub->node
    ctx.globalAlpha = .18; ctx.strokeStyle = cvar("--outline");
    rows.forEach(function (r) {
      if (r.node.s1) { ctx.beginPath(); ctx.moveTo(hubPos.CTBP1.x, hubPos.CTBP1.y); ctx.lineTo(r._x, r._y); ctx.stroke(); }
      if (r.node.s2) { ctx.beginPath(); ctx.moveTo(hubPos.CTBP2.x, hubPos.CTBP2.y); ctx.lineTo(r._x, r._y); ctx.stroke(); }
    });
    ctx.globalAlpha = 1;
    rows.forEach(function (r) {
      var sz = 3 + r.composite / 18;
      if (r.node.aging) { ctx.beginPath(); ctx.arc(r._x, r._y, sz + 4, 0, 7); ctx.fillStyle = "color-mix(in srgb," + areaColor("aging") + " 50%, transparent)"; ctx.globalAlpha = .5; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.beginPath(); ctx.arc(r._x, r._y, sz, 0, 7); ctx.fillStyle = nodeColor(r.sym); ctx.fill();
      ctx.lineWidth = 1.4; ctx.strokeStyle = r.attribution === "shared" ? cvar("--tertiary") : (r.attribution === "CTBP1" ? cvar("--primary") : cvar("--secondary")); ctx.stroke();
      nvNodes.push({ x: r._x, y: r._y, r: sz + 6, sym: r.sym });
    });
    [["CTBP1", hubPos.CTBP1], ["CTBP2", hubPos.CTBP2]].forEach(function (hp) {
      ctx.beginPath(); ctx.arc(hp[1].x, hp[1].y, 15, 0, 7); ctx.fillStyle = cvar("--brand-navy"); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "700 10px " + cvar("--mono"); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(hp[0], hp[1].x, hp[1].y);
    });
    ctx.fillStyle = cvar("--on-surface-variant"); ctx.font = "600 11px " + cvar("--sans");
    ctx.fillText("CTBP1-only", cols.CTBP1, 20); ctx.fillText("shared", cols.shared, 20); ctx.fillText("CTBP2-only", cols.CTBP2, 20);
  }

  // canvas overlay chrome (legend + hint + clear-focus)
  function ensureCanvasChrome(wrapId, legend, hint, showClear) {
    var wrap = document.getElementById(wrapId);
    if (!$(".canvas-legend", wrap) && legend !== null) { var l = document.createElement("div"); l.className = "canvas-legend"; wrap.appendChild(l); }
    if (!$(".canvas-hint", wrap)) { var hh = document.createElement("div"); hh.className = "canvas-hint"; wrap.appendChild(hh); }
    var leg = $(".canvas-legend", wrap); if (leg) leg.innerHTML = legend || "";
    var hn = $(".canvas-hint", wrap); if (hn) hn.innerHTML = hint || "";
    var cf = $(".clearfocus", wrap);
    if (showClear) { if (!cf) { cf = document.createElement("button"); cf.className = "iconbtn clearfocus"; cf.textContent = "Clear focus"; cf.onclick = function () { setFocus(null); }; wrap.appendChild(cf); } }
    else if (cf) cf.remove();
  }
  function setChrome(wrapId, legend, hint) { var wrap = document.getElementById(wrapId); var leg = $(".canvas-legend", wrap); if (!leg) { leg = document.createElement("div"); leg.className = "canvas-legend"; wrap.appendChild(leg); } leg.innerHTML = legend; }

  function hashStr(s) { var hsh = 0; for (var i = 0; i < s.length; i++) hsh = (hsh * 31 + s.charCodeAt(i)) & 0x7fffffff; return hsh; }

  // canvas click/dblclick
  function canvasHit(cv, records, e) {
    var rect = cv.getBoundingClientRect();
    var pt = e.touches && e.touches[0] ? e.touches[0] : e;
    var x = pt.clientX - rect.left, y = pt.clientY - rect.top, best = null, bd = 1e9;
    records.forEach(function (n) { var d = (n.x - x) * (n.x - x) + (n.y - y) * (n.y - y); if (d < n.r * n.r && d < bd) { bd = d; best = n; } });
    return best;
  }
  function wireCanvas(cv, getRecords) {
    var lastTap = 0;
    cv.addEventListener("click", function (e) { var n = canvasHit(cv, getRecords(), e); if (n) clickGene(n.sym, false); });
    cv.addEventListener("dblclick", function (e) { var n = canvasHit(cv, getRecords(), e); if (n) clickGene(n.sym, true); });
  }

  // ================================================================ DRAWER ====
  function renderDrawer() {
    if (S.selected && bySym[S.selected]) renderGeneDossier(bySym[S.selected]);
    else if (S.lens && S.drawerMode === "lens") renderLensPanel(S.lens);
    else renderHubDossier();
  }
  function homeBtn() { return '<button class="iconbtn homebtn" id="drawerHome" title="Back to hub">⌂ Hub</button>'; }
  function copyBtn(id) { return '<button class="copybtn" data-copy="' + id + '" title="Copy this AI context to the clipboard">⧉ Copy</button>'; }

  function renderHubDossier() {
    var hubs = S.hub === "Both" ? HUBS : [S.hub];
    var h = '<div class="dwrap">';
    var syn = E.synthesis(D, S.hub);
    h += '<div class="dhead"><div><h2>' + (S.hub === "Both" ? "CtBP1 + CtBP2" : S.hub) + '</h2><div class="sub">' + esc(syn.lead) + "</div></div></div>";
    h += '<div class="small" style="margin-bottom:8px">' + esc(syn.body) + "</div>";
    hubs.forEach(function (hn) {
      var hb = D.hubs[hn], id = hb.ids || {};
      h += '<div class="dsec"><div class="h">' + hn + " · " + esc(hb.name || "") + "</div>";
      if (hb.summary) h += '<div class="small muted" style="margin-bottom:6px">' + esc(hb.summary) + "</div>";
      if (hb.note) h += '<div class="small" style="margin-bottom:6px"><b>Note:</b> ' + esc(hb.note) + "</div>";
      if (hb.cofactor) h += '<div class="kv"><span>Cofactor</span><span class="v">' + esc(hb.cofactor) + "</span></div>";
      if (hb.litTotal != null) h += '<div class="kv"><span>Literature total ' + gi("comention") + '</span><span class="v">' + hb.litTotal + "</span></div>";
      if (hb.clinvar) h += clinvarRows(hn, hb.clinvar);
      h += '<div class="links" style="margin-top:6px">' + hubIdLinks(hn) + "</div>";
      h += "</div>";
    });
    // hub edge
    if (D.hubEdge && D.hubEdge.s) {
      h += '<div class="dsec"><div class="h">CTBP1 ↔ CTBP2 (paralog edge) ' + gi("string") + '</div>' + channelRows(D.hubEdge.s) +
        '<div class="links" style="margin-top:6px">' + ext(P.stringPair("CTBP1", "CTBP2"), "STRING pair") + "</div></div>";
    }
    // aging reading list for the hub(s)
    hubs.forEach(function (hn) {
      var hb = D.hubs[hn];
      if (hb.agingRefs && hb.agingRefs.length) {
        h += '<div class="dsec"><div class="h">' + hn + " aging / longevity reading list " + gi("aging") + "</div>" +
          '<div class="muted tiny" style="margin-bottom:4px">Curated, ortholog-aware reading list, not a discovery claim.</div>' +
          hb.agingRefs.map(refItem).join("") + "</div>";
      }
    });
    h += aiBlock("hub", "AI context — " + (S.hub === "Both" ? "CtBP1 + CtBP2" : S.hub), aiForHub());
    h += "</div>";
    $("#drawer").innerHTML = h;
    S.drawerMode = "hub";
  }

  function renderLensPanel(key) {
    var t = TH[key], rows = E.findings(D, S.hub).filter(function (f) { return f.area === key; });
    var seen = {}, genes = [];
    rows.forEach(function (f) { if (!seen[f.sym]) { seen[f.sym] = 1; genes.push(f); } });
    var rule = t.kind === "ot" ? ("EFO area-sum of " + t.efo.map(function (e) { return '"' + e + '"'; }).join(" + ") + " > 0.15") :
      (t.kind === "name" ? "Open Targets disease-name match" : "GenAge ∪ LongevityMap membership");
    var h = '<div class="dwrap"><div class="dhead"><div><h2><span class="lens sector" style="display:inline-flex"><span class="dot" style="background:' + areaColor(key) + '"></span></span> ' + esc(t.label) + "</h2>" +
      '<div class="sub">' + esc(rule) + " " + gi("fields") + "</div></div>" + homeBtn() + "</div>";
    h += '<div class="small muted" style="margin-bottom:8px">' + genes.length + " member genes in the " + esc(S.hub) + " scope, ranked by strength.</div>";
    genes.forEach(function (f) {
      h += '<div class="frow" data-gene="' + f.sym + '" style="border-left-color:' + areaColor(key) + '"><div class="fmain"><b>' + f.sym + "</b> " +
        '<span class="attrbadge attr-' + f.attribution + '">' + (f.attribution === "shared" ? "1+2" : (f.attribution === "CTBP1" ? "1" : "2")) + "</span>" +
        '<div class="muted small">' + findingProv(f) + "</div></div><div class='num small muted'>sev " + f.sev + "</div></div>";
    });
    if (key === "aging") {
      HUBS.forEach(function (hn) {
        var hb = D.hubs[hn];
        if (hb.agingRefs && hb.agingRefs.length) h += '<div class="dsec"><div class="h">' + hn + " ortholog-aware reading list</div><div class='muted tiny' style='margin-bottom:4px'>Curated reading list, not a discovery claim.</div>" + hb.agingRefs.map(refItem).join("") + "</div>";
      });
    }
    h += aiBlock("lens", "AI context — " + t.label, aiForLens(key));
    h += "</div>";
    $("#drawer").innerHTML = h;
  }

  function renderGeneDossier(n) {
    var conns = [];
    if (n.s1) conns.push(E.connection(D, n, "CTBP1"));
    if (n.s2) conns.push(E.connection(D, n, "CTBP2"));
    var themes = E.themesFor(n), mech = E.mechFor(n);
    var h = '<div class="dwrap"><div class="dhead"><div><h2>' + n.sym + '</h2><div class="sub">' + esc(n.name || "") +
      ' <span class="attrbadge attr-' + (n.hubs.length === 2 ? "shared" : n.hubs[0]) + '">' + (n.hubs.length === 2 ? "shared (1+2)" : n.hubs[0] + "-only") + "</span></div></div>" + homeBtn() + "</div>";

    // IntAct
    if (n.intact) {
      var ia = n.intact;
      h += '<div class="dsec"><div class="h">IntAct ' + gi("intact") + '</div>' +
        '<div class="kv"><span>Type</span><span class="v">' + esc(ia.type) + (ia.direct ? " (direct)" : "") + "</span></div>" +
        '<div class="kv"><span>MI-score</span><span class="v">' + f2(ia.miscore) + "</span></div>" +
        '<div class="kv"><span>Interactions</span><span class="v">' + ia.count + "</span></div>" +
        (ia.methods && ia.methods.length ? '<div class="chips">' + ia.methods.map(function (m) { return '<span class="chip">' + esc(m) + "</span>"; }).join("") + "</div>" : "") +
        (ia.pmids && ia.pmids.length ? '<div class="small" style="margin-top:5px">PMIDs: ' + ia.pmids.slice(0, 8).map(function (p) { return ext(P.pubmed(p), p); }).join(", ") + "</div>" : "") + "</div>";
    }
    // BioGRID (right after IntAct)
    if (n.biogrid) {
      var bg = n.biogrid;
      h += '<div class="dsec"><div class="h">BioGRID ' + esc(D.meta.biogridRelease || "") + " " + gi("biogrid") + "</div>" +
        '<div class="muted tiny" style="margin-bottom:4px">Curated human physical interactions, yeast-two-hybrid excluded.</div>' +
        '<div class="kv"><span>Interactions</span><span class="v">' + bg.count + "</span></div>" +
        (bg.methods && bg.methods.length ? '<div class="chips">' + bg.methods.map(function (m) { return '<span class="chip">' + esc(m) + "</span>"; }).join("") + "</div>" : "") +
        (bg.pmids && bg.pmids.length ? '<div class="small" style="margin-top:5px">PMIDs: ' + bg.pmids.slice(0, 8).map(function (p) { return ext(P.pubmed(p), p); }).join(", ") + "</div>" : "") +
        '<div class="links" style="margin-top:5px">' + ext(P.biogrid(n.sym), "BioGRID") + "</div></div>";
    }
    // Literature (pulled up)
    h += '<div class="dsec"><div class="h">Literature co-mention ' + gi("comention") + "</div>" + litBlock(n) + "</div>";
    // Area memberships
    h += '<div class="dsec"><div class="h">Area memberships</div>';
    if (themes.length) h += '<div class="chips">' + themes.map(function (t) { return '<span class="chip" data-lens="' + t.key + '" style="cursor:pointer;background:' + tint(t.key, 12) + ';border-color:' + areaColor(t.key) + '"><span class="cd" style="background:' + areaColor(t.key) + '"></span>' + esc(t.label) + "</span>"; }).join("") + "</div>";
    else h += '<div class="muted small">No disease-area or aging membership in the data.</div>';
    h += "</div>";
    // top disease associations
    if (n.dis && n.dis.length) {
      h += '<div class="dsec"><div class="h">Top disease associations (Open Targets)</div>';
      n.dis.slice(0, 8).forEach(function (d) { h += '<div class="kv"><span>' + esc(d.n) + '</span><span class="v">' + f2(d.s) + "</span></div>"; });
      h += '<div class="links" style="margin-top:5px">' + ext(P.otAssoc(n.ensembl), "Open Targets associations") + "</div></div>";
    }
    // Pathways (before ClinVar)
    if (n.pathways && n.pathways.length) {
      h += '<div class="dsec"><div class="h">Pathways (Reactome) ' + gi("reactome") + "</div>" +
        n.pathways.slice(0, 10).map(function (p) { return '<div class="small">' + ext(P.reactome(p.id), p.n) + "</div>"; }).join("") + "</div>";
    }
    // ClinVar
    if (n.clinvar) h += '<div class="dsec"><div class="h">Clinical variants (ClinVar) ' + gi("clinvar") + "</div>" + clinvarRows(n.sym, n.clinvar) + "</div>";
    // HPO
    if (n.phenotypes && n.phenotypes.length) {
      h += '<div class="dsec"><div class="h">Clinical phenotypes (HPO) ' + gi("hpo") + "</div>" +
        '<div class="chips">' + n.phenotypes.slice(0, 12).map(function (p) { return '<span class="chip">' + esc(p) + "</span>"; }).join("") + "</div>" +
        '<div class="kv" style="margin-top:5px"><span>Total terms</span><span class="v">' + ext(P.hpoApi(n.entrez), n.phenoCount != null ? n.phenoCount : "—") + "</span></div>" +
        '<div class="links" style="margin-top:4px">' + ext(P.monarch(n.entrez), "Monarch") + "</div></div>";
    }
    // mechanism tags
    if (mech.length) h += '<div class="dsec"><div class="h">Mechanism tags ' + gi("mech") + '</div><div class="chips">' + mech.map(function (m) { return '<span class="chip">' + esc(m.label) + "</span>"; }).join("") + "</div></div>";
    // open in databases
    h += '<div class="dsec"><div class="h">Open in databases</div><div class="links">' + dbLinks(n) + "</div></div>";
    // de-emphasised Connection + STRING channels (collapsible, bottom)
    conns.forEach(function (c) {
      h += '<details class="dfold"><summary>Connection to ' + c.hub + " " + gi("composite") + '<span class="sv">Composite ' + c.composite + "/100</span></summary><div class='body'>" +
        '<div class="kv"><span>Physical ' + gi("phys") + '</span><span class="v">' + f2(c.phys) + "</span></div>" +
        '<div class="kv"><span>Literature ' + gi("lit") + '</span><span class="v">' + f2(c.lit) + "</span></div>" +
        '<div class="kv"><span>Network context ' + gi("ctx") + '</span><span class="v">' + f2(c.ctx) + "</span></div>" +
        '<div class="kv"><span>Connection type</span><span class="v">' + esc(c.type) + "</span></div></div></details>";
    });
    conns.forEach(function (c) {
      var s = c.hub === "CTBP1" ? n.s1 : n.s2;
      h += '<details class="dfold"><summary>STRING channels · ' + c.hub + " " + gi("string") + '<span class="sv">Combined ' + f2(s.c) + "</span></summary><div class='body'>" + channelRows(s) +
        '<div class="links" style="margin-top:5px">' + ext(P.stringPair(n.sym, c.hub), "STRING pair") + "</div></div></details>";
    });
    h += aiBlock("gene", "AI context — " + n.sym, aiForGene(n));
    h += "</div>";
    $("#drawer").innerHTML = h;
  }

  function litBlock(n) {
    function trio(cm, hubs, label, neigh) {
      if (!cm) return "";
      var note = neigh ? "" : ' <span class="muted tiny">(literature only; not a top-250 STRING neighbour)</span>';
      var syn = n.syn || [n.sym];
      return '<div style="margin:6px 0"><div class="small"><b>' + label + "</b>" + note + "</div>" +
        tierRow("in title", cm.title, epmcUrl(syn, hubs, "title")) +
        tierRow("title+abstract", cm.abs, epmcUrl(syn, hubs, "abs")) +
        tierRow("full text", cm.all, epmcUrl(syn, hubs, "all")) + "</div>";
    }
    var neigh1 = !!n.s1, neigh2 = !!n.s2;
    var h = '<div class="muted tiny">Nested scopes: title ⊆ title+abstract ⊆ full text.</div>';
    h += trio(n.comention1, ["CTBP1"], "with CTBP1", neigh1);
    h += trio(n.comention2, ["CTBP2"], "with CTBP2", neigh2);
    h += trio(n.comentionB, ["CTBP1", "CTBP2"], "with both", true);
    if (E.STOPLIST[n.sym]) h += '<div class="small" style="color:var(--danger)">Ambiguous / house-keeping symbol: excluded from the literature score.</div>';
    if (n.refs && n.refs.length) { h += '<div style="margin-top:6px">' + n.refs.slice(0, 8).map(refItem).join("") + "</div>"; }
    return h;
  }
  function tierRow(label, v, url) { return '<div class="tier"><span>' + label + "</span><span>" + (v == null ? '<span class="muted">n/a</span>' : ext(url, v)) + "</span></div>"; }
  function refItem(r) {
    var isPmid = r.pmid != null && /^\d+$/.test(String(r.pmid));
    var url = isPmid ? P.pubmed(r.pmid) : ("https://europepmc.org/search?query=" + encodeURIComponent(r.t || String(r.pmid || "")));
    var label = r.t || (isPmid ? "PMID " + r.pmid : "Europe PMC record");
    return '<div class="refitem">' + (r.pmid || r.t ? ext(url, label) : esc(label)) +
      '<div class="rj">' + esc(r.a || "") + (r.j ? " · " + esc(r.j) : "") + (r.y ? " · " + r.y : "") + (r.c != null ? " · cited " + r.c : "") + "</div></div>";
  }
  function channelRows(s) {
    var leg = D.meta.channelLegend || {};
    return E_CHANNELS.map(function (k) { return '<div class="kv"><span>' + esc(leg[k] || k) + '</span><span class="v">' + f2(num(s[k])) + "</span></div>"; }).join("");
  }
  var E_CHANNELS = ["c", "e", "d", "t", "a", "p", "n", "f"];
  function clinvarRows(sym, cv) {
    return '<div class="kv"><span>Pathogenic / Likely</span><span class="v">' + ext(P.clinvar(sym, "plp"), cv.plp != null ? cv.plp : "—") + "</span></div>" +
      '<div class="kv"><span>VUS</span><span class="v">' + ext(P.clinvar(sym, "vus"), cv.vus != null ? cv.vus : "—") + "</span></div>" +
      '<div class="kv"><span>Total</span><span class="v">' + ext(P.clinvar(sym, "total"), cv.total != null ? cv.total : "—") + "</span></div>";
  }
  function dbLinks(n) {
    var a = [];
    a.push(ext(P.string(n.sym), "STRING"));
    a.push(ext(P.ot(n.ensembl), "Open Targets"));
    a.push(ext(P.uniprot(n.uniprot), "UniProt"));
    a.push(ext(P.ncbi(n.entrez), "NCBI Gene"));
    a.push(ext(P.ensembl(n.ensembl), "Ensembl"));
    if (n.mim) a.push(ext(P.omim(n.mim), "OMIM"));
    return a.join("");
  }

  // ---- AI context dumps ----
  function aiBlock(scope, heading, text) {
    var id = "ai-" + scope;
    return '<div class="dsec"><div class="h">' + esc(heading) + " " + gi("aictx") + " " + copyBtn(id) + '</div><pre class="ai" id="' + id + '">' + esc(text) + "</pre></div>";
  }
  function aiForGene(n) {
    var L = ["CTBP INTERACTOME ATLAS: " + n.sym + " (" + (n.name || "") + ")"];
    L.push("IDs: Ensembl " + n.ensembl + " | Entrez " + n.entrez + " | UniProt " + (n.uniprot || "-") + (n.mim ? " | OMIM " + n.mim : ""));
    L.push("Attribution: " + (n.hubs.length === 2 ? "shared (CTBP1+CTBP2)" : n.hubs[0] + "-only"));
    if (n.intact) L.push("IntAct: " + n.intact.type + (n.intact.direct ? " (direct)" : "") + ", MI " + n.intact.miscore + ", " + n.intact.count + " interactions, PMIDs " + (n.intact.pmids || []).slice(0, 6).join(","));
    if (n.biogrid) L.push("BioGRID (" + (D.meta.biogridRelease || "") + ", human physical non-Y2H): " + n.biogrid.count + " interactions, PMIDs " + (n.biogrid.pmids || []).slice(0, 6).join(","));
    ["comention1", "comention2", "comentionB"].forEach(function (f, i) {
      var cm = n[f], lbl = ["CTBP1", "CTBP2", "both"][i]; if (cm) L.push("Co-mention " + lbl + ": title " + cm.title + " / title+abs " + cm.abs + " / full " + cm.all);
    });
    var th = E.themesFor(n); if (th.length) L.push("Area memberships: " + th.map(function (t) { return t.label; }).join(", "));
    if (n.dis && n.dis.length) L.push("Top diseases: " + n.dis.slice(0, 6).map(function (d) { return d.n + " (" + f2(d.s) + ")"; }).join("; "));
    if (n.pathways && n.pathways.length) L.push("Reactome: " + n.pathways.slice(0, 6).map(function (p) { return p.n; }).join("; "));
    if (n.clinvar) L.push("ClinVar: P/LP " + n.clinvar.plp + ", VUS " + n.clinvar.vus + ", total " + n.clinvar.total);
    if (n.phenoCount != null) L.push("HPO phenotype terms: " + n.phenoCount);
    var mech = E.mechFor(n); if (mech.length) L.push("Mechanism tags: " + mech.map(function (m) { return m.label; }).join(", "));
    var conns = []; if (n.s1) conns.push(E.connection(D, n, "CTBP1")); if (n.s2) conns.push(E.connection(D, n, "CTBP2"));
    conns.forEach(function (c) { var rk = c.hub === "CTBP1" ? n.rank1 : n.rank2; L.push("Connection " + c.hub + ": type " + c.type + ", rank #" + rk + " in " + c.hub + " neighbourhood"); });
    L.push("Sources: STRING " + P.string(n.sym) + " | Open Targets " + P.ot(n.ensembl) + " | UniProt " + P.uniprot(n.uniprot) + " | NCBI " + P.ncbi(n.entrez));
    return L.join("\n");
  }
  function aiForLens(key) {
    var t = TH[key], rows = E.findings(D, S.hub).filter(function (f) { return f.area === key; });
    var L = ["CTBP INTERACTOME ATLAS: field '" + t.label + "' (" + S.hub + " scope)"];
    var seen = {};
    rows.forEach(function (f) { if (seen[f.sym]) return; seen[f.sym] = 1; L.push(f.sym + " [" + f.attribution + "] sev " + f.sev + " — " + findingProvText(f)); });
    return L.join("\n");
  }
  function findingProvText(f) {
    if (f.kind === "aging") { var a = f.top || {}; return a.genage ? ("GenAge" + (a.why ? " " + a.why : "")) : "LongevityMap significant"; }
    if (f.kind === "ot") return "EFO sum " + f2(f.top.sum) + "; e.g. " + (f.matches || []).slice(0, 2).map(function (d) { return d.n; }).join(", ");
    return "OT " + (f.top ? f.top.n + " (" + f2(f.top.s) + ")" : "");
  }
  function aiForHub() {
    var syn = E.synthesis(D, S.hub);
    var L = ["CTBP INTERACTOME ATLAS: " + (S.hub === "Both" ? "CtBP1 + CtBP2" : S.hub), syn.lead, syn.body];
    (S.hub === "Both" ? HUBS : [S.hub]).forEach(function (hn) {
      var hb = D.hubs[hn];
      L.push("--- " + hn + " (" + (hb.name || "") + ") ---");
      if (hb.summary) L.push(hb.summary);
      if (hb.cofactor) L.push("Cofactor: " + hb.cofactor);
      if (hb.clinvar) L.push("ClinVar: P/LP " + hb.clinvar.plp + ", VUS " + hb.clinvar.vus + ", total " + hb.clinvar.total);
      if (hb.litTotal != null) L.push("Literature total: " + hb.litTotal);
    });
    return L.join("\n");
  }
  function aiForAll() {
    var L = ["CTBP INTERACTOME ATLAS — FULL SOURCED CONTEXT (both hubs, all fields, every interactor)"];
    L.push(aiForHub()); L.push("");
    ORDER.forEach(function (k) { L.push("### FIELD: " + TH[k].label); L.push(aiForLens(k)); });
    L.push(""); L.push("### ALL INTERACTORS");
    E.analyse(D, "Both").forEach(function (r) { L.push(""); L.push(aiForGene(r.node)); });
    return L.join("\n");
  }

  // ================================================================ ACTIONS ===
  function setHub(h) { S.hub = h; S.selected = null; S.drawerMode = "hub"; renderAll(); }
  function setLens(k) { S.lens = (S.lens === k) ? null : k; if (S.lens) { S.selected = null; S.drawerMode = "lens"; } renderAll(); }
  function setFocus(sym) {
    if (sym && !bySym[sym]) return;
    S.focus = sym || null;
    if (sym) { S.selected = sym; S.view = "network"; }
    renderAll();
  }
  function clickGene(sym, dbl) {
    if (!bySym[sym]) return;
    if (dbl) { if (S.focus === sym) { setFocus(null); return; } setFocus(sym); }
    else { S.selected = sym; S.drawerMode = "gene"; if (isMobile) openDrawer(); renderAll(); }
  }
  function goHome() { S.selected = null; S.lens = null; S.focus = null; S.drawerMode = "hub"; renderAll(); }

  function openDrawer() { $("#drawer").classList.add("open"); $("#scrim").classList.add("on"); }
  function closeOverlays() { $("#drawer").classList.remove("open"); $("#left").classList.remove("open"); $("#scrim").classList.remove("on"); }

  // event delegation
  document.addEventListener("click", function (e) {
    var t = e.target;
    var seg = t.closest && t.closest("[data-hub]"); if (seg) { setHub(seg.getAttribute("data-hub")); return; }
    var lensEl = t.closest && t.closest("[data-lens]");
    if (lensEl && lensEl.getAttribute("data-lens") !== null) {
      e.stopPropagation();
      var lk = lensEl.getAttribute("data-lens");
      if (lk === "") { S.lens = null; renderAll(); return; }
      setLens(lk); return;
    }
    var tabEl = t.closest && t.closest("[data-view]"); if (tabEl) { S.view = tabEl.getAttribute("data-view"); if (isMobile) closeOverlays(); renderAll(); return; }
    var geneEl = t.closest && t.closest("[data-gene]");
    if (geneEl && !t.closest("a") && !t.closest(".gi")) { clickGene(geneEl.getAttribute("data-gene"), false); return; }
    var th = t.closest && t.closest("[data-sort]"); if (th) { var k = th.getAttribute("data-sort"); if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = -1; } renderTable(); return; }
    var cp = t.closest && t.closest("[data-copy]"); if (cp) { var pre = document.getElementById(cp.getAttribute("data-copy")); if (pre) copyText(pre.textContent, cp); return; }
    if (t.id === "drawerHome") { goHome(); return; }
    if (t.id === "focusClr") { setFocus(null); return; }
    if (t.id === "insightClose") { toggleInsight(false); return; }
    if (t.id === "exportBtn") { copyText(aiForAll(), t); return; }
  });
  document.addEventListener("dblclick", function (e) {
    var geneEl = e.target.closest && e.target.closest("[data-gene]");
    if (geneEl && !e.target.closest("a")) { clickGene(geneEl.getAttribute("data-gene"), true); }
  });

  // focus input (custom autocomplete, input-driven)
  var acItems = [], acHi = -1;
  document.addEventListener("input", function (e) {
    if (e.target.id !== "focusInput") return;
    var val = e.target.value.trim().toUpperCase();
    if (bySym[val]) { setFocusSoft(val); }
    else if (S.focus && !val) setFocusSoft(null);
    renderAC(val, e.target);
  });
  function setFocusSoft(sym) { // update focus + views but do NOT re-render the input (keep cursor)
    S.focus = sym; if (sym) { S.selected = sym; S.view = "network"; }
    renderTabs(); renderView(); renderDrawer();
  }
  function renderAC(val, input) {
    var ac = $("#focusAC"); if (!ac) return;
    if (!val) { ac.classList.remove("open"); return; }
    acItems = D.nodes.filter(function (n) { return n.sym.toUpperCase().indexOf(val) === 0 || (n.name || "").toUpperCase().indexOf(val) >= 0; }).slice(0, 12);
    if (!acItems.length) { ac.classList.remove("open"); return; }
    acHi = -1;
    ac.innerHTML = acItems.map(function (n, i) { return '<div class="it" data-ac="' + n.sym + '"><span><b>' + n.sym + "</b> <span class='muted small'>" + esc((n.name || "").slice(0, 28)) + "</span></span><span class='h'>" + (n.hubs.length === 2 ? "1+2" : n.hubs[0]) + "</span></div>"; }).join("");
    ac.classList.add("open");
  }
  document.addEventListener("click", function (e) { var it = e.target.closest && e.target.closest("[data-ac]"); if (it) { setFocus(it.getAttribute("data-ac")); } });
  document.addEventListener("keydown", function (e) {
    if (e.target.id === "focusInput") {
      var ac = $("#focusAC");
      if (e.key === "Escape") { e.target.value = ""; setFocus(null); return; }
      if (e.key === "ArrowDown") { acHi = Math.min(acHi + 1, acItems.length - 1); hiAC(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { acHi = Math.max(acHi - 1, 0); hiAC(); e.preventDefault(); }
      else if (e.key === "Enter") { if (acHi >= 0 && acItems[acHi]) setFocus(acItems[acHi].sym); else if (bySym[e.target.value.trim().toUpperCase()]) setFocus(e.target.value.trim().toUpperCase()); }
    }
  });
  function hiAC() { var its = document.querySelectorAll("#focusAC .it"); its.forEach(function (el, i) { el.classList.toggle("hi", i === acHi); }); }

  // limit slider
  document.addEventListener("input", function (e) { if (e.target.id === "limit") { S.limit = +e.target.value; var lv = $("#limitv"); if (lv) lv.textContent = S.limit; renderView(); } });

  // header buttons
  $("#home").addEventListener("click", goHome);
  $("#byLogo").addEventListener("click", function (e) { e.stopPropagation(); });
  $("#themeBtn").addEventListener("click", toggleTheme);
  $("#srcBtn").addEventListener("click", function () { toggleInsight(); });
  $("#menuBtn").addEventListener("click", function () { $("#left").classList.toggle("open"); $("#scrim").classList.toggle("on"); });
  $("#dossBtn").addEventListener("click", function () { openDrawer(); });
  $("#scrim").addEventListener("click", closeOverlays);

  function toggleInsight(force) {
    var el = $("#insight"), open = force != null ? force : el.classList.contains("hidden");
    el.classList.toggle("hidden", !open);
    $("#srcBtn").setAttribute("aria-pressed", open ? "true" : "false");
    if (open) renderInsight();
  }
  function toggleTheme() {
    var cur = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", cur);
    try { localStorage.setItem("ctbp-theme", cur); } catch (e) {}
    $("#themeBtn").textContent = cur === "dark" ? "☀" : "☾";
    renderView();
  }

  // ================================================================ RENDER ====
  function renderAll() {
    renderLeft(); renderMobileBar(); renderTabs(); renderView(); renderDrawer();
    if ($("#srcBtn").getAttribute("aria-pressed") === "true") renderInsight();
  }

  var resizeT;
  addEventListener("resize", function () { clearTimeout(resizeT); resizeT = setTimeout(function () { isMobile = matchMedia("(max-width:1023px)").matches; if (S.view === "constellation" || S.view === "network") renderView(); }, 150); });

  // ================================================================ BOOT ======
  function boot() {
    $("#themeBtn").textContent = document.documentElement.getAttribute("data-theme") === "dark" ? "☀" : "☾";
    wireCanvas($("#cv"), function () { return cvNodes; });
    wireCanvas($("#nv"), function () { return nvNodes; });
    renderAll();
    var skip = /[?&]noboot/.test(location.search);
    var intro = $("#intro");
    if (skip) intro.classList.add("gone");
    else setTimeout(function () { intro.classList.add("gone"); }, 900);
    setTimeout(function () { intro.style.display = "none"; }, skip ? 0 : 1500);
  }
  boot();
})();
