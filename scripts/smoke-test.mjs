// Headless smoke test: executes the inline site script from index.html with a
// minimal DOM/canvas stub and real data/history.json, then asserts the render
// produced sane output. Run: node scripts/smoke-test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const data = JSON.parse(readFileSync(new URL("../data/history.json", import.meta.url), "utf8"));
const src = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];

const gradient = { addColorStop() {} };
const ctx = new Proxy({}, {
  get(t, k) {
    if (k === "createLinearGradient" || k === "createRadialGradient") return () => gradient;
    if (typeof t[k] !== "undefined") return t[k];
    return () => {};
  },
  set(t, k, v) { t[k] = v; return true; },
});

const captured = {};
function el(id) {
  const store = { style: {}, dataset: {}, _html: "", _text: "" };
  return new Proxy(store, {
    get(t, k) {
      switch (k) {
        case "getContext": return () => ctx;
        case "classList": return { add() {}, remove() {} };
        case "addEventListener": return () => {};
        case "clientWidth": return 900;
        case "clientHeight": return 400;
        case "innerHTML": return t._html;
        case "textContent": return t._text;
        default: return t[k];
      }
    },
    set(t, k, v) {
      if (k === "innerHTML") { t._html = v; captured[id + ".html"] = v; }
      else if (k === "textContent") { t._text = v; captured[id + ".text"] = v; }
      else t[k] = v;
      return true;
    },
  });
}

const els = {};
const sandbox = {
  console,
  Date,
  Math,
  JSON,
  Infinity,
  isFinite,
  document: {
    getElementById: id => (els[id] ??= el(id)),
    querySelectorAll: () => [],
    title: "",
  },
  matchMedia: () => ({ matches: true }),
  addEventListener: () => {},
  setInterval: () => {},
  requestAnimationFrame: () => {},
  innerWidth: 1200,
  innerHeight: 800,
  devicePixelRatio: 1,
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(data) }),
};
sandbox.window = sandbox;
Object.defineProperty(sandbox.document, "title", {
  set(v) { captured["doc.title"] = v; },
  get() { return captured["doc.title"] || ""; },
});

vm.createContext(sandbox);
vm.runInContext(src, sandbox);

await new Promise(r => setTimeout(r, 50)); // let load() resolve

const checks = [
  ["price rendered", /\$/.test(captured["price.html"] || "") && /\d/.test(captured["price.html"])],
  ["day pill rendered", /%/.test(captured["dayPill.html"] || "")],
  ["ipo pill rendered", /%/.test(captured["ipoPill.html"] || "")],
  ["status text set", /[A-Z]/.test(captured["statusTxt.text"] || "")],
  ["market state set", (captured["mstateTxt.text"] || "").length > 2],
  ["stats grid rendered", ((captured["stats.html"] || "").match(/class="stat"/g) || []).length === 8],
  ["title has price", /SPCX \$\d/.test(captured["doc.title"] || "")],
  ["no error shown", !(captured["err.text"] || "").length],
];

let fail = 0;
for (const [name, ok] of checks) {
  console.log((ok ? "PASS" : "FAIL") + "  " + name);
  if (!ok) fail++;
}
console.log("---");
console.log("price:", captured["price.html"]);
console.log("day:", captured["dayPill.html"]);
console.log("ipo:", captured["ipoPill.html"]);
console.log("status:", captured["statusTxt.text"], "| market:", captured["mstateTxt.text"]);
console.log("title:", captured["doc.title"]);
process.exit(fail ? 1 : 0);
