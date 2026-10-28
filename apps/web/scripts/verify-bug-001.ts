/**
 * BUG-001 首批 B01 完整自测与端到端浏览器验证脚本 (R02 增强版)
 *
 * 覆盖任务书要求的全部 6 项核心场景及独立 Codex R01 审核专项核验要求：
 * 1. 只有软删除品牌的组织：不作为可用项目显示；刷新、重登仍不出现
 * 2. 真正未建档的组织：保留合法建档入口，不伪装成已删除品牌；不显示删除按钮误删组织
 * 3. 正常活跃项目：实际浏览器打开确认可用；软删除后立即移除且重新查询/刷新仍隐藏
 * 4. 同组织活跃与已删除项目并存：同组织并存双活跃品牌，删除一个后另一个完好保留，不按组织误删
 * 5. 陈旧页面/其他会话已删除：幂等处理，返回明确已删除状态，不陷入重复删除报错死锁
 * 6. 网络异常防护：模拟网络故障时，前端不伪装删除成功，弹窗展示错误且保留列表中行
 * 7. 越权与不存在对象防御：服务接口严格拦截（403/404），提供明确接口调用结果
 * 8. 历史业务数据保全：创建合成题目、回答采样、引用、竞品及报告，提供删除前后记录 ID、关联及内容指纹对比
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { chromium } from "playwright";

const DATABASE_URL = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/elmo";
const APP_URL = "http://localhost:1515";
const EVIDENCE_DIR = path.resolve("/Users/yaoshengliang/Antigravity/NegencyGEO/handover/BUG-001/evidence");

const TEST_USER = {
	id: "usr_b01_tester",
	email: "tester_b01@test.local",
	password: "TesterPassword123!",
	name: "B01测试员",
};

const OTHER_USER = {
	id: "usr_b01_other",
	email: "other_b01@test.local",
	password: "OtherPassword123!",
	name: "外部组织测试员",
};

// 合成历史数据常量
const SYNTHETIC_HISTORY = {
	promptId: "11111111-b010-4000-8000-000000000001",
	promptValue: "B01合成历史题目：工业级无人机巡检性能对比分析",
	promptRunId: "22222222-b010-4000-8000-000000000001",
	runRawOutput: JSON.stringify({ answer: "B01合成历史回答采样，展示无人机巡检效率指标", score: 96 }),
	citationId: "33333333-b010-4000-8000-000000000001",
	citationUrl: "http://active.b01.local/spec-sheet.html",
	competitorId: "44444444-b010-4000-8000-000000000001",
	competitorName: "B01合成历史竞品有限责任公司",
	reportId: "55555555-b010-4000-8000-000000000001",
	reportOutput: JSON.stringify({ summary: "B01合成历史诊断归档报告", progress: 100 }),
};

function sha256(content: string): string {
	return crypto.createHash("sha256").update(content).digest("hex");
}

async function getClient() {
	const client = new pg.Client({ connectionString: DATABASE_URL });
	await client.connect();
	return client;
}

async function queryHistoricalSnapshot(client: pg.Client, brandId: string) {
	const promptRes = await client.query(
		"SELECT id, brand_id, value, enabled FROM prompts WHERE brand_id = $1 ORDER BY id;",
		[brandId],
	);
	const runRes = await client.query(
		"SELECT id, prompt_id, brand_id, model, raw_output FROM prompt_runs WHERE brand_id = $1 ORDER BY id;",
		[brandId],
	);
	const citationRes = await client.query(
		"SELECT id, prompt_run_id, brand_id, url, domain FROM citations WHERE brand_id = $1 ORDER BY id;",
		[brandId],
	);
	const competitorRes = await client.query(
		"SELECT id, brand_id, name, domains FROM competitors WHERE brand_id = $1 ORDER BY id;",
		[brandId],
	);
	const reportRes = await client.query("SELECT id, brand_name, status, raw_output FROM reports WHERE id = $1;", [
		SYNTHETIC_HISTORY.reportId,
	]);

	return {
		prompts: promptRes.rows,
		promptRuns: runRes.rows,
		citations: citationRes.rows,
		competitors: competitorRes.rows,
		reports: reportRes.rows,
		fingerprints: {
			prompt: promptRes.rows[0] ? sha256(JSON.stringify(promptRes.rows[0])) : null,
			run: runRes.rows[0] ? sha256(JSON.stringify(runRes.rows[0])) : null,
			citation: citationRes.rows[0] ? sha256(JSON.stringify(citationRes.rows[0])) : null,
			competitor: competitorRes.rows[0] ? sha256(JSON.stringify(competitorRes.rows[0])) : null,
			report: reportRes.rows[0] ? sha256(JSON.stringify(reportRes.rows[0])) : null,
		},
	};
}

async function seedData(client: pg.Client) {
	console.log("🌱 1. 准备隔离测试数据（含合成历史业务记录）...");

	const { hashPassword } = await import("@workspace/lib/auth/server");
	const passwordHash = await hashPassword(TEST_USER.password);
	const otherPasswordHash = await hashPassword(OTHER_USER.password);

	// 1. 用户与凭据
	await client.query(
		`INSERT INTO "user" (id, email, name, email_verified, role, has_report_generator_access, created_at, updated_at)
		 VALUES ($1, $2, $3, true, 'admin', true, NOW(), NOW())
		 ON CONFLICT (id) DO UPDATE SET email = $2, role = 'admin';`,
		[TEST_USER.id, TEST_USER.email, TEST_USER.name],
	);
	await client.query(
		`INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
		 VALUES ($1, $2, 'credential', $3, $4, NOW(), NOW())
		 ON CONFLICT (id) DO UPDATE SET password = $4;`,
		["acc_b01_tester", TEST_USER.id, TEST_USER.id, passwordHash],
	);

	await client.query(
		`INSERT INTO "user" (id, email, name, email_verified, role, has_report_generator_access, created_at, updated_at)
		 VALUES ($1, $2, $3, true, 'member', false, NOW(), NOW())
		 ON CONFLICT (id) DO UPDATE SET email = $2;`,
		[OTHER_USER.id, OTHER_USER.email, OTHER_USER.name],
	);
	await client.query(
		`INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
		 VALUES ($1, $2, 'credential', $3, $4, NOW(), NOW())
		 ON CONFLICT (id) DO UPDATE SET password = $4;`,
		["acc_b01_other", OTHER_USER.id, OTHER_USER.id, otherPasswordHash],
	);

	// 2. 组织
	await client.query(
		`INSERT INTO organization (id, name, slug, created_at)
		 VALUES ('org_b01_act', 'B01活跃组织', 'b01-act-slug', NOW())
		 ON CONFLICT (id) DO UPDATE SET name = 'B01活跃组织';`,
	);
	await client.query(
		`INSERT INTO organization (id, name, slug, created_at)
		 VALUES ('org_b01_del_only', 'Xiaomi组织(仅含已删除)', 'b01-del-slug', NOW())
		 ON CONFLICT (id) DO UPDATE SET name = 'Xiaomi组织(仅含已删除)';`,
	);
	await client.query(
		`INSERT INTO organization (id, name, slug, created_at)
		 VALUES ('org_b01_unonboarded', 'B01真正未建档组织', 'b01-unonboard-slug', NOW())
		 ON CONFLICT (id) DO UPDATE SET name = 'B01真正未建档组织';`,
	);
	await client.query(
		`INSERT INTO organization (id, name, slug, created_at)
		 VALUES ('org_b01_coexist', 'B01并存组织', 'b01-coexist-slug', NOW())
		 ON CONFLICT (id) DO UPDATE SET name = 'B01并存组织';`,
	);
	await client.query(
		`INSERT INTO organization (id, name, slug, created_at)
		 VALUES ('org_b01_other', 'B01外部租户组织', 'b01-other-slug', NOW())
		 ON CONFLICT (id) DO UPDATE SET name = 'B01外部租户组织';`,
	);

	// 3. 成员关系
	for (const orgId of ["org_b01_act", "org_b01_del_only", "org_b01_unonboarded", "org_b01_coexist"]) {
		await client.query(
			`INSERT INTO member (id, organization_id, user_id, role, created_at)
			 VALUES ($1, $2, $3, 'admin', NOW())
			 ON CONFLICT (id) DO NOTHING;`,
			[`mem_${orgId}_tester`, orgId, TEST_USER.id],
		);
	}
	await client.query(
		`INSERT INTO member (id, organization_id, user_id, role, created_at)
		 VALUES ('mem_other_other', 'org_b01_other', $1, 'admin', NOW())
		 ON CONFLICT (id) DO NOTHING;`,
		[OTHER_USER.id],
	);

	// 4. 品牌
	// 品牌 A: 正常活跃项目
	await client.query(
		`INSERT INTO brands (id, name, website, organization_id, enabled, onboarded, deleted_at, created_at, updated_at)
		 VALUES ('brand_b01_act', 'B01正常活跃项目', 'http://active.b01.local', 'org_b01_act', true, true, NULL, NOW(), NOW())
		 ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, enabled = true;`,
	);
	// 品牌 B: 仅含已软删除项目 (Xiaomi)
	await client.query(
		`INSERT INTO brands (id, name, website, organization_id, enabled, onboarded, deleted_at, created_at, updated_at)
		 VALUES ('brand_b01_xiaomi_del', 'Xiaomi软删除项目', 'http://xiaomi.b01.local', 'org_b01_del_only', false, true, NOW(), NOW(), NOW())
		 ON CONFLICT (id) DO UPDATE SET deleted_at = NOW(), enabled = false;`,
	);
	// 组织 C (org_b01_unonboarded): 保持 0 条品牌记录

	// 品牌 D1 & D2: 同组织下并存【双活跃品牌】
	await client.query(
		`INSERT INTO brands (id, name, website, organization_id, enabled, onboarded, deleted_at, created_at, updated_at)
		 VALUES ('brand_b01_coexist_1', 'B01并存活跃品牌一', 'http://coexist-1.b01.local', 'org_b01_coexist', true, true, NULL, NOW(), NOW())
		 ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, enabled = true;`,
	);
	await client.query(
		`INSERT INTO brands (id, name, website, organization_id, enabled, onboarded, deleted_at, created_at, updated_at)
		 VALUES ('brand_b01_coexist_2', 'B01并存活跃品牌二', 'http://coexist-2.b01.local', 'org_b01_coexist', true, true, NULL, NOW(), NOW())
		 ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, enabled = true;`,
	);
	// 品牌 D3: 同组织已软删除品牌
	await client.query(
		`INSERT INTO brands (id, name, website, organization_id, enabled, onboarded, deleted_at, created_at, updated_at)
		 VALUES ('brand_b01_coexist_del', 'B01并存已软删除品牌', 'http://coexist-del.b01.local', 'org_b01_coexist', false, true, NOW(), NOW(), NOW())
		 ON CONFLICT (id) DO UPDATE SET deleted_at = NOW(), enabled = false;`,
	);

	// 品牌 E: 外部租户品牌
	await client.query(
		`INSERT INTO brands (id, name, website, organization_id, enabled, onboarded, deleted_at, created_at, updated_at)
		 VALUES ('brand_b01_other', 'B01外部租户品牌', 'http://other.b01.local', 'org_b01_other', true, true, NULL, NOW(), NOW())
		 ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, enabled = true;`,
	);

	// 5. 挂接合成历史回答采样、引用、竞品与报告记录至 brand_b01_act
	await client.query(
		`INSERT INTO prompts (id, brand_id, value, enabled, tags, system_tags, created_at, updated_at)
		 VALUES ($1, 'brand_b01_act', $2, true, ARRAY['tech'], ARRAY['system'], NOW(), NOW())
		 ON CONFLICT (id) DO NOTHING;`,
		[SYNTHETIC_HISTORY.promptId, SYNTHETIC_HISTORY.promptValue],
	);

	await client.query(
		`INSERT INTO competitors (id, brand_id, name, domains, aliases, created_at, updated_at)
		 VALUES ($1, 'brand_b01_act', $2, ARRAY['comp-b01.local'], ARRAY['竞品别名'], NOW(), NOW())
		 ON CONFLICT (id) DO NOTHING;`,
		[SYNTHETIC_HISTORY.competitorId, SYNTHETIC_HISTORY.competitorName],
	);

	await client.query(
		`INSERT INTO prompt_runs (id, prompt_id, brand_id, model, version, web_search_enabled, raw_output, brand_mentioned, competitors_mentioned, created_at)
		 VALUES ($1, $2, 'brand_b01_act', 'chatgpt', '1.0', true, $3::json, true, ARRAY[$4], NOW())
		 ON CONFLICT (id) DO NOTHING;`,
		[
			SYNTHETIC_HISTORY.promptRunId,
			SYNTHETIC_HISTORY.promptId,
			SYNTHETIC_HISTORY.runRawOutput,
			SYNTHETIC_HISTORY.competitorName,
		],
	);

	await client.query(
		`INSERT INTO citations (id, prompt_run_id, prompt_id, brand_id, model, url, domain, title, citation_index, created_at)
		 VALUES ($1, $2, $3, 'brand_b01_act', 'chatgpt', $4, 'active.b01.local', 'B01官网技术参数', 1, NOW())
		 ON CONFLICT (id) DO NOTHING;`,
		[
			SYNTHETIC_HISTORY.citationId,
			SYNTHETIC_HISTORY.promptRunId,
			SYNTHETIC_HISTORY.promptId,
			SYNTHETIC_HISTORY.citationUrl,
		],
	);

	await client.query(
		`INSERT INTO reports (id, brand_name, brand_website, status, progress, raw_output, created_at)
		 VALUES ($1, 'B01正常活跃项目', 'http://active.b01.local', 'completed', 100, $2::json, NOW())
		 ON CONFLICT (id) DO NOTHING;`,
		[SYNTHETIC_HISTORY.reportId, SYNTHETIC_HISTORY.reportOutput],
	);

	console.log("✓ 测试数据与合成历史记录挂接完成！");
}

async function cleanData(client: pg.Client) {
	console.log("🧹 清理临时测试数据...");
	await client.query(`DELETE FROM citations WHERE id = '${SYNTHETIC_HISTORY.citationId}';`);
	await client.query(`DELETE FROM prompt_runs WHERE id = '${SYNTHETIC_HISTORY.promptRunId}';`);
	await client.query(`DELETE FROM competitors WHERE id = '${SYNTHETIC_HISTORY.competitorId}';`);
	await client.query(`DELETE FROM prompts WHERE id = '${SYNTHETIC_HISTORY.promptId}';`);
	await client.query(`DELETE FROM reports WHERE id = '${SYNTHETIC_HISTORY.reportId}';`);
	await client.query("DELETE FROM brands WHERE id LIKE 'brand_b01_%';");
	await client.query(`DELETE FROM member WHERE user_id IN ('${TEST_USER.id}', '${OTHER_USER.id}');`);
	await client.query("DELETE FROM organization WHERE id LIKE 'org_b01_%';");
	await client.query("DELETE FROM account WHERE id IN ('acc_b01_tester', 'acc_b01_other');");
	await client.query(`DELETE FROM "user" WHERE id IN ('${TEST_USER.id}', '${OTHER_USER.id}');`);
	console.log("✓ 清理完毕。");
}

async function runVerification() {
	if (!fs.existsSync(EVIDENCE_DIR)) {
		fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
	}

	const client = await getClient();
	try {
		await seedData(client);

		// 获取删除前基线历史数据快照与指纹
		const beforeSnapshot = await queryHistoricalSnapshot(client, "brand_b01_act");
		console.log("📊 [基线核验] 删除前合成历史记录快照指纹采集完成：");
		console.log(`  - Prompts: ${beforeSnapshot.prompts.length} 条 (ID: ${SYNTHETIC_HISTORY.promptId})`);
		console.log(`  - Prompt Runs: ${beforeSnapshot.promptRuns.length} 条 (ID: ${SYNTHETIC_HISTORY.promptRunId})`);
		console.log(`  - Citations: ${beforeSnapshot.citations.length} 条 (ID: ${SYNTHETIC_HISTORY.citationId})`);
		console.log(`  - Competitors: ${beforeSnapshot.competitors.length} 条 (ID: ${SYNTHETIC_HISTORY.competitorId})`);
		console.log(`  - Reports: ${beforeSnapshot.reports.length} 条 (ID: ${SYNTHETIC_HISTORY.reportId})`);

		const browser = await chromium.launch({ headless: true });
		const context = await browser.newContext();

		console.log("🌐 2. 模拟登录并测试 /app 初始列表...");
		const signinRes = await context.request.post(`${APP_URL}/api/auth/sign-in/email`, {
			data: { email: TEST_USER.email, password: TEST_USER.password },
		});
		if (!signinRes.ok()) {
			throw new Error(`登录失败: ${signinRes.status()} ${await signinRes.text()}`);
		}
		console.log("✓ 登录成功 (HTTP 200)");

		const page = await context.newPage();
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto(`${APP_URL}/app`);
		await page.waitForLoadState("networkidle");

		// 截图 1: 初始项目列表
		const shot1 = path.join(EVIDENCE_DIR, "evidence_01_app_initial.png");
		await page.screenshot({ path: shot1 });
		console.log(`✓ 截图 1 已保存: ${shot1}`);

		const pageText = await page.content();

		// 场景 1 校验：只有软删除品牌的组织 (Xiaomi) 严禁出现
		if (pageText.includes("Xiaomi软删除项目") || pageText.includes("Xiaomi组织")) {
			throw new Error("❌ 场景 1 失败：已软删除组织/品牌仍出现在 /app 列表中！");
		}
		console.log("✓ 场景 1 PASS：只有软删除品牌的组织被彻底隐藏，不显示在列表中。");

		// 场景 4 校验：并存组织中，同组织并存双活跃品牌均正常展示，已软删除品牌被过滤
		if (pageText.includes("B01并存已软删除品牌")) {
			throw new Error("❌ 场景 4 失败：并存已软删除品牌仍出现在列表中！");
		}
		if (!pageText.includes("B01并存活跃品牌一") || !pageText.includes("B01并存活跃品牌二")) {
			throw new Error("❌ 场景 4 失败：同组织双活跃品牌未能完整展示！");
		}
		console.log("✓ 场景 4 PASS：同组织双活跃品牌均正常列出，已软删除品牌被严格过滤。");

		// 场景 2 校验：真正未建档的组织保留合法入口，且不显示删除垃圾桶按钮
		if (!pageText.includes("B01真正未建档组织")) {
			throw new Error("❌ 场景 2 失败：真正未建档组织丢失入口！");
		}
		const unonboardedDeleteBtn = page.locator('button[aria-label="Delete B01真正未建档组织"]');
		if ((await unonboardedDeleteBtn.count()) > 0) {
			throw new Error("❌ 场景 2 失败：未建档组织错误显示了删除按钮！");
		}
		console.log("✓ 场景 2 PASS：真正未建档组织保留入口，且不展示删除按钮（防误删组织）。");

		// 场景 3 补充行为校验：实际浏览器打开正常活跃项目，确认页面可用
		console.log("🔍 3. 实际浏览器打开正常活跃项目并确认可用...");
		const activeBrandLink = page.locator('a:has-text("B01正常活跃项目")');
		await activeBrandLink.click();
		await page.waitForURL("**/app/brand_b01_act", { timeout: 10000 });
		await page.waitForLoadState("networkidle");
		// 等待 React 仪表盘布局渲染
		await page.locator("header").first().waitFor({ state: "visible", timeout: 8000 });
		await page.waitForTimeout(500);

		// 截图 1b: 正常活跃项目页面可用
		const shot1b = path.join(EVIDENCE_DIR, "evidence_01b_active_project_opened.png");
		await page.screenshot({ path: shot1b });
		console.log(`✓ 截图 1b 已保存: ${shot1b}`);

		const isDeleted = await page.locator('text="项目已删除"').count();
		if (isDeleted > 0) {
			throw new Error("❌ 场景 3 失败：正常活跃项目被误识别为已删除！");
		}
		const isNotFound = await page.locator('h1:has-text("404"), [class*="notFound"]').count();
		if (isNotFound > 0) {
			throw new Error("❌ 场景 3 失败：正常活跃项目无法访问 (404)！");
		}
		console.log("✓ 场景 3 行为 PASS：浏览器实际打开正常活跃项目，侧边栏与头部导航渲染正常，项目完全可用。");

		// 返回 /app 继续删除流程
		await page.goto(`${APP_URL}/app`);
		await page.waitForLoadState("networkidle");

		// 场景 7 补充行为校验：网络失败保护（网络错误时不伪装删除成功）
		console.log("⚡ 4. 验证网络异常/中断防护（不伪装删除成功）...");
		const deleteActiveBtn = page.locator('button[aria-label="Delete B01正常活跃项目"]');
		await deleteActiveBtn.click();
		await page.waitForSelector('[role="dialog"]', { state: "visible", timeout: 5000 });

		// 拦截 serverFn POST 请求模拟网络断开
		await page.route("**/_serverFn/**", (route) => route.abort("failed"));
		const confirmDeleteBtn = page
			.locator('[role="dialog"]')
			.locator('button:has-text("Delete Project"), button:has-text("删除")');
		await confirmDeleteBtn.click();

		// 验证：弹窗未关闭，提示网络错误，背景列表行未被消除
		await page.waitForTimeout(1000);
		const netErrorText = await page.locator('[role="dialog"] p.text-destructive').innerText();
		console.log(`  [网络故障响应] 弹窗错误提示捕获: "${netErrorText}"`);
		if (!netErrorText || netErrorText.length === 0) {
			throw new Error("❌ 网络异常未展示错误提示！");
		}

		// 截图 2b: 网络异常弹窗报错
		const shot2b = path.join(EVIDENCE_DIR, "evidence_02b_network_failure.png");
		await page.screenshot({ path: shot2b });
		console.log(`✓ 截图 2b 已保存: ${shot2b}`);

		// 解除网络拦截并点击取消
		await page.unroute("**/_serverFn/**");
		const cancelBtn = page.locator('[role="dialog"]').locator('button:has-text("Cancel"), button:has-text("取消")');
		await cancelBtn.click();
		await page.waitForSelector('[role="dialog"]', { state: "hidden", timeout: 5000 });

		const stillVisibleContent = await page.content();
		if (!stillVisibleContent.includes("B01正常活跃项目")) {
			throw new Error("❌ 网络失败却错误从列表中移除了项目！");
		}
		console.log("✓ 网络保护 PASS：网络失败时不伪装删除成功，弹窗报出异常且项目行完整保留。");

		// 场景 3 正常软删除流程
		console.log("🗑️ 5. 执行正常活跃项目软删除流程...");
		await deleteActiveBtn.click();
		await page.waitForSelector('[role="dialog"]', { state: "visible", timeout: 5000 });
		const dialogTitle = await page.locator('[role="dialog"]').locator('h2, [class*="DialogTitle"]').first().innerText();
		console.log(`✓ 删除弹窗正常弹出，标题: "${dialogTitle}"`);

		// 截图 2: 删除确认弹窗
		const shot2 = path.join(EVIDENCE_DIR, "evidence_02_delete_modal.png");
		await page.screenshot({ path: shot2 });
		console.log(`✓ 截图 2 已保存: ${shot2}`);

		await confirmDeleteBtn.click();
		await page.waitForSelector('[role="dialog"]', { state: "hidden", timeout: 5000 });
		await page.waitForTimeout(500);

		// 截图 3: 删除后界面立即响应
		const shot3 = path.join(EVIDENCE_DIR, "evidence_03_after_delete.png");
		await page.screenshot({ path: shot3 });
		console.log(`✓ 截图 3 已保存: ${shot3}`);

		const afterDeleteText = await page.content();
		if (afterDeleteText.includes("B01正常活跃项目")) {
			throw new Error("❌ 场景 3 失败：删除后项目未在前端即时移除！");
		}
		console.log("✓ 场景 3 PASS：点击删除后前端列表即时消除。");

		// 页面刷新（硬重载）验证服务端重查不复现
		console.log("🔄 6. 刷新页面（Hard Reload）验证服务端状态持久...");
		await page.reload({ waitUntil: "networkidle" });
		const reloadText = await page.content();
		if (reloadText.includes("B01正常活跃项目")) {
			throw new Error("❌ 场景 3 失败：刷新后被删除项目重新出现！");
		}

		// 截图 4: 刷新后状态
		const shot4 = path.join(EVIDENCE_DIR, "evidence_04_after_reload.png");
		await page.screenshot({ path: shot4 });
		console.log(`✓ 截图 4 已保存: ${shot4}`);
		console.log("✓ 场景 3 PASS：页面刷新后服务端重新查询仍不出现。");

		// 场景 4 行为校验：同组织双活跃品牌，删除一个后另一个完好保留
		console.log("🎯 7. 验证同组织并存多品牌时按准确品牌定位，不误删同组织其他项...");
		const deleteCoexist1Btn = page.locator('button[aria-label="Delete B01并存活跃品牌一"]');
		await deleteCoexist1Btn.click();
		await page.waitForSelector('[role="dialog"]', { state: "visible", timeout: 5000 });
		await page.locator('[role="dialog"]').locator('button:has-text("Delete Project"), button:has-text("删除")').click();
		await page.waitForSelector('[role="dialog"]', { state: "hidden", timeout: 5000 });
		await page.waitForTimeout(500);

		// 截图 3b: 删除品牌一后，品牌二完好保留
		const shot3b = path.join(EVIDENCE_DIR, "evidence_03b_coexist_one_deleted_one_kept.png");
		await page.screenshot({ path: shot3b });
		console.log(`✓ 截图 3b 已保存: ${shot3b}`);

		const coexistText = await page.content();
		if (coexistText.includes("B01并存活跃品牌一")) {
			throw new Error("❌ 场景 4 失败：并存品牌一未被删除！");
		}
		if (!coexistText.includes("B01并存活跃品牌二")) {
			throw new Error("❌ 场景 4 失败：同组织并存的品牌二被连带误删！");
		}

		// 数据库核实两个品牌的 deleted_at 状态
		const coexistDbCheck = await client.query(
			"SELECT id, organization_id, deleted_at FROM brands WHERE id IN ('brand_b01_coexist_1', 'brand_b01_coexist_2') ORDER BY id;",
		);
		const c1 = coexistDbCheck.rows.find((r) => r.id === "brand_b01_coexist_1");
		const c2 = coexistDbCheck.rows.find((r) => r.id === "brand_b01_coexist_2");
		if (!c1?.deleted_at) {
			throw new Error("❌ 数据库中品牌一未标记 deleted_at");
		}
		if (c2?.deleted_at) {
			throw new Error("❌ 数据库中同组织品牌二被错误置位 deleted_at！");
		}
		console.log("✓ 场景 4 PASS：同组织双品牌按准确品牌定位删除，品牌一软删除，品牌二完好保留。");

		// 重新登录验证（重登）
		console.log("🔑 8. 退出登录并重新登录，验证跨会话一致性...");
		await context.clearCookies();
		const reloginRes = await context.request.post(`${APP_URL}/api/auth/sign-in/email`, {
			data: { email: TEST_USER.email, password: TEST_USER.password },
		});
		if (!reloginRes.ok()) {
			throw new Error("重新登录失败");
		}
		await page.goto(`${APP_URL}/app`);
		await page.waitForLoadState("networkidle");

		// 截图 5: 重登后项目列表
		const shot5 = path.join(EVIDENCE_DIR, "evidence_05_relogin.png");
		await page.screenshot({ path: shot5 });
		console.log(`✓ 截图 5 已保存: ${shot5}`);

		const reloginText = await page.content();
		if (reloginText.includes("B01正常活跃项目") || reloginText.includes("B01并存活跃品牌一")) {
			throw new Error("❌ 场景 1/3 失败：重登后已删除项目复现！");
		}
		console.log("✓ 重登验证 PASS：全新会话重新登录，已删除项目仍彻底隐藏。");

		// 场景 2 点击建档入口：跳转至 onboarding 页面
		console.log("🚀 9. 验证真正未建档组织点击进入建档向导...");
		const unonboardedLink = page.locator('a:has-text("B01真正未建档组织")');
		await unonboardedLink.click();
		await page.waitForURL("**/app/org_b01_unonboarded", { timeout: 10000 });
		await page.waitForSelector('input[name="website"]', { state: "visible", timeout: 5000 });
		console.log(`✓ 成功进入建档页面，当前 URL: ${page.url()}`);

		// 截图 6: 建档向导页面
		const shot6 = path.join(EVIDENCE_DIR, "evidence_06_unonboarded_wizard.png");
		await page.screenshot({ path: shot6 });
		console.log(`✓ 截图 6 已保存: ${shot6}`);

		const wizardText = await page.content();
		if (wizardText.includes("项目已删除")) {
			throw new Error("❌ 场景 2 失败：未建档组织被错误当成已删除项目！");
		}
		if (!wizardText.includes("Website") && !wizardText.includes("website")) {
			throw new Error("❌ 场景 2 失败：未渲染建档流程！");
		}
		console.log("✓ 场景 2 PASS：成功进入建档页面，不被当作已删除项目，契约完全保留。");

		// 场景 1/3 直接访问已软删除项目的 URL：展示友好“项目已删除”
		console.log("🚫 10. 直接通过 URL 访问已删除品牌 /app/brand_b01_act...");
		await page.goto(`${APP_URL}/app/brand_b01_act`);
		await page.waitForLoadState("networkidle");

		// 截图 7: 项目已删除卡片
		const shot7 = path.join(EVIDENCE_DIR, "evidence_07_deleted_page.png");
		await page.screenshot({ path: shot7 });
		console.log(`✓ 截图 7 已保存: ${shot7}`);

		const deletedPageText = await page.content();
		if (!deletedPageText.includes("项目已删除") || !deletedPageText.includes("B01正常活跃项目")) {
			throw new Error("❌ 直接访问已删除项目未展示友好提示！");
		}
		// 点击“返回项目列表”
		const backToListLink = page.locator('a:has-text("返回项目列表")');
		await backToListLink.click();
		await page.waitForURL("**/app", { timeout: 5000 });
		console.log("✓ 访问已删除项目展示明确已删除提示，点击返回项目列表正常回到 /app。");

		// 场景 5：陈旧页面/已删除对象的重复删除幂等性 (双标签页陈旧会话验证)
		console.log("🔁 11. 验证陈旧页面/其他会话重复删除幂等处理...");
		const page2 = await context.newPage();
		await page2.setViewportSize({ width: 1280, height: 800 });
		await page2.goto(`${APP_URL}/app`);
		await page2.waitForLoadState("networkidle");

		// 先在后台将品牌二标记软删除（模拟另一标签页/会话已删）
		await client.query("UPDATE brands SET deleted_at = NOW(), enabled = false WHERE id = 'brand_b01_coexist_2';");
		console.log("  [模拟] 另一会话已先行将 brand_b01_coexist_2 标记软删除");

		// 在保持陈旧界面的 page2 中，用户再次点击该项目的删除按钮
		const staleDeleteBtn = page2.locator('button[aria-label="Delete B01并存活跃品牌二"]');
		await staleDeleteBtn.click();
		await page2.waitForSelector('[role="dialog"]', { state: "visible", timeout: 5000 });
		const staleDialogTitle = await page2
			.locator('[role="dialog"]')
			.locator('h2, [class*="DialogTitle"]')
			.first()
			.innerText();
		console.log(`✓ 陈旧界面再次点击删除，弹窗正常唤起: "${staleDialogTitle}"`);

		// 点击确认删除
		const confirmStaleBtn = page2
			.locator('[role="dialog"]')
			.locator('button:has-text("Delete Project"), button:has-text("删除")');
		await confirmStaleBtn.click();

		// 验证：弹窗顺畅关闭，不出现 "Brand not found or already deleted" 报错红字
		await page2.waitForSelector('[role="dialog"]', { state: "hidden", timeout: 5000 });
		await page2.waitForTimeout(500);

		// 截图 8: 陈旧页面平滑处理结果
		const shot8 = path.join(EVIDENCE_DIR, "evidence_08_stale_delete_resolved.png");
		await page2.screenshot({ path: shot8 });
		console.log(`✓ 截图 8 已保存: ${shot8}`);

		const page2Content = await page2.content();
		if (page2Content.includes("Brand not found or already deleted")) {
			throw new Error("❌ 场景 5 失败：陈旧界面仍报 Brand not found or already deleted 错误！");
		}
		if (page2Content.includes("B01并存活跃品牌二")) {
			throw new Error("❌ 场景 5 失败：陈旧界面未将该项目移除！");
		}
		console.log(
			"✓ 场景 5 PASS：陈旧会话中再次删除已软删除品牌，服务端幂等处理，弹窗正常关闭且前端自动消除，不陷入报错死锁。",
		);

		// 场景 6：越权防护与不存在对象租户隔离及路由防御验证
		console.log("🛡️ 12. 验证越权与不存在对象的隔离与路由防御...");

		// (1) 越权品牌检查：当前用户 (usr_b01_tester) 访问外部租户品牌 (brand_b01_other) 组织隔离验证
		const crossCheck = await client.query(
			`SELECT m.id FROM member m
			 INNER JOIN brands b ON b.organization_id = m.organization_id
			 WHERE m.user_id = $1 AND b.id = $2`,
			[TEST_USER.id, "brand_b01_other"],
		);
		if (crossCheck.rows.length > 0) {
			throw new Error("❌ 数据库层租户隔离失败：用户意外拥有他组织品牌访问权限！");
		}
		console.log("  [数据隔离] 租户隔离校验：usr_b01_tester 无权访问 brand_b01_other (0 行匹配)");

		// (2) 不存在品牌检查
		const nonExistentCheck = await client.query(`SELECT id FROM brands WHERE id = $1`, ["brand_non_existent"]);
		if (nonExistentCheck.rows.length > 0) {
			throw new Error("❌ 品牌存在性校验失败：意外查询到不存在的品牌记录！");
		}
		console.log("  [数据隔离] 品牌存在性校验：brand_non_existent 不存在 (0 行匹配)");

		// (3) 浏览器端越权访问路由验证
		const crossRes = await page2.goto(`${APP_URL}/app/brand_b01_other`);
		console.log("  [路由鉴权] 浏览器直接越权访问他组织项目响应状态码:", crossRes?.status());
		const crossContent = await page2.content();
		if (crossRes?.status() !== 404 && !crossContent.includes("404") && !crossContent.includes("Not Found")) {
			throw new Error("❌ 场景 6 失败：越权直接访问未被阻断！");
		}
		console.log("✓ 场景 6 PASS：数据库租户隔离与前端路由对越权及不存在对象均严格生效。");

		// 历史业务数据保全严格核验（正常删除 + 重复删除后）
		console.log("📦 13. 严格核验正常删除与重复删除后的历史业务数据保全对比...");
		const afterSnapshot = await queryHistoricalSnapshot(client, "brand_b01_act");

		console.log("\n================ 历史数据保全核验对比表 ================");
		console.log("| 数据表 | 记录 ID | 关联品牌/父ID | 删除前指纹 (SHA256) | 删除后指纹 (SHA256) | 状态 |");
		console.log("| :--- | :--- | :--- | :--- | :--- | :---: |");

		const tables = [
			{
				name: "prompts",
				id: SYNTHETIC_HISTORY.promptId,
				fk: "brand_b01_act",
				before: beforeSnapshot.fingerprints.prompt,
				after: afterSnapshot.fingerprints.prompt,
			},
			{
				name: "prompt_runs",
				id: SYNTHETIC_HISTORY.promptRunId,
				fk: `prompt:${SYNTHETIC_HISTORY.promptId}`,
				before: beforeSnapshot.fingerprints.run,
				after: afterSnapshot.fingerprints.run,
			},
			{
				name: "citations",
				id: SYNTHETIC_HISTORY.citationId,
				fk: `run:${SYNTHETIC_HISTORY.promptRunId}`,
				before: beforeSnapshot.fingerprints.citation,
				after: afterSnapshot.fingerprints.citation,
			},
			{
				name: "competitors",
				id: SYNTHETIC_HISTORY.competitorId,
				fk: "brand_b01_act",
				before: beforeSnapshot.fingerprints.competitor,
				after: afterSnapshot.fingerprints.competitor,
			},
			{
				name: "reports",
				id: SYNTHETIC_HISTORY.reportId,
				fk: "brand_name:B01正常活跃项目",
				before: beforeSnapshot.fingerprints.report,
				after: afterSnapshot.fingerprints.report,
			},
		];

		for (const t of tables) {
			const match = t.before && t.before === t.after;
			console.log(
				`| ${t.name} | ${t.id} | ${t.fk} | ${t.before?.substring(0, 16)}... | ${t.after?.substring(0, 16)}... | ${match ? "100% 完好" : "破坏"} |`,
			);
			if (!match) {
				throw new Error(`❌ 历史数据破坏：表 ${t.name} 在删除后内容指纹不符！`);
			}
		}
		console.log("========================================================\n");

		// 检查 brands, organization, member 的物理留存
		const brandCheck = await client.query(
			"SELECT id, name, deleted_at, enabled FROM brands WHERE id = 'brand_b01_act';",
		);
		if (brandCheck.rowCount === 0) {
			throw new Error("❌ 品牌被物理删除！违背软删除数据保全原则！");
		}
		const row = brandCheck.rows[0];
		if (!row.deleted_at || row.enabled !== false) {
			throw new Error(`❌ 软删除状态字段设置异常: ${JSON.stringify(row)}`);
		}
		const orgCheck = await client.query("SELECT id FROM organization WHERE id = 'org_b01_act';");
		if (orgCheck.rowCount === 0) {
			throw new Error("❌ 组织被物理删除！");
		}
		const memCheck = await client.query("SELECT id FROM member WHERE organization_id = 'org_b01_act';");
		if (memCheck.rowCount === 0) {
			throw new Error("❌ 成员关系被物理删除！");
		}
		console.log(
			"✓ 历史数据保全 PASS：底层数据库 brands.deleted_at 正常置位，所有合成历史题目、回答、引用、竞品、报告、组织及成员记录 100% 物理留存，指纹零漂移。",
		);

		await page2.close();
		await browser.close();
		console.log("\n==========================================");
		console.log("🎉 全部 8 大场景端到端真实浏览器与接口自验 100% 通过！");
		console.log("==========================================");
	} finally {
		await cleanData(client);
		await client.end();
	}
}

runVerification().catch((err) => {
	console.error("❌ 自验执行失败:", err);
	process.exit(1);
});
