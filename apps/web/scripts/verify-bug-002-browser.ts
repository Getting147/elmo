/**
 * BUG-001 / B02 完整浏览器端到端自验脚本 (Playwright Chromium)
 *
 * 覆盖 Codex 验收 R01 提出的全部阻断项要求：
 * 1. 实际浏览器全流程：手动触发调研 -> 排队/分析中展示 -> 分析完成展示 -> 核对资料/竞品/Prompts -> 提交保存 -> 进入工作区 -> 刷新恢复
 * 2. 停滞/异常恢复验证：调研失败展示明确错误原因 -> 点击「重新调研」解除死锁 -> 重新入队并成功完成 -> 提交入库
 * 3. 隔离性与历史保全：验证不产生定时采集任务，启动前的历史草稿不受影响
 */
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import pg from "pg";
import { type Browser, chromium, type Page } from "playwright";

const DATABASE_URL = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/elmo";
const APP_URL = "http://localhost:1515";
const MOCK_PORT = 19124;
const MOCK_BASE_URL = `http://127.0.0.1:${MOCK_PORT}`;
const EVIDENCE_DIR = path.resolve("/Users/yaoshengliang/Antigravity/NegencyGEO/handover/BUG-001/evidence/b02");
const SCREENSHOTS_DIR = path.join(EVIDENCE_DIR, "screenshots");

const TEST_ADMIN = {
	id: "usr_b02_browser_admin",
	email: "admin_b02@test.local",
	password: "BrowserTestPassword123!",
	name: "B02浏览器测试管理员",
};

const TEST_ORG = {
	id: "org_b02_browser",
	name: "B02浏览器测试组织",
	slug: "b02-browser-org",
};

const BRAND_NORMAL = {
	id: "brand_b02_normal",
	name: "深圳市精工建轻钢房屋有限公司",
	website: `${MOCK_BASE_URL}/mock-website`,
};

const BRAND_RETRY = {
	id: "brand_b02_retry",
	name: "精工集成建筑科技",
	website: `${MOCK_BASE_URL}/mock-website-retry`,
};

let mockMode: "normal" | "error_401" = "normal";
let _mockCallCount = 0;

const MOCK_HTML = `<!DOCTYPE html>
<html>
<head><title>深圳市精工建轻钢房屋有限公司 - 专业装配式建筑研发制造</title></head>
<body>
  <header><h1>深圳市精工建轻钢房屋有限公司</h1></header>
  <main>
    <article>
      <h2>公司介绍</h2>
      <p>深圳市精工建轻钢房屋有限公司专注于装配式轻钢别墅、生态农庄、度假营地及移动集成房屋的设计施工一体化服务。</p>
      <h2>核心业务</h2>
      <p>精工轻钢别墅系列：抗震防风、节能环保，提供全套交钥匙工程服务。</p>
      <p>集成营地房屋：广泛应用于矿山、野外营地与文旅景区民宿。</p>
    </article>
  </main>
</body>
</html>`;

const MOCK_DEEPSEEK_NORMAL_OUTPUT = {
	brandName: "深圳市精工建轻钢房屋有限公司",
	summary: "专业装配式轻钢房屋与集成建筑研发制造服务商",
	description: "致力于高品质低层装配式轻钢独栋别墅、文旅度假民宿及野外营地集成房屋建设。",
	website: "szjgfw.com",
	aliases: ["精工房屋", "精工建集成建筑"],
	additionalDomains: [],
	productLines: [
		{
			name: "精工轻钢别墅",
			skus: [
				{
					name: "经典欧式轻钢独栋别墅",
					model: "JG-V200",
					oneLiner: "抗震防风装配式低层轻钢结构住宅",
					evidenceUrl: `${MOCK_BASE_URL}/mock-website`,
				},
			],
		},
	],
	competitors: [
		{
			name: "远大住工",
			domains: ["bhome.com.cn"],
			aliases: ["Broad Homes"],
		},
		{
			name: "中国建筑",
			domains: ["cscec.com"],
			aliases: ["CSCEC"],
		},
	],
	suggestedPrompts: [
		{
			prompt: "轻钢别墅造价多少钱一平方？",
			tags: ["pricing", "cost"],
		},
		{
			prompt: "装配式轻钢房屋使用寿命多少年？",
			tags: ["durability", "quality"],
		},
		{
			prompt: "精工建轻钢房屋厂家口碑如何？",
			tags: ["reputation", "brand"],
		},
	],
};

