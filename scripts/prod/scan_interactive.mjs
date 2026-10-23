import { chromium } from "file:///D:/elmo-src/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs";
const BASE = "http://89.106.84.135:1515";
const b = await chromium.launch({ args: ["--no-proxy-server"] });
const p = await b.newPage();
await p.goto(`${BASE}/auth/login`, { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(2500);
await p.locator('input[type="email"]').fill("admin@negency.com");
await p.locator('input[type="password"]').fill(process.env.GEO_ADMIN_PASSWORD || "");
await p.locator('button[type="submit"]').click({ force: true });
await p.waitForTimeout(5000);
await p.evaluate(() => localStorage.setItem("elmo_lang", "zh"));
await p.reload({ waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(5000);

async function grab(tag) {
  return await p.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const out = [];
    let node;
    while ((node = walker.nextNode())) {
      const el = node.parentElement;
      if (!el || el.closest("script,style")) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const t = node.nodeValue;
      if (!t || !/[A-Za-z]{3}/.test(t)) continue;
      const clean = t.trim();
      if (clean.length < 3) continue;
      const chain = [];
      let cur = el;
      for (let i = 0; i < 3 && cur; i++) {
        const cls = typeof cur.className === "string" && cur.className ? "." + cur.className.slice(0, 50) : "";
        chain.push(cur.tagName.toLowerCase() + cls);
        cur = cur.parentElement;
      }
      out.push({ text: clean.slice(0, 90), chain: chain.join(" < ") });
    }
    const seen = new Set();
    const dedup = [];
    for (const o of out) { const k = o.text + "|" + o.chain; if (!seen.has(k)) { seen.add(k); dedup.push(o); } }
    return dedup.slice(0, 60);
  });
}

const pages = ["/app/gree", "/app/gree/citations", "/app/gree/visibility", "/app/gree/prompts", "/app/gree/share-of-voice"];
for (const path of pages) {
  await p.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(7000);
  console.log(`\n===== ${path} 静态态 =====`);
  (await grab()).forEach(r => console.log("  " + r.text + "  [" + r.chain + "]"));

  // 打开页面上所有下拉（button/select role）
  const btns = await p.locator('button:has(svg), [role="combobox"], select').count().catch(() => 0);
  for (let i = 0; i < Math.min(btns, 12); i++) {
    const loc = p.locator('button:has(svg), [role="combobox"], select').nth(i);
    try { await loc.click({ force: true, timeout: 2000 }); await p.waitForTimeout(900); } catch { continue; }
  }
  // 打开后抓一次（下拉面板出现）
  const afterDrop = await grab();
  if (afterDrop.length) {
    console.log(`--- 下拉展开后新增/可见英文 ---`);
    afterDrop.forEach(r => console.log("  " + r.text + "  [" + r.chain + "]"));
  }
  // 关闭可能的弹出层
  await p.keyboard.press("Escape").catch(() => {});
  await p.waitForTimeout(400);
}
await b.close();
