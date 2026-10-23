import { chromium } from "file:///D:/elmo-src/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs";
const BASE = "http://89.106.84.135:1515";
const PAGES = ["/app/gree", "/app/gree/visibility", "/app/gree/share-of-voice", "/app/gree/citations", "/app/gree/opportunities", "/app/gree/prompts"];
const b = await chromium.launch({ args: ["--no-proxy-server"] });
const p = await b.newPage();
await p.goto(`${BASE}/auth/login`, { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(2500);
await p.locator('input[type="email"]').fill("admin@negency.com");
await p.locator('input[type="password"]').fill(process.env.GEO_ADMIN_PASSWORD || "");
await p.locator('button[type="submit"]').click({ force: true });
await p.waitForTimeout(5000);
// 强制中文态（localStorage 语言键）
await p.evaluate(() => localStorage.setItem("elmo_lang", "zh"));
await p.reload({ waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(5000);
for (const path of PAGES) {
  await p.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(7000);
  const res = await p.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const texts = [];
    let node;
    while ((node = walker.nextNode())) {
      const el = node.parentElement;
      if (!el || el.closest("script,style")) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const t = node.textContent.trim();
      if (t) texts.push(t);
    }
    const joined = texts.join(" \u241F ");
    const m = joined.match(/[A-Za-z][A-Za-z ,'’\-&/0-9%().]{3,}/g) || [];
    const seen = new Set();
    const out = [];
    for (const s of m) {
      const clean = s.trim();
      if (clean.length < 4) continue;
      if (/^(https?|www\.)/.test(clean)) continue;
      if (!seen.has(clean) && out.length < 50) { seen.add(clean); out.push(clean); }
    }
    return out;
  });
  console.log(`\n=== ${path} ===`);
  res.forEach(r => console.log("  ", r.slice(0, 110)));
}
await b.close();