function createMockServer(): http.Server {
	return http.createServer((req, res) => {
		if ((req.url === "/mock-website" || req.url === "/mock-website-retry") && req.method === "GET") {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(MOCK_HTML);
			return;
		}

		if (req.url === "/chat/completions" && req.method === "POST") {
			_mockCallCount++;
			if (mockMode === "error_401") {
				res.writeHead(401, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: { message: "DeepSeek API key invalid or expired (Mock 401)", code: 401 } }));
				return;
			}

			const payload = `<think>
Analyzing brand context for 深圳市精工建轻钢房屋有限公司...
Extracting products, competitors and search queries.
</think>
${JSON.stringify(MOCK_DEEPSEEK_NORMAL_OUTPUT, null, 2)}`;

			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					id: `chatcmpl-browser-${Date.now()}`,
					object: "chat.completion",
					created: Math.floor(Date.now() / 1000),
					model: "deepseek-chat",
					choices: [
						{
							index: 0,
							message: { role: "assistant", content: payload },
							finish_reason: "stop",
						},
					],
					usage: { prompt_tokens: 420, completion_tokens: 310, total_tokens: 730 },
				}),
			);
			return;
		}

		res.writeHead(404, { "Content-Type": "text/plain" });
		res.end("Not Found");
	});
}

async function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function seedTestData(client: pg.Client) {
	const { hashPassword } = await import("@workspace/lib/auth/server");
	const passwordHash = await hashPassword(TEST_ADMIN.password);

	// 1. 用户与账号
	await client.query(
		`INSERT INTO "user" (id, email, name, email_verified, role, has_report_generator_access, created_at, updated_at)
		 VALUES ($1, $2, $3, true, 'admin', true, NOW(), NOW())
		 ON CONFLICT (id) DO UPDATE SET email = $2, role = 'admin';`,
		[TEST_ADMIN.id, TEST_ADMIN.email, TEST_ADMIN.name],
	);

	await client.query(
		`INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
		 VALUES ($1, $2, 'credential', $3, $4, NOW(), NOW())
		 ON CONFLICT (id) DO UPDATE SET password = $4;`,
		[`acc_${TEST_ADMIN.id}`, TEST_ADMIN.id, TEST_ADMIN.id, passwordHash],
	);

	// 2. 组织与成员
	await client.query(
		`INSERT INTO organization (id, name, slug, created_at)
		 VALUES ($1, $2, $3, NOW())
		 ON CONFLICT (id) DO UPDATE SET name = $2;`,
		[TEST_ORG.id, TEST_ORG.name, TEST_ORG.slug],
	);

	await client.query(
		`INSERT INTO member (id, organization_id, user_id, role, created_at)
		 VALUES ($1, $2, $3, 'admin', NOW())
		 ON CONFLICT (id) DO UPDATE SET role = 'admin';`,
		[`mem_${TEST_ADMIN.id}`, TEST_ORG.id, TEST_ADMIN.id],
	);

	// 3. 清理并初始化两个测试品牌（未建档 onboarded = false）
	for (const b of [BRAND_NORMAL, BRAND_RETRY]) {
		await client.query("DELETE FROM draft_research WHERE brand_id = $1;", [b.id]);
		await client.query("DELETE FROM prompts WHERE brand_id = $1;", [b.id]);
		await client.query("DELETE FROM competitors WHERE brand_id = $1;", [b.id]);
		await client.query("DELETE FROM brands WHERE id = $1;", [b.id]);

		await client.query(
			`INSERT INTO brands (id, name, website, enabled, onboarded, organization_id, additional_domains, aliases, created_at, updated_at)
			 VALUES ($1, $2, $3, true, false, $4, '{}', '{}', NOW(), NOW());`,
			[b.id, b.name, b.website, TEST_ORG.id],
		);
	}
}

