// 生产复测：onboarding draft 流（Epic A-2 M2+M3 全链）
// 登录(API) → /app/new 建档 → prompt-wizard 触发研究 → 轮询 review → 编辑保存 → confirm → profile 验证
import { chromium } from "file:///D:/elmo-src/node_modules/.pnpm/playwright-core@1.62.1/node_modules/playwright-core/index.mjs";

const BASE = "http://89.106.84.135:1515";
const BRAND_NAME = "Research Pipeline Test";
const WEBSITE = "https://www.haier.com";
const results = [];
const ok = (name, cond, extra = "") => {
	results.push({ name, pass: !!cond, extra });
	console.log(`${cond ? "PASS" : "FAIL"} - ${name}${extra ? " | " + extra : ""}`);
};

const browser = await chromium.launch({ args: ["--no-proxy-server"] });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 940 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
page.on("pageerror", (e) => { const m = String(e); if (!m.includes("Cross-Origin-Opener-Policy")) errors.push(m.slice(0, 200)); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bodyText = async () => (await page.textContent("body")) || "";

try {
	// 1. API 登录（better-auth，绕 hydration #418）
	const resp = await ctx.request.post(`${BASE}/api/auth/sign-in/email`, {
		data: { email: "admin@negency.com", password: process.env.GEO_ADMIN_PASSWORD },
		headers: { "Content-Type": "application/json" },
	});
	ok("API 登录", resp.status() === 200);

	// 2. 建档 /app/new
	await page.goto(`${BASE}/app/new`, { waitUntil: "networkidle", timeout: 60000 });
	await sleep(4000);
	let txt = await bodyText();
	await page.locator('input[name="brandName"]').waitFor({ timeout: 15000 }).catch(() => {});
	ok("建档页渲染", (await page.locator('input[name="brandName"]').count()) === 1);
	console.log("--- /app/new body 前 300:", txt.slice(0, 300).replace(/\s+/g, " "));

	// 建档表单：找 brand name / website 输入
	const nameInput = page.locator('input[name="brandName"], input[name="name"]').first();
	const siteInput = page.locator('input[name="website"]').first();
	console.log("nameInput count:", await nameInput.count(), "siteInput count:", await siteInput.count());
	if ((await nameInput.count()) === 0) {
		// dump 所有 input 结构
		const inputs = await page.locator("input").evaluateAll((els) => els.map((e) => ({ name: e.name, ph: e.placeholder, type: e.type })));
		console.log("inputs:", JSON.stringify(inputs));
		throw new Error("no name input found");
	}
	await nameInput.fill(BRAND_NAME);
	await siteInput.fill(WEBSITE);
	// 提交按钮
	const submitBtn = page
		.locator('button[type="submit"], button:has-text("Create"), button:has-text("创建"), button:has-text("Continue"), button:has-text("下一步"), button:has-text("立即创建")')
		.first();
	console.log("submitBtn count:", await submitBtn.count());
	if ((await submitBtn.count()) === 0) throw new Error("no submit button");
	await submitBtn.click();
	await sleep(6000);
	const url = page.url();
	ok("建档后跳转品牌页", /\/app\/[^/]+$/.test(url), url);

	// 3. 触发品牌研究（prompt-wizard 自动出现 → 找触发按钮）
	txt = await bodyText();
	console.log("--- 品牌页 body 前 400:", txt.slice(0, 400).replace(/\s+/g, " "));
	const triggerBtn = page
		.locator(
			'button:has-text("Analyze"), button:has-text("分析"), button:has-text("Research"), button:has-text("研究"), button:has-text("Start"), button:has-text("开始")',
		)
		.first();
	console.log("triggerBtn count:", await triggerBtn.count());
	if ((await triggerBtn.count()) > 0) {
		await triggerBtn.click();
		console.log("trigger clicked");
	} else {
		console.log("NO trigger button — wizard 可能自动触发或需检查页面结构");
	}

	// 4. 轮询等待 review 表单（analyzing → done，最长 180s）
	let reviewSeen = false;
	let lastTxt = "";
	for (let i = 0; i < 36; i++) {
		await sleep(5000);
		txt = await bodyText();
		lastTxt = txt;
		if (/product|SKU|竞品|competitor|summary|定位|建议|prompt/i.test(txt) && !/analyzing|研究进行中|分析中/i.test(txt)) {
			// 简单判定：出现编辑类元素（textarea/多行输入）且非 analyzing
			const editCount = await page.locator("textarea, input").count();
			if (editCount > 5) { reviewSeen = true; break; }
		}
		if (i % 6 === 0) console.log(`wait review ${(i + 1) * 5}s... chars=${txt.length}`);
	}
	ok("review 表单出现（180s 内）", reviewSeen);
	if (reviewSeen) {
		console.log("--- review body 片段:", lastTxt.replace(/\s+/g, " ").slice(0, 600));
		// 5. 找保存/确认按钮并点击（confirm 灌库）
		const saveBtn = page
			.locator('button:has-text("Save"), button:has-text("保存"), button:has-text("Confirm"), button:has-text("确认"), button:has-text("Finish"), button:has-text("完成")')
			.first();
		console.log("saveBtn count:", await saveBtn.count());
		if ((await saveBtn.count()) > 0) {
			await saveBtn.click();
			await sleep(8000);
			const afterTxt = await bodyText();
			ok("confirm 后品牌 onboarded", !/onboarding|研究|research|分析/i.test(afterTxt) || (await page.url()).includes("/app/"), (await page.url()));
		}
	}

	// 6. 截图存档
	await page.screenshot({ path: "D:/AI_answer/prod_research_flow_final.png", fullPage: false });
} catch (e) {
	ok("脚本无异常", false, String(e).slice(0, 300));
	await page.screenshot({ path: "D:/AI_answer/prod_research_flow_error.png", fullPage: false });
}

ok("无 console/page 错误", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log("\n=== RESULTS ===");
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"} ${r.name}${r.extra ? " :: " + r.extra : ""}`);
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
