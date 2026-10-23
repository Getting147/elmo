// M3 provider 端到端 UAT（Owner 拍板 hill 团队试车）
// 登录(API) → 触发已有品牌 research → 轮询 draft 状态（M3 真跑 ~60-120s）→ 验 done + payload 结构
import { chromium } from "file:///D:/elmo-src/node_modules/.pnpm/playwright-core@1.62.1/node_modules/playwright-core/index.mjs";

const BASE = "http://89.106.84.135:1515";
const BRAND_ID = "research-pipeline-test";
const results = [];
const ok = (name, cond, extra = "") => {
	results.push({ name, pass: !!cond, extra });
	console.log(`${cond ? "PASS" : "FAIL"} - ${name}${extra ? " | " + extra : ""}`);
};

const browser = await chromium.launch({ args: ["--no-proxy-server"] });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
	// 1. API 登录
	const resp = await ctx.request.post(`${BASE}/api/auth/sign-in/email`, {
		data: { email: "admin@negency.com", password: process.env.GEO_ADMIN_PASSWORD },
		headers: { "Content-Type": "application/json" },
	});
	ok("API 登录", resp.status() === 200, `status=${resp.status()}`);

	// 2. 触发 research（UI cookie 路径，验双 auth）
	const trigger = await ctx.request.post(`${BASE}/api/v1/brands/${BRAND_ID}/research/`, {
		data: { website: "https://www.haier.com" },
		headers: { "Content-Type": "application/json" },
	});
	const tbody = await trigger.json().catch(() => ({}));
	ok("触发 research", trigger.status() === 200 || trigger.status() === 202, `status=${trigger.status()} draftId=${tbody.draftId || ""} alreadyExisted=${tbody.alreadyExisted} jobSkipped=${tbody.jobSkipped}`);

	// 3. 轮询 draft（draftId 或最近草稿）
	const draftId = tbody.draftId;
	if (!draftId) { console.log("no draftId, abort"); process.exit(1); }
	let state = "", researchStatus = "", error = "", payload = null;
	for (let i = 0; i < 24; i++) {
		await sleep(10000);
		const r = await ctx.request.get(`${BASE}/api/v1/drafts/${draftId}`, {
			headers: { "Content-Type": "application/json" },
		});
		if (r.status() === 200) {
			const d = await r.json();
			state = d.state || "";
			researchStatus = d.researchStatus || "";
			error = d.error || "";
			payload = d.payload || null;
			console.log(`poll#${i + 1} state=${state} research=${researchStatus}${error ? " err=" + error.slice(0, 200) : ""}`);
			if (state === "done" || state === "failed" || researchStatus === "done" || researchStatus === "failed") break;
		} else {
			console.log(`poll#${i + 1} http=${r.status()}`);
		}
	}
	ok("draft 进 done（非 failed）", researchStatus === "done" || state === "done", `state=${state} research=${researchStatus} err=${error.slice(0, 150)}`);

	// 4. payload 结构验证（done 时）
	if (payload) {
		const lines = payload.productLines?.confirmed ?? [];
		const unverified = payload.productLines?.unverified ?? [];
		ok("payload 含品牌名", !!payload.brandName, `brandName=${payload.brandName || ""}`);
		ok("payload 含竞品", Array.isArray(payload.competitors) && payload.competitors.length > 0, `competitors=${(payload.competitors || []).length}`);
		ok("payload 含提示词", Array.isArray(payload.suggestedPrompts) && payload.suggestedPrompts.length > 0, `prompts=${(payload.suggestedPrompts || []).length}`);
		ok("payload 含产品线", lines.length > 0 || unverified.length > 0, `confirmed=${lines.length} unverified=${unverified.length}`);
		if (lines.length > 0) {
			const skus = lines[0].line?.skus ?? [];
			ok("产品线含 SKU", skus.length > 0, `line0=${lines[0].line?.name || ""} skus=${skus.length}`);
		}
	}
} catch (e) {
	console.log("ERROR:", String(e).slice(0, 500));
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n=== M3 UAT: ${passed}/${results.length} PASS ===`);
process.exit(passed === results.length ? 0 : 2);
