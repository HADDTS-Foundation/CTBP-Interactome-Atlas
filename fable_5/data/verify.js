#!/usr/bin/env node
/*
 * verify.js  -  the falsifiable test harness (app_build_prompt.md section 9).
 *
 * Runs the EXACT engine.js against app-data.js and asserts GENERIC INVARIANTS and
 * data integrity only. It NEVER pins a biological conclusion (no named gene bound
 * to a rank/area/type; no required disease/paper). The anti-bias core recomputes
 * each area's membership straight from the raw data using the same THEMES rules and
 * asserts it EQUALS the engine's members: if a gene were hand-placed, this fails.
 *
 *   node data/verify.js
 */
const fs = require("fs");
const path = require("path");

const REACTOME_UMBRELLAS = new Set(["Autophagy","Cell Cycle","Cell-Cell communication",
  "Cellular responses to stimuli","Chromatin organization","Circadian clock","DNA Repair",
  "DNA Replication","Developmental Biology","Digestion and absorption","Disease","Drug ADME",
  "Extracellular matrix organization","Gene expression (Transcription)","Hemostasis",
  "Immune System","Metabolism","Metabolism of RNA","Metabolism of proteins","Muscle contraction",
  "Neuronal System","Organelle biogenesis and maintenance","Programmed Cell Death",
  "Protein localization","Reproduction","Sensory Perception","Signal Transduction",
  "Transport of small molecules","Vesicle-mediated transport"]);
const SYN_BLOCKLIST = new Set(["GLP1","P18","PC2","PH1","C21","DC42","IRA1"]);

// load app-data.js (sets window.CTBP_DATA) then engine.js (sets global CTBP_ENGINE)
function load() {
  const window = {}; global.window = window;
  new Function("window", fs.readFileSync(path.join(__dirname, "..", "app-data.js"), "utf8"))(window);
  const E = require(path.join(__dirname, "..", "engine.js"));
  return { D: window.CTBP_DATA, E: E };
}

let fails = 0, checks = 0, warns = 0;
function ok(c, m) { checks++; if (!c) { fails++; console.error("  FAIL: " + m); } }
function warn(c, m) { if (!c) { warns++; console.warn("  warn: " + m); } }
const num = (x) => (typeof x === "number" && !isNaN(x)) ? x : 0;

// independent recomputation of area membership straight from raw node data.
function floored(dis) {
  const out = []; (dis || []).forEach((d, i) => { if (num(d.s) >= 0.18 || (i < 3 && num(d.s) >= 0.10)) out.push(d); });
  return out;
}
function recomputeThemes(E, node) {
  const TH = E.THEMES, ORDER = E.THEME_ORDER, areas = node.areas || {}, fl = floored(node.dis), out = [];
  ORDER.forEach((key) => {
    const th = TH[key];
    if (th.kind === "ot") {
      let sum = 0, present = false;
      th.efo.forEach((e) => { if (areas[e] != null) { sum += num(areas[e]); present = true; } });
      if (present && sum > th.thr) out.push(key);
    } else if (th.kind === "name") {
      if (fl.some((d) => th.re.test(d.n || ""))) out.push(key);
    } else if (th.kind === "aging") {
      if (node.aging) out.push(key);
    }
  });
  return out.sort();
}

// independent adjacency (partners + hubs) to validate routes.
function buildAdj(D) {
  const adj = {};
  function link(a, b, w) { if (a == null || b == null || a === b) return; (adj[a] || (adj[a] = {}))[b] = 1; (adj[b] || (adj[b] = {}))[a] = 1; }
  D.edges.forEach((e) => link(e.a, e.b));
  D.nodes.forEach((n) => { if (n.s1) link("CTBP1", n.sym); if (n.s2) link("CTBP2", n.sym); });
  if (D.hubEdge) link("CTBP1", "CTBP2");
  return adj;
}