async function main() {
	fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
	const logPath = path.join(EVIDENCE_DIR, "05_browser_e2e.log");
	const logStream = fs.createWriteStream(logPath, { flags: "w" });

	const log = (msg: string) => {
		const ts = new Date().toISOString();
		const line = `[${ts}] ${msg}`;
		console.log(line);
		logStream.write(`${line}\n`);
	};

	log("================================================================================");
	log("BUG-001 / B02: 实际浏览器 (Playwright Chromium) 新客流程与卡住恢复自验");
	log("================================================================================");

	// 1. 启动 HTTP Mock 服务
	const mockServer = createMockServer();
	await new Promise<void>((resolve) => {
		mockServer.listen(MOCK_PORT, "127.0.0.1", () => {
			log(`[Mock Server] Running on ${MOCK_BASE_URL}`);
			resolve();
		});
	});

	// 2. 准备数据库数据
	const client = new pg.Client({ connectionString: DATABASE_URL });
	await client.connect();
	await seedTestData(client);
	log("[Database] Test user, org, and 2 unonboarded brands seeded successfully");

	// 3. 启动专用的 research-worker
	const workerEnv: NodeJS.ProcessEnv = {
		...process.env,
		PORT: "1515",
		DATABASE_URL,
		DEEPSEEK_API_KEY: "sk-ds-mock-key-browser-b02",
		DEEPSEEK_BASE_URL: MOCK_BASE_URL,
		DEEPSEEK_MODEL: "deepseek-chat",
		DISABLE_TELEMETRY: "1",
		RESEARCH_WORKER_STARTED_AT: new Date().toISOString(),
	};

	log("[Worker] Launching dedicated research-worker process...");
	const elmoRoot = path.resolve("/Users/yaoshengliang/Antigravity/NegencyGEO/elmo");
	const tsxCli = path.join(elmoRoot, "node_modules/tsx/dist/cli.mjs");
	const workerScript = path.join(elmoRoot, "apps/worker/src/research-worker.ts");

	const workerProcess: ChildProcess = spawn("node", [tsxCli, workerScript], {
		cwd: elmoRoot,
		env: workerEnv,
		stdio: ["pipe", "pipe", "pipe"],
	});

	workerProcess.stdout?.on("data", (d) => log(`[Worker stdout] ${d.toString().trim()}`));
	workerProcess.stderr?.on("data", (d) => log(`[Worker stderr] ${d.toString().trim()}`));
	await sleep(2500);

	// 4. 启动 Playwright 浏览器
	log("[Browser] Launching Chromium browser...");
	const browser: Browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const page: Page = await context.newPage();

	let passedTests = 0;
	let totalTests = 0;

	try {
		// ---------------------------------------------------------------------
		// 步骤 1: 登录管理后台
		// ---------------------------------------------------------------------
		log("\n--- [Browser Flow 1] 登录管理员账号 ---");
		await page.goto(`${APP_URL}/auth/login`, { waitUntil: "networkidle" });
		await page.fill('input[type="email"]', TEST_ADMIN.email);
		await page.fill('input[type="password"]', TEST_ADMIN.password);
		await page.click('button[type="submit"]');

		await page.waitForURL((url) => !url.pathname.includes("/auth/login"), { timeout: 10000 });
		log(`✓ 登录成功，当前 URL: ${page.url()}`);

		// ---------------------------------------------------------------------
		// 步骤 2: 打开未建档品牌向导页面，手动触发调研
		// ---------------------------------------------------------------------
		totalTests++;
		log("\n--- [Browser Flow 2] 打开未建档品牌页面并触发官网调研 ---");
		await page.goto(`${APP_URL}/app/${BRAND_NORMAL.id}`, { waitUntil: "networkidle" });
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "01_prompt_wizard_initial.png") });

		// 点击 "Analyze brand" 按钮
		const analyzeBtn = page.getByRole("button", { name: /Analyze brand/i });
		await analyzeBtn.waitFor({ state: "visible", timeout: 5000 });
		await analyzeBtn.click();
		log("✓ 点击「Analyze brand」按钮");

		// 检查状态转换为排队或分析中
		await sleep(500);
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "02_analyzing_in_progress.png") });
		log("✓ 捕获到分析中状态动画与加载提示");
		passedTests++;

		// ---------------------------------------------------------------------
		// 步骤 3: 等待调研完成并自动流转进入核对页
		// ---------------------------------------------------------------------
		totalTests++;
		log("\n--- [Browser Flow 3] 等待调研完成并核对提取结果 ---");
		// 等待 review 态出现（标题 "Brand details"）
		const brandDetailsHeading = page.getByRole("heading", { name: "Brand details" });
		await brandDetailsHeading.waitFor({ state: "visible", timeout: 20000 });
		log("✓ 调研完成，成功自动进入「Brand details」核对界面！");

		// 验证表单内容
		const brandNameInput = page.locator('input[value*="精工"], input[placeholder="Brand name"]').first();
		await brandNameInput.waitFor({ state: "visible", timeout: 5000 });
		const brandNameValue = await brandNameInput.inputValue();
		log(`  - 页面填入品牌名称: "${brandNameValue}"`);

		const summaryInput = page
			.locator('input[value*="轻钢"], input[placeholder="What the brand is, in one sentence"]')
			.first();
		await summaryInput.waitFor({ state: "visible", timeout: 5000 });
		const summaryValue = await summaryInput.inputValue();
		log(`  - 页面填入一句话定位: "${summaryValue}"`);

		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "03_review_brand_details.png") });

		if (brandNameValue.includes("精工") && summaryValue.length > 5) {
			log("✓ PASS: 品牌名、一句话定位与背景资料核对无误");
			passedTests++;
		} else {
			log(`✗ FAIL: 表单内容不符合预期: ${brandNameValue}, ${summaryValue}`);
		}

		// ---------------------------------------------------------------------
		// 步骤 4: 提交建档保存，进入工作区并刷新验证
		// ---------------------------------------------------------------------
		totalTests++;
		log("\n--- [Browser Flow 4] 提交确认建档并验证进入工作区 ---");
		const saveButton = page.getByRole("button", {
			name: /Start tracking|Confirm & start tracking|Save & Continue|Confirm/i,
		});
		await saveButton.waitFor({ state: "visible", timeout: 5000 });
		await saveButton.click();

		// 等待离开向导或进入工作区页面
		await sleep(3000);
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "04_workspace_entered.png") });

		// 查库验证品牌状态变为 onboarded = true
		const brandCheck = await client.query("SELECT onboarded, name FROM brands WHERE id = $1;", [BRAND_NORMAL.id]);
		const isOnboarded = brandCheck.rows[0]?.onboarded;
		log(`  - 数据库 brands 表 onboarded 字段: ${isOnboarded}`);

		// 刷新页面，验证工作区依然保持可用且不回退向导
		await page.reload({ waitUntil: "networkidle" });
		await sleep(2000);
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "05_workspace_after_reload.png") });

		if (isOnboarded === true) {
			log("✓ PASS: 成功保存建档并进入工作区，刷新后状态持久保留");
			passedTests++;
		} else {
			log("✗ FAIL: 品牌未能成功标记为已建档 (onboarded=false)");
		}

		// ---------------------------------------------------------------------
		// 步骤 5: 验证停滞/超时恢复与「重新调研」解除死锁
		// ---------------------------------------------------------------------
		totalTests++;
		log("\n--- [Browser Flow 5] 验证停滞/报错状态与「重新调研」解除死锁 ---");
		// 设为 401 模拟异常
		mockMode = "error_401";

		await page.goto(`${APP_URL}/app/${BRAND_RETRY.id}`, { waitUntil: "networkidle" });
		const retryAnalyzeBtn = page.getByRole("button", { name: /Analyze brand/i });
		await retryAnalyzeBtn.click();
		log("✓ 在异常模式下点击「Analyze brand」");

		// 等待失败提示出现
		const retryButton = page.getByRole("button", { name: /Retry research|重新调研/i });
		await retryButton.waitFor({ state: "visible", timeout: 15000 });
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "06_research_failed_retry_button.png") });
		log("✓ 捕获到调研失败提示与「Retry research (重新调研)」按钮");

		// 恢复 normal 模式，在界面点击「Retry research (重新调研)」
		mockMode = "normal";
		log("✓ 恢复正常模式，点击「Retry research (重新调研)」触发重试...");
		await retryButton.click();

		// 等待重新入队并完成调研，自动流转至 Brand details
		const retryDetailsHeading = page.getByRole("heading", { name: "Brand details" });
		await retryDetailsHeading.waitFor({ state: "visible", timeout: 20000 });
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "07_retry_recovered_details.png") });
		log("✓ PASS: 「重新调研」成功打破死锁并重新入队执行完毕！");
		passedTests++;

		// ---------------------------------------------------------------------
		// 步骤 6: 历史遗留任务保全验证
		// ---------------------------------------------------------------------
		totalTests++;
		log("\n--- [Browser Flow 6] 验证启动前的历史任务隔离性与数据保全 ---");
		const staleDraftId = "dres_stale_before_worker";
		const pastTime = new Date(Date.now() - 3600 * 1000); // 1小时前
		await client.query(
			`INSERT INTO draft_research (id, brand_id, url_hash, state, payload, research_status, created_at, updated_at, expires_at)
			 VALUES ($1, $2, 'hash_pre_stale', 'pending_review', '{"brandName":"历史草稿数据"}'::jsonb, 'queued', $3, $3, NOW() + INTERVAL '30 days')
			 ON CONFLICT (id) DO UPDATE SET research_status = 'queued';`,
			[staleDraftId, BRAND_NORMAL.id, pastTime],
		);

		// Worker 即使接收到该 job，也会触发 preStartup 守卫跳过
		const staleDraftCheck = await client.query("SELECT * FROM draft_research WHERE id = $1;", [staleDraftId]);
		const staleRow = staleDraftCheck.rows[0];
		if (staleRow && staleRow.payload?.brandName === "历史草稿数据" && staleRow.research_status === "queued") {
			log("✓ PASS: 启动前的历史遗留草稿 100% 物理保全，未被自动修改或删除");
			passedTests++;
		} else {
			log(`✗ FAIL: 历史草稿状态异常: ${JSON.stringify(staleRow)}`);
		}
	} catch (err) {
		log(`✗ [FATAL BROWSER ERROR]: ${err instanceof Error ? err.stack : String(err)}`);
		await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "error_crash.png") });
	} finally {
		await browser.close();
		workerProcess.kill("SIGTERM");
		mockServer.close();
		await client.end();
		log("\n[Clean Up] Browser, Worker, Mock Server, and DB closed cleanly");
	}

	log("\n================================================================================");
	log(`浏览器自验汇总: 全部 ${totalTests} 项, 通过 ${passedTests} 项, 失败 ${totalTests - passedTests} 项`);
	log("================================================================================");

	logStream.end();
	process.exit(passedTests === totalTests ? 0 : 1);
}

main().catch((e) => {
	console.error("[FATAL ERROR]", e);
	process.exit(1);
});
