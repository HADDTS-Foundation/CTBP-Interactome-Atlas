#!/usr/bin/env node
/*
 * headless_check.js  -  dev utility (not part of the shipped test contract).
 *
 * Launches Brave/Chrome headless, opens index.html?noboot from file://, and drives
 * the page over the DevTools protocol (Runtime.evaluate) to assert it boots with no
 * console errors and that the dual-hub selector + focus mode actually work. Asserts
 * computed state via the protocol, not pixels (the central canvas may capture blank).
 *
 *   node data/headless_check.js
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const BROWSERS = [
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
];
const PORT = 9333;
const URL = "file://" + path.join(__dirname, "..", "index.html") + "?noboot";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function getJSON(u) { const r = await fetch(u); return r.json(); }

async function main() {
  const bin = BROWSERS.find((b) => fs.existsSync(b));
  if (!bin) { console.error("No Chromium-family browser found."); process.exit(2); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctbp-brave-"));
  const proc = spawn(bin, ["--headless=new", "--disable-gpu", "--no-first-run",
    "--no-default-browser-check", "--remote-allow-origins=*",
    "--remote-debugging-port=" + PORT, "--user-data-dir=" + dir, URL], { stdio: "ignore" });

  let ok = true;
  try {
    // wait for devtools, then find the page target (localhost satisfies the Host check)
    let tab = null;
    for (let i = 0; i < 50; i++) {
      try {
        const list = await getJSON("http://localhost:" + PORT + "/json/list");
        tab = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (tab) break;
      } catch (e) {}
      await sleep(250);
    }
    if (!tab) throw new Error("no page target from devtools");
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    const errors = [];
    let id = 0; const pending = {};
    function send(method, params) { return new Promise((res) => { const mid = ++id; pending[mid] = res; ws.send(JSON.stringify({ id: mid, method, params: params || {} })); }); }
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending[msg.id]) { pending[msg.id](msg.result); delete pending[msg.id]; }
      if (msg.method === "Runtime.exceptionThrown") { var ed = msg.params.exceptionDetails; errors.push((ed.exception && (ed.exception.description || ed.exception.value)) || ed.text || JSON.stringify(ed)); }
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push(msg.params.args.map((a) => a.value || a.description).join(" "));
    };
    await send("Runtime.enable");
    await send("Page.enable");
    await sleep(1600); // let it render

    async function evalJS(expr) {
      const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
      if (r && r.exceptionDetails) { errors.push("eval: " + (r.exceptionDetails.exception && r.exceptionDetails.exception.description)); return null; }
      return r && r.result ? r.result.value : null;
    }

    const checks = [];
    function assert(c, m) { checks.push([!!c, m]); if (!c) ok = false; }

    assert(await evalJS("!!document.querySelector('#tabs button')"), "tabs rendered");
    assert(await evalJS("!!document.querySelector('#left .seg [data-hub]')"), "hub selector rendered");
    assert(await evalJS("document.querySelectorAll('#left .lens').length===10"), "10 field lenses rendered");
    assert(await evalJS("!!document.querySelector('#drawer .dwrap')"), "drawer rendered (hub dossier)");
    assert(await evalJS("!!window.CTBP_DATA && !!window.CTBP_ENGINE"), "data + engine loaded");
    // switch hub to CTBP1
    await evalJS("document.querySelector(\"[data-hub='CTBP1']\").click()");
    await sleep(300);
    assert(await evalJS("document.querySelector(\"[data-hub='CTBP1']\").classList.contains('on')"), "hub switch to CTBP1 works");
    // back to Both, focus a gene
    await evalJS("document.querySelector(\"[data-hub='Both']\").click()"); await sleep(200);
    const gene = await evalJS("window.CTBP_DATA.nodes.find(function(n){return n.s2&&!n.s1}).sym");
    await evalJS("var i=document.querySelector('#focusInput'); i.value='" + gene + "'; i.dispatchEvent(new Event('input',{bubbles:true}));");
    await sleep(500);
    assert(await evalJS("document.querySelector('#v-network').classList.contains('on')"), "focus enters Network view");
    assert(await evalJS("!!document.querySelector('#nv-wrap .canvas-legend')"), "network route legend shown for focus");
    // open a gene dossier via table
    await evalJS("document.querySelector(\"[data-view='table']\").click()"); await sleep(300);
    assert(await evalJS("document.querySelectorAll('#v-table tr[data-gene]').length>0"), "table rows rendered");
    // theme toggle
    await evalJS("document.querySelector('#themeBtn').click()"); await sleep(150);
    assert(await evalJS("document.documentElement.getAttribute('data-theme')==='dark'"), "dark theme toggles");

    assert(errors.length === 0, "no console errors / exceptions" + (errors.length ? " -> " + JSON.stringify(errors.slice(0, 5)) : ""));

    console.log("");
    checks.forEach((c) => console.log((c[0] ? "  ok  " : "  FAIL") + "  " + c[1]));
    console.log("\n" + (ok ? "HEADLESS PASSED" : "HEADLESS FAILED"));
    ws.close();
  } catch (e) {
    console.error("harness error:", e.message); ok = false;
  } finally {
    proc.kill("SIGKILL");
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }
  process.exit(ok ? 0 : 1);
}
main();
