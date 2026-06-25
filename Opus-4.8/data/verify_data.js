#!/usr/bin/env node
/*
 * verify_data.js — data-only integrity check (§8 of the data build prompt).
 * Loads ONLY app-data.js (no engine dependency) and asserts the snapshot is
 * well-formed, so the data build can be verified before the app exists.
 *
 *   node data/verify_data.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REACTOME_UMBRELLAS = new Set([
  'signal transduction', 'metabolism', 'disease', 'gene expression (transcription)',
  'immune system', 'metabolism of proteins', 'metabolism of rna', 'developmental biology',
  'cell cycle', 'cellular responses to stimuli', 'cellular responses to stress',
  'hemostasis', 'dna repair', 'dna replication', 'transport of small molecules',
  'vesicle-mediated transport', 'programmed cell death', 'neuronal system',
  'extracellular matrix organization', 'muscle contraction', 'metabolism of lipids',
  'chromatin organization', 'post-translational protein modification',
  'rna polymerase ii transcription', 'generic transcription pathway',
  'organelle biogenesis and maintenance', 'autophagy', 'protein localization',
  'sensory perception', 'reproduction', 'circadian clock', 'digestion and absorption',
]);
const SYN_BLOCKLIST = new Set(['GLP1', 'P18', 'PC2', 'PH1', 'C21', 'DC42', 'IRA1']);

let pass = 0, fail = 0, warn = 0;
const fails = [];
function ok(cond, msg) { if (cond) { pass++; } else { fail++; fails.push(msg); } }
function warnIf(cond, msg) { if (cond) { warn++; console.log('  ~ warn: ' + msg); } }
const isNum = (x) => typeof x === 'number' && isFinite(x);
const present = (o, k) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== null && o[k] !== undefined;

function load() {
  const p = path.join(__dirname, '..', 'app-data.js');
  if (!fs.existsSync(p)) { console.error('app-data.js not found — run the pipeline first'); process.exit(2); }
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox);
  return sandbox.window.CTBP_DATA;
}

const D = load();

// ── shape ──────────────────────────────────────────────────────────────────
ok(D && typeof D === 'object', 'CTBP_DATA is an object');
ok(D.hubs && D.hubs.CTBP1 && D.hubs.CTBP2, 'both hub blocks present');
ok(D.hubEdge && D.hubEdge.s && isNum(D.hubEdge.s.c), 'hubEdge.s.c numeric');
ok(Array.isArray(D.nodes) && D.nodes.length > 0, 'nodes array non-empty');
ok(Array.isArray(D.edges), 'edges array present');
ok(D.meta && typeof D.meta === 'object', 'meta present');
ok(Array.isArray(D.meta.hubs) && D.meta.hubs.join(',') === 'CTBP1,CTBP2', 'meta declares both hubs');

// ── per-node invariants ──────────────────────────────────────────────────────
let cvCount = 0, monoBad = 0, cm1 = 0, cm2 = 0, cmB = 0;
for (const n of D.nodes) {
  const tag = n.sym || '(no sym)';
  ok(/^ENSG\d+$/.test(n.ensembl || ''), `${tag}: well-formed Ensembl`);
  ok(/^\d+$/.test(String(n.entrez || '')), `${tag}: well-formed Entrez`);

  ok(Array.isArray(n.hubs) && n.hubs.length > 0, `${tag}: hubs non-empty`);
  const hubsOk = (n.hubs || []).every((h) => h === 'CTBP1' || h === 'CTBP2');
  ok(hubsOk, `${tag}: hubs ⊆ {CTBP1,CTBP2}`);

  // hubs exactly matches which of s1/s2 are non-null
  ok((n.hubs.includes('CTBP1')) === present(n, 's1'), `${tag}: CTBP1 ∈ hubs iff s1`);
  ok((n.hubs.includes('CTBP2')) === present(n, 's2'), `${tag}: CTBP2 ∈ hubs iff s2`);

  // rank + STRING score are STRUCTURAL (present iff the node neighbours that hub).
  ok(present(n, 'rank1') === present(n, 's1'), `${tag}: rank1 iff s1`);
  ok(present(n, 'rank2') === present(n, 's2'), `${tag}: rank2 iff s2`);
  // co-mention / lit / comentionB are hub-INDEPENDENT literature (present for any gene)
  if (present(n, 'comention1')) cm1++;
  if (present(n, 'comention2')) cm2++;
  if (present(n, 'comentionB')) cmB++;

  // s.c numeric where a score exists
  if (present(n, 's1')) ok(isNum(n.s1.c), `${tag}: s1.c numeric`);
  if (present(n, 's2')) ok(isNum(n.s2.c), `${tag}: s2.c numeric`);

  // co-mention tiers monotonic title ≤ abs ≤ all (per hub and the both-hub set)
  for (const cm of [n.comention1, n.comention2, n.comentionB]) {
    if (cm && [cm.title, cm.abs, cm.all].every(isNum)) {
      if (!(cm.title <= cm.abs && cm.abs <= cm.all)) monoBad++;
    }
  }

  // ClinVar plp ≤ total wherever present
  if (n.clinvar) {
    cvCount++;
    const { plp, total } = n.clinvar;
    if (isNum(plp) && isNum(total)) ok(plp <= total, `${tag}: ClinVar plp ≤ total`);
  }

  // no Reactome umbrellas
  for (const p of n.pathways || []) {
    ok(!REACTOME_UMBRELLAS.has(String(p).toLowerCase()), `${tag}: pathway not an umbrella (${p})`);
  }
  // ambiguous homographs dropped from syn
  for (const s of n.syn || []) {
    ok(!SYN_BLOCKLIST.has(String(s).toUpperCase()), `${tag}: syn drops homograph (${s})`);
  }
}
ok(monoBad === 0, `co-mention tiers monotonic (${monoBad} violations)`);
// co-mention is hub-independent: every node should carry CTBP1, CTBP2 and both-hub counts
const N = D.nodes.length;
ok(cm1 >= N * 0.9 && cm2 >= N * 0.9 && cmB >= N * 0.9,
   `co-mention present for both hubs + both on ≥90% of nodes (CTBP1 ${cm1}, CTBP2 ${cm2}, both ${cmB} of ${N})`);
warnIf(cvCount < D.nodes.length * 0.8, `ClinVar coverage ${cvCount}/${D.nodes.length} (<80%)`);
ok(cvCount >= D.nodes.length * 0.5, `ClinVar present for ≥50% of nodes (${cvCount}/${D.nodes.length})`);

// ── both hubs ClinVar ─────────────────────────────────────────────────────────
for (const H of ['CTBP1', 'CTBP2']) {
  const cv = D.hubs[H].clinvar;
  if (cv && isNum(cv.plp) && isNum(cv.total)) ok(cv.plp <= cv.total, `${H}: ClinVar plp ≤ total`);
  else warnIf(true, `${H}: ClinVar absent on hub block`);
}

// ── neighborhood arithmetic ────────────────────────────────────────────────────
const shared = D.nodes.filter((n) => n.hubs.length === 2).length;
const c1 = D.nodes.filter((n) => n.hubs.length === 1 && n.hubs[0] === 'CTBP1').length;
const c2 = D.nodes.filter((n) => n.hubs.length === 1 && n.hubs[0] === 'CTBP2').length;
ok(D.meta.neighborhood.union === D.nodes.length, 'meta.neighborhood.union == nodes.length');
ok(shared + c1 + c2 === D.nodes.length, 'shared + CTBP1-only + CTBP2-only == union');
ok(D.meta.nodeCount === D.nodes.length + 2, 'meta.nodeCount == nodes.length + 2');
ok(shared > 0, 'at least one shared node (both hubs)');
warnIf(c2 === 0, 'no CTBP2-only nodes (a symmetric build should have some)');

// ── edges ──────────────────────────────────────────────────────────────────────
const symset = new Set(D.nodes.map((n) => n.sym));
let danglers = 0;
for (const e of D.edges) {
  ok(typeof e.a === 'string' && typeof e.b === 'string' && isNum(e.s) && e.a !== e.b,
     `edge well-formed (${e.a}-${e.b})`);
  if (!symset.has(e.a) || !symset.has(e.b)) danglers++;
}
warnIf(danglers > 0, `${danglers} edges reference a non-union gene`);

// ── report ───────────────────────────────────────────────────────────────────
console.log(`\nverify_data: ${pass} passed, ${fail} failed, ${warn} warnings`);
console.log(`  union=${D.nodes.length}  shared=${shared}  CTBP1-only=${c1}  CTBP2-only=${c2}  edges=${D.edges.length}  built=${D.meta.date}`);
if (fail) {
  console.log('\nFAILURES (first 25):');
  fails.slice(0, 25).forEach((m) => console.log('  ✗ ' + m));
  process.exit(1);
}
console.log('OK — snapshot is well-formed.');
