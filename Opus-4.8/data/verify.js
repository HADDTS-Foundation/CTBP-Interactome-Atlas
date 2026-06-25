#!/usr/bin/env node
/*
 * verify.js — falsifiable test harness (§9). Runs the EXACT engine.js against
 * app-data.js and asserts GENERIC INVARIANTS and DATA INTEGRITY only, never a
 * predetermined biological conclusion. No assertion pins a named gene to a
 * rank/area/type, and none requires a specific disease or paper to appear, so
 * the engine may disagree with the author's expectations and still pass.
 *
 *   node data/verify.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── load app-data.js + engine.js in one sandbox ──────────────────────────────
function loadSandbox() {
  const root = path.join(__dirname, '..');
  const ctx = { window: {}, console: console, module: { exports: {} }, navigator: {}, document: {} };
  ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ['app-data.js', 'engine.js']) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) { console.error(f + ' not found — build it first.'); process.exit(2); }
    vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
  }
  return { D: ctx.window.CTBP_DATA, EN: ctx.window.CTBP_ENGINE };
}
const { D, EN } = loadSandbox();

let pass = 0, fail = 0; const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
function eqSet(a, b) { if (a.size !== b.size) return false; for (const x of a) if (!b.has(x)) return false; return true; }
const num = (x) => (typeof x === 'number' && isFinite(x)) ? x : 0;
const isNum = (x) => typeof x === 'number' && isFinite(x);

ok(D && EN, 'data + engine loaded');

// ── 1. field registry: exactly 10 keys, exactly 5 sectors ─────────────────────
ok(EN.THEME_ORDER.length === 10, 'exactly 10 field keys');
ok(EN.SECTORS.length === 5, 'exactly 5 sector fields');
const expectKeys = ['oncology', 'metabolic', 'neurodegen', 'cns', 'neurodev', 'aging', 'immunity', 'cardiovascular', 'hematologic', 'eye'];
ok(eqSet(new Set(EN.THEME_ORDER), new Set(expectKeys)), 'field keys are exactly the 10 chosen (removed/renamed gone)');
ok(EN.SECTORS.every((k) => EN.THEMES[k].sector) && EN.THEME_ORDER.filter((k) => EN.THEMES[k].sector).length === 5, 'sector flags consistent');

// ── 2. ANTI-BIAS CORE: independent recomputation == engine members ────────────
// Recompute membership straight from raw data with the same rules; if a gene were
// hand-placed in the engine, the independent set would differ and this fails.
const FLOOR_HARD = 0.18, FLOOR_TOP3 = 0.10;
function indepDiseaseMatch(node, re) {
  const dis = node.dis || [], top3 = new Set(dis.slice(0, 3).map((d) => d.n)), out = [];
  for (const d of dis) if (re.test(d.n) && (num(d.s) >= FLOOR_HARD || (top3.has(d.n) && num(d.s) >= FLOOR_TOP3))) out.push(d);
  return out;
}
function indepMember(node, key) {
  const th = EN.THEMES[key];
  if (th.kind === 'ot') { let s = 0; (th.efo || []).forEach((k) => { s += num((node.areas || {})[k]); }); return s > th.threshold; }
  if (th.kind === 'name') return indepDiseaseMatch(node, th.re).length > 0;
  if (th.kind === 'aging') return !!node.aging;
  return false;
}
for (const key of EN.THEME_ORDER) {
  const indep = new Set(), eng = new Set();
  for (const n of D.nodes) {
    if (indepMember(n, key)) indep.add(n.sym);
    if (EN.fieldsFor(n).some((f) => f.key === key)) eng.add(n.sym);
  }
  ok(eqSet(indep, eng), `anti-bias: ${key} engine members == recomputation (indep ${indep.size}, engine ${eng.size})`);
}

// ── 3. displayed areas == lens membership == flags (consistent everywhere) ────
const findings = EN.findings(D, 'Both');
const bySymFindings = {};
findings.forEach((r) => { (bySymFindings[r.sym] || (bySymFindings[r.sym] = new Set())).add(r.key); });
for (const n of D.nodes) {
  const flags = new Set(EN.fieldsFor(n).map((f) => f.key));
  const fnd = bySymFindings[n.sym] || new Set();
  ok(eqSet(flags, fnd), `${n.sym}: fieldsFor == findings rows`);
}
// every theme's lens membership (themeSummary count) equals findings rows for it
const summary = EN.themeSummary(D, 'Both');
for (const key of EN.THEME_ORDER) {
  const fromFindings = findings.filter((r) => r.key === key).length;
  ok(summary[key].count === fromFindings, `${key}: themeSummary count == findings rows (${summary[key].count} vs ${fromFindings})`);
}

// ── 4. every flag is sourced + scored, citing real evidence ───────────────────
let sourcedBad = 0, citeBad = 0;
findings.forEach((r) => {
  if (!r.source || !r.source.url) sourcedBad++;
  if (!isNum(r.strength) || !(r.sev >= 1 && r.sev <= 3)) citeBad++;
  if (EN.THEMES[r.key].kind !== 'aging') {
    // disease-area flag must cite a real OT disease from the gene's own associations OR an area-sum
    const node = D.nodes.find((n) => n.sym === r.sym);
    if (r.top && r.top.disease) {
      ok((node.dis || []).some((d) => d.n === r.top.disease), `${r.sym}/${r.key}: cited disease is in the gene's own associations`);
    } else {
      ok(r.top && r.top.areaSum != null, `${r.sym}/${r.key}: ot flag carries an area-sum when no named disease`);
    }
  } else {
    const node = D.nodes.find((n) => n.sym === r.sym);
    ok(!!node.aging && (node.aging.genage || node.aging.longevity), `${r.sym}/aging: cites GenAge/LongevityMap membership`);
  }
});
ok(sourcedBad === 0, `every finding row is sourced (${sourcedBad} unsourced)`);
ok(citeBad === 0, `every finding row is scored with sev 1..3 (${citeBad} bad)`);
// findings == sum of memberships
let sumMember = 0; D.nodes.forEach((n) => { sumMember += EN.fieldsFor(n).length; });
ok(findings.length === sumMember, `findings() == sum of memberships (${findings.length} vs ${sumMember})`);

// ── 5. structural: analyse sorted by composite; valid types; never DB-only ────
const VALID_TYPES = new Set(['Core complex', 'Physical interactor', 'Literature-linked', 'Functional neighbour', 'Associated']);
['CTBP1', 'CTBP2', 'Both'].forEach((sel) => {
  const A = EN.analyse(D, sel);
  // in scope = nodes scoring against the selected hub(s)
  const inScope = D.nodes.filter((n) => (sel === 'Both') ? (n.s1 || n.s2) : (sel === 'CTBP1' ? n.s1 : n.s2)).length;
  ok(A.length === inScope, `analyse(${sel}) returns all in-scope nodes (${A.length} vs ${inScope})`);
  for (let i = 1; i < A.length; i++) ok(A[i - 1].composite >= A[i].composite, `analyse(${sel}) sorted by composite at ${i}` );
  A.forEach((o) => {
    o.hubs.forEach((h) => {
      const c = o.conn[h];
      ok(c && VALID_TYPES.has(c.type), `${o.sym}/${h}: valid connection type`);
      const s = h === 'CTBP1' ? o.node.s1 : o.node.s2;
      const ia = o.node.intact;
      const iaDirect = !!(ia && ia.direct);
      const iaPhys = !!(ia && (ia.direct || /physical association|direct interaction/i.test(ia.type || '')));
      if (c.type === 'Core complex') ok(num(s.c) >= 0.9 && (num(s.e) >= 0.5 || iaDirect), `${o.sym}/${h}: Core complex backed by experiments/IntAct, not DB alone`);
      if (c.type === 'Physical interactor') ok(num(s.e) >= 0.2 || iaPhys, `${o.sym}/${h}: Physical backed by experiments/IntAct, not DB alone`);
    });
  });
});
// break only the sorted spam into a single roll-up assertion to keep output readable
(function () { const A = EN.analyse(D, 'Both'); let sorted = true; for (let i = 1; i < A.length; i++) if (A[i - 1].composite < A[i].composite) sorted = false; ok(sorted, 'analyse(Both) fully sorted by composite'); })();

// ── 6. dual-hub invariants ────────────────────────────────────────────────────
const symset = new Set(D.nodes.map((n) => n.sym));
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k) && o[k] != null;
D.nodes.forEach((n) => {
  ok(n.hubs && n.hubs.length > 0, `${n.sym}: hubs non-empty`);
  ok((n.hubs.indexOf('CTBP1') >= 0) === has(n, 's1'), `${n.sym}: CTBP1 ∈ hubs iff s1`);
  ok((n.hubs.indexOf('CTBP2') >= 0) === has(n, 's2'), `${n.sym}: CTBP2 ∈ hubs iff s2`);
  ok(has(n, 'rank1') === has(n, 's1'), `${n.sym}: rank1 present iff s1`);
  ok(has(n, 'rank2') === has(n, 's2'), `${n.sym}: rank2 present iff s2`);
  if (!has(n, 's1')) ok(!has(n, 'lit1') && !has(n, 'comention1'), `${n.sym}: no CTBP1 fields without s1`);
  if (!has(n, 's2')) ok(!has(n, 'lit2') && !has(n, 'comention2'), `${n.sym}: no CTBP2 fields without s2`);
  ok(has(n, 's1') || has(n, 's2'), `${n.sym}: a direct neighbour of at least one hub`);
});
// routes: direct edge when one exists, else mediated (depth ≤ 3) over real edges
const edgeSet = new Set((D.edges || []).map((e) => [e.a, e.b].sort().join('|')));
function realHop(hop, hub) {
  if (hop.kind === 'hub') { const n = D.nodes.find((x) => x.sym === hop.to); return n && (hop.from === 'CTBP1' ? n.s1 : (hop.from === 'CTBP2' ? n.s2 : (n.s1 || n.s2))); }
  return edgeSet.has([hop.from, hop.to].sort().join('|'));
}
['CTBP1', 'CTBP2'].forEach((hub) => {
  const neigh = D.nodes.filter((n) => (hub === 'CTBP1' ? n.s1 : n.s2)).slice(0, 6);
  neigh.forEach((n) => { const r = EN.routes(D, hub, n.sym); ok(r.length === 1 && r[0].direct, `${hub}→${n.sym}: direct route when a direct edge exists`); });
  // a node NOT neighbouring this hub (other-hub-only) must yield a mediated, real route (if any)
  const otherOnly = D.nodes.filter((n) => !(hub === 'CTBP1' ? n.s1 : n.s2)).slice(0, 6);
  otherOnly.forEach((n) => {
    const r = EN.routes(D, hub, n.sym);
    r.forEach((route) => {
      ok(!route.direct, `${hub}→${n.sym}: non-neighbour route is mediated, not direct`);
      ok(route.hops.length <= 3, `${hub}→${n.sym}: route depth ≤ 3`);
      ok(route.hops.every((h) => realHop(h, hub)), `${hub}→${n.sym}: every hop is a real edge/neighbour`);
    });
  });
});
// neighborhood arithmetic
const shared = D.nodes.filter((n) => n.hubs.length === 2).length;
const c1 = D.nodes.filter((n) => n.hubs.length === 1 && n.hubs[0] === 'CTBP1').length;
const c2 = D.nodes.filter((n) => n.hubs.length === 1 && n.hubs[0] === 'CTBP2').length;
ok(D.meta.neighborhood.union === D.nodes.length, 'meta.neighborhood.union == nodes.length');
ok(shared + c1 + c2 === D.nodes.length, 'shared + CTBP1-only + CTBP2-only == union');

// ── 7. data integrity ─────────────────────────────────────────────────────────
const UMBRELLAS = new Set(['signal transduction', 'metabolism', 'disease', 'gene expression (transcription)', 'immune system', 'metabolism of proteins', 'developmental biology', 'cell cycle', 'hemostasis', 'dna repair']);
const BLOCK = new Set(['GLP1', 'P18', 'PC2', 'PH1', 'C21', 'DC42', 'IRA1']);
let idBad = 0, cvBad = 0, monoBad = 0, pmidBad = 0, umb = 0, homo = 0, hpoBad = 0, cvCount = 0;
D.nodes.forEach((n) => {
  if (!/^ENSG\d+$/.test(n.ensembl || '') || !/^\d+$/.test(String(n.entrez || ''))) idBad++;
  if (n.clinvar) { cvCount++; if (isNum(n.clinvar.plp) && isNum(n.clinvar.total) && n.clinvar.plp > n.clinvar.total) cvBad++; }
  [n.comention1, n.comention2, n.comentionB].forEach((cm) => { if (cm && [cm.title, cm.abs, cm.all].every(isNum) && !(cm.title <= cm.abs && cm.abs <= cm.all)) monoBad++; });
  if (n.comentionB) ok(!!n.s1 && !!n.s2, `${n.sym}: comentionB only on a shared node`);
  (n.pathways || []).forEach((p) => { if (UMBRELLAS.has(String(p).toLowerCase())) umb++; });
  (n.syn || []).forEach((s) => { if (BLOCK.has(String(s).toUpperCase())) homo++; });
  (n.refs || []).forEach((r) => { if (!/^\d+$/.test(String(r.pmid || ''))) pmidBad++; });
  if (n.phenotypes && n.phenoCount != null && n.phenoCount < n.phenotypes.length) hpoBad++;
});
ok(idBad === 0, `every node has well-formed Ensembl + Entrez (${idBad} bad)`);
ok(cvBad === 0, `ClinVar P/LP ≤ total wherever present (${cvBad} bad)`);
ok(monoBad === 0, `co-mention tiers monotonic (${monoBad} bad)`);
ok(umb === 0, `no Reactome umbrella terms (${umb} found)`);
ok(homo === 0, `ambiguous homograph aliases dropped from syn (${homo} found)`);
ok(pmidBad === 0, `references carry valid PMIDs (${pmidBad} bad)`);
ok(hpoBad === 0, `HPO phenoCount consistent with phenotype list (${hpoBad} bad)`);
ok(cvCount >= D.nodes.length * 0.5, `ClinVar present for the bulk of nodes (${cvCount}/${D.nodes.length})`);

// ── report ───────────────────────────────────────────────────────────────────
console.log(`\nverify (engine invariants): ${pass} passed, ${fail} failed`);
console.log(`  union=${D.nodes.length} shared=${shared} CTBP1-only=${c1} CTBP2-only=${c2} edges=${(D.edges || []).length}`);
if (fail) { console.log('\nFAILURES (first 30):'); fails.slice(0, 30).forEach((m) => console.log('  ✗ ' + m)); process.exit(1); }
console.log('OK — generic invariants hold; membership is provably data-driven.');
