#!/usr/bin/env node
/*
 * verify_data.js  -  data-only integrity check (no engine dependency).
 *
 * Loads ONLY ../app-data.js and asserts the snapshot is well-formed per the data
 * build brief section 8: schema shape, dual-hub symmetry, hub-independent co-mention
 * coverage + monotonicity, ClinVar, Reactome (no umbrellas), BioGRID (physical /
 * non-Y2H), and the union arithmetic.  Run:  node data/verify_data.js
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

function load() {
  const p = path.join(__dirname, "..", "app-data.js");
  const code = fs.readFileSync(p, "utf8");
  const window = {};
  new Function("window", code)(window);
  return window.CTBP_DATA;
}

let fails = 0, checks = 0, warns = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; console.error("  FAIL: " + msg); } }
function warn(cond, msg) { if (!cond) { warns++; console.warn("  warn: " + msg); } }
const num = (x) => typeof x === "number" && !Number.isNaN(x);

function main() {
  const D = load();

  // ---- schema shape ----
  ok(D && D.hubs && D.hubs.CTBP1 && D.hubs.CTBP2, "hubs.CTBP1 + hubs.CTBP2 present");
  ok(D.hubEdge && D.hubEdge.s && num(D.hubEdge.s.c), "hubEdge.s.c numeric");
  ok(Array.isArray(D.nodes) && D.nodes.length > 0, "nodes present");
  ok(Array.isArray(D.edges) && D.edges.length > 0, "edges present");
  ok(D.meta && D.meta.neighborhood, "meta present");
  ok(Array.isArray(D.meta.hubs) && D.meta.hubs.join(",") === "CTBP1,CTBP2", "both hubs declared");

  const nodes = D.nodes;
  let cmCov = 0, cvCov = 0, shared = 0, c1 = 0, c2 = 0, biogridN = 0;

  for (const n of nodes) {
    const tag = n.sym || "?";
    // ids
    ok(/^ENSG\d+$/.test(n.ensembl || ""), tag + ": well-formed Ensembl");
    ok(/^\d+$/.test(String(n.entrez || "")), tag + ": well-formed Entrez");

    // dual-hub: hubs set exactly matches which of s1/s2 are non-null
    const s1 = n.s1 != null, s2 = n.s2 != null;
    const expect = [s1 ? "CTBP1" : null, s2 ? "CTBP2" : null].filter(Boolean).join(",");
    ok((n.hubs || []).join(",") === expect, tag + ": hubs == non-null scores (" + (n.hubs||[]) + " vs " + expect + ")");
    ok((n.hubs || []).length >= 1, tag + ": hubs non-empty");
    // rank present iff score present (structural)
    ok((n.rank1 != null) === s1, tag + ": rank1 iff s1");
    ok((n.rank2 != null) === s2, tag + ": rank2 iff s2");
    if (s1 && s2) shared++; else if (s1) c1++; else if (s2) c2++;

    // co-mention: hub-independent literature, present for (nearly) every node, monotonic
    let full = true;
    for (const f of ["comention1", "comention2", "comentionB"]) {
      const c = n[f];
      if (!c || c.all == null || c.abs == null || c.title == null) { full = false; continue; }
      ok(c.title <= c.abs && c.abs <= c.all, tag + "." + f + ": monotonic title<=abs<=all");
    }
    if (full) cmCov++;

    // ClinVar
    if (n.clinvar) {
      cvCov++;
      if (num(n.clinvar.plp) && num(n.clinvar.total))
        ok(n.clinvar.plp <= n.clinvar.total, tag + ": ClinVar plp<=total");
    }

    // Reactome: no umbrellas
    for (const p of n.pathways || [])
      ok(!REACTOME_UMBRELLAS.has(p.n), tag + ": Reactome not an umbrella (" + p.n + ")");

    // syn: no ambiguous homographs
    for (const s of n.syn || [])
      ok(!SYN_BLOCKLIST.has(String(s).toUpperCase()), tag + ": syn drops homograph " + s);

    // BioGRID: physical / non-Y2H
    if (n.biogrid) {
      biogridN++;
      ok(n.biogrid.count >= 1, tag + ": biogrid count>=1");
      ok((n.biogrid.pmids || []).length >= 1 && n.biogrid.pmids.every((p) => /^\d+$/.test(String(p))),
        tag + ": biogrid valid PMIDs");
      for (const m of n.biogrid.methods || [])
        ok(!/two.?hybrid/i.test(m), tag + ": biogrid method not Y2H (" + m + ")");
    }

    // references valid PMIDs where present
    for (const r of n.refs || [])
      warn(r.pmid == null || /^\d+$/.test(String(r.pmid)), tag + ": ref pmid numeric");
  }

  // hub blocks
  for (const h of ["CTBP1", "CTBP2"]) {
    const hb = D.hubs[h];
    if (hb.clinvar && num(hb.clinvar.plp) && num(hb.clinvar.total))
      ok(hb.clinvar.plp <= hb.clinvar.total, h + ": hub ClinVar plp<=total");
    for (const p of hb.pathways || [])
      ok(!REACTOME_UMBRELLAS.has(p.n), h + ": hub Reactome not umbrella (" + p.n + ")");
  }

  // coverage (hub-independent signals should cover nearly all nodes)
  const cmFrac = cmCov / nodes.length, cvFrac = cvCov / nodes.length;
  ok(cmFrac >= 0.97, "co-mention coverage " + (cmFrac * 100).toFixed(1) + "% >= 97%");
  ok(cvFrac >= 0.95, "ClinVar coverage " + (cvFrac * 100).toFixed(1) + "% >= 95%");

  // union arithmetic
  const nb = D.meta.neighborhood;
  const c1only = nb.CTBP1 - nb.shared, c2only = nb.CTBP2 - nb.shared;
  ok(nb.union === nodes.length, "meta.neighborhood.union == nodes.length (" + nb.union + "/" + nodes.length + ")");
  ok(nb.shared + c1only + c2only === nb.union, "shared + CTBP1-only + CTBP2-only == union");
  ok(nb.shared === shared && c1only === c1 && c2only === c2, "meta attribution == recomputed");
  ok(D.meta.nodeCount === nodes.length + 2, "meta.nodeCount == nodes.length + 2");

  console.log("\n" + (fails ? "DATA VERIFY FAILED" : "DATA VERIFY PASSED") +
    "  (" + (checks - fails) + "/" + checks + " checks, " + warns + " warnings)");
  console.log("  nodes=" + nodes.length + "  shared=" + shared + "  CTBP1-only=" + c1 +
    "  CTBP2-only=" + c2 + "  edges=" + D.edges.length +
    "  co-mention=" + (cmFrac*100).toFixed(1) + "%  clinvar=" + (cvFrac*100).toFixed(1) +
    "%  biogrid=" + biogridN);
  process.exit(fails ? 1 : 0);
}
main();