function main() {
  const { D, E } = load();
  ok(D && E, "app-data.js + engine.js loaded");

  // ---- fields: exactly 10 keys, exactly 5 sector ----
  const keys = E.THEME_ORDER.slice().sort();
  const expect = ["aging","cardiovascular","cns","eye","hematologic","immunity","metabolic","neurodegen","neurodev","oncology"].sort();
  ok(JSON.stringify(keys) === JSON.stringify(expect), "exactly the 10 chosen field keys exist");
  ok(E.THEME_ORDER.filter((k) => E.THEMES[k].sector).length === 5, "exactly 5 sector fields");
  ok(E.THEME_ORDER.length === 10, "10 fields total");

  const adj = buildAdj(D);
  let cmCov = 0, routeChecks = 0;

  // ---- per-node invariants ----
  D.nodes.forEach((n) => {
    const tag = n.sym;

    // data integrity: resolved IDs
    ok(/^ENSG\d+$/.test(n.ensembl || ""), tag + ": Ensembl resolved");
    ok(/^\d+$/.test(String(n.entrez || "")), tag + ": Entrez resolved");

    // dual-hub: hubs == which of s1/s2 non-null; rank iff score
    const s1 = n.s1 != null, s2 = n.s2 != null;
    const exp = [s1 ? "CTBP1" : null, s2 ? "CTBP2" : null].filter(Boolean).join(",");
    ok((n.hubs || []).join(",") === exp, tag + ": hubs == non-null scores");
    ok((n.hubs || []).length >= 1, tag + ": hubs non-empty (direct neighbour of >=1 hub)");
    ok((n.rank1 != null) === s1 && (n.rank2 != null) === s2, tag + ": rank present iff score");

    // ANTI-BIAS: engine membership == independent recomputation from raw data
    const eng = E.themesFor(n).map((f) => f.key).sort();
    const rec = recomputeThemes(E, n);
    ok(JSON.stringify(eng) === JSON.stringify(rec), tag + ": engine themes == recomputation (" + eng + " vs " + rec + ")");

    // every flag is sourced
    E.themesFor(n).forEach((f) => {
      if (f.kind === "name") ok((n.dis || []).some((d) => d.n === f.top.n), tag + "/" + f.key + ": name flag cites a real OT disease");
      if (f.kind === "aging") ok(n.aging && (n.aging.genage || n.aging.longevity), tag + "/aging: cites GenAge/LongevityMap");
      if (f.kind === "ot") ok(f.top && f.top.sum > 0.15, tag + "/" + f.key + ": ot flag area-sum > 0.15");
    });

    // connection types: valid, and Core/Physical never from DB channel alone
    ["CTBP1", "CTBP2"].forEach((hub) => {
      const s = hub === "CTBP1" ? n.s1 : n.s2; if (!s) return;
      const c = E.connection(D, n, hub);
      ok(["Core complex", "Physical interactor", "Literature-linked", "Functional neighbour", "Associated"].indexOf(c.type) >= 0, tag + ": valid connection type");
      if (c.type === "Physical interactor" || c.type === "Core complex") {
        const iaPhys = !!(n.intact && (n.intact.direct || n.intact.physical));
        const bg = !!(n.biogrid && n.biogrid.count >= 1);
        const justified = num(s.e) >= 0.2 || iaPhys || bg;
        ok(justified, tag + ": " + c.type + " justified by experiments/IntAct/BioGRID, not DB channel alone");
      }
      if (c.type === "Core complex") ok(num(s.c) >= 0.9 && (num(s.e) >= 0.5 || (n.intact && n.intact.direct)), tag + ": Core complex meets strict rule");
    });

    // co-mention: hub-independent, present for (nearly) every node, monotonic (NOT tied to s1/s2)
    let full = true;
    ["comention1", "comention2", "comentionB"].forEach((f) => {
      const c = n[f];
      if (!c || c.all == null || c.abs == null || c.title == null) { full = false; return; }
      ok(c.title <= c.abs && c.abs <= c.all, tag + "." + f + ": tiers monotonic");
    });
    if (full) cmCov++;

    // ClinVar integrity
    if (n.clinvar && num(n.clinvar.plp) >= 0 && num(n.clinvar.total) >= 0) ok(n.clinvar.plp <= n.clinvar.total, tag + ": ClinVar P/LP <= total");
    // Reactome umbrellas
    (n.pathways || []).forEach((p) => ok(!REACTOME_UMBRELLAS.has(p.n), tag + ": no Reactome umbrella (" + p.n + ")"));
    // syn blocklist
    (n.syn || []).forEach((s) => ok(!SYN_BLOCKLIST.has(String(s).toUpperCase()), tag + ": syn drops homograph " + s));
    // biogrid non-Y2H
    if (n.biogrid) { ok(n.biogrid.count >= 1, tag + ": biogrid count>=1"); (n.biogrid.methods || []).forEach((m) => ok(!/two.?hybrid/i.test(m), tag + ": biogrid non-Y2H")); (n.biogrid.pmids || []).forEach((p) => ok(/^\d+$/.test(String(p)), tag + ": biogrid pmid numeric")); }
    // refs / hpo
    (n.refs || []).forEach((r) => warn(r.pmid == null || /^\d+$/.test(String(r.pmid)), tag + ": ref pmid numeric"));
    if (n.phenoCount != null) ok(n.phenoCount >= (n.phenotypes || []).length, tag + ": phenoCount >= listed phenotypes");
  });

  // ---- routes: direct when it exists, else mediated depth<=3 over real edges ----
  const sample = D.nodes.slice(0, 40);
  sample.forEach((n) => {
    ["CTBP1", "CTBP2"].forEach((hub) => {
      const rs = E.routes(D, hub, n.sym, { maxDepth: 3, top: 3 });
      const direct = adj[hub] && adj[hub][n.sym];
      if (direct) { routeChecks++; ok(rs.length && rs[0].direct && rs[0].path.length === 2, n.sym + ": routes(" + hub + ") returns the direct edge"); }
      rs.forEach((rt) => {
        ok(rt.path.length <= 4, n.sym + ": route depth <= 3");
        rt.edges.forEach((e) => ok(adj[e.a] && adj[e.a][e.b], n.sym + ": route hop " + e.a + "-" + e.b + " is a real edge"));
      });
    });
  });

  // ---- findings() == sum of memberships, each sourced ----
  const fnd = E.findings(D, "Both");
  let memSum = 0; D.nodes.forEach((n) => { memSum += E.themesFor(n).length; });
  ok(fnd.length === memSum, "findings() count == sum of memberships (" + fnd.length + "/" + memSum + ")");
  fnd.forEach((f) => ok(f.top != null && f.sev >= 1 && f.sev <= 3, f.sym + "/" + f.area + ": finding sourced + scored"));

  // ---- analyse sorted by composite, in scope ----
  const an = E.analyse(D, "Both");
  let sorted = true; for (let i = 1; i < an.length; i++) if (an[i].composite > an[i - 1].composite + 1e-9) sorted = false;
  ok(sorted, "analyse() sorted by composite desc");
  ok(an.length === D.nodes.length, "analyse(Both) covers every node");
  ok(E.analyse(D, "CTBP1").every((r) => r.node.s1 != null), "analyse(CTBP1) scoped to CTBP1 neighbours");
  ok(E.analyse(D, "CTBP2").every((r) => r.node.s2 != null), "analyse(CTBP2) scoped to CTBP2 neighbours");

  // ---- union arithmetic ----
  const nb = D.meta.neighborhood;
  ok(nb.union === D.nodes.length, "meta.neighborhood.union == nodes.length");
  ok(nb.shared + (nb.CTBP1 - nb.shared) + (nb.CTBP2 - nb.shared) === nb.union, "shared + CTBP1-only + CTBP2-only == union");
  ok(D.meta.hubs.join(",") === "CTBP1,CTBP2", "both hubs declared");

  // coverage
  ok(cmCov / D.nodes.length >= 0.97, "co-mention coverage " + (100 * cmCov / D.nodes.length).toFixed(1) + "% >= 97%");
  ok(routeChecks > 0, "direct-route checks ran");

  console.log("\n" + (fails ? "VERIFY FAILED" : "VERIFY PASSED") + "  (" + (checks - fails) + "/" + checks + " checks, " + warns + " warnings)");
  console.log("  nodes=" + D.nodes.length + "  findings=" + fnd.length + "  co-mention=" + (100 * cmCov / D.nodes.length).toFixed(1) + "%");
  process.exit(fails ? 1 : 0);
}
main();
