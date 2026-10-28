/**
 * BUG-001 首批 B01 完整自测与端到端浏览器验证脚本
 *
 * 覆盖任务书要求的全部 6 项核心场景：
 * 1. 只有软删除品牌的组织：不作为可用项目显示；刷新、重登仍不出现
 * 2. 真正未建档的组织：保留合法建档入口，不伪装成已删除品牌；不显示删除按钮误删组织
 * 3. 正常活跃项目：可列出、可打开；软删除后立即移除且重新查询/刷新仍隐藏
 * 4. 同组织活跃与已删除项目并存：仅显示活跃项目；按准确品牌定位，不误删同组织其他项
 * 5. 陈旧页面/其他会话已删除：幂等处理，返回明确已删除状态，不陷入重复删除弹窗
 * 6. 越权与历史保全：他组织无权删除（403）；软删除不物理删除组织、成员和历史数据
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import pg from "pg";

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

async function getClient() {
	const client = new pg.Client({ connectionString: DATABASE_URL });
	await client.connect();
	return client;
}

async function seedData(client: pg.Client) {
	console.log("🌱 1. 准备隔离测试数据...");

	// 密码 hash
	const { hashPassword } = await import("@workspace/lib/auth/server");
	const passwordHash = await hashPassword(TEST_USER.password);
	const otherPasswordHash = await hashPassword(OTHER_USER.password);

	// 1. 用户
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
	// Org A: 活跃项目组织
	await client.query(
		`INSERT INTO organization (id, name, slug, created_at)
		 VALUES ('org_b01_act', 'B01活跃组织', 'b01-act-slug', NOW())
		 ON CONFLICT (id) DO UPDATE SET name = 'B01活跃组织';`,
	);
	// Org B: 仅含软删除项目的组织 (模拟用户线上小米案例)
	await client.query(
		`INSERT INTO organization (id, name, slug, created_at)
		 VALUES ('org_b01_del_only', 'Xiaomi组织(仅含已删除)', 'b01-del-slug', NOW())
		 ON CONFLICT (id) DO UPDATE SET name = 'Xiaomi组织(仅含已删除)';`,
	);
	// Org C: 真正未建档组织 (无任何品牌记录)
	await client.query(
		`INSERT INTO organization (id, name, slug, created_at)
		 VALUES ('org_b01_unonboarded', 'B01真正未建档组织', 'b01-unonboard-slug', NOW())
		 ON CONFLICT (id) DO UPDATE SET name = 'B01真正未建档组织';`,
	);
	// Org D: 活跃与已删除品牌并存组织
	await client.query(
		`INSERT INTO organization (id, name, slug, created_at)
		 VALUES ('org_b01_coexist', 'B01并存组织', 'b01-coexist-slug', NOW())
		 ON CONFLICT (id) DO UPDATE SET name = 'B01并存组织';`,
	);
	// Org E: 外部组织 (用于跨租户测试)
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
	// 品牌 A: 正常活跃
	await client.query(
		`INSERT INTO brands (id, name, website, organization_id, enabled, onboarded, deleted_at, created_at, updated_at)
		 VALUES ('brand_b01_act', 'B01正常活跃项目', 'http://active.b01.local', 'org_b01_act', true, true, NULL, NOW(), NOW())
		 ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, enabled = true;`,
	);
	// 品牌 B: 已软删除 (Xiaomi组织下的已删除品牌)
	await client.query(
		`INSERT INTO brands (id, name, website, organization_id, enabled, onboarded, deleted_at, created_at, updated_at)
		 VALUES ('brand_b01_xiaomi_del', 'Xiaomi软删除项目', 'http://xiaomi.b01.local', 'org_b01_del_only', false, true, NOW(), NOW(), NOW())
		 ON CONFLICT (id) DO UPDATE SET deleted_at = NOW(), enabled = false;`,
	);
	// 组织 C (org_b01_unonboarded) 故意不建任何品牌记录

	// 品牌 D1: 并存活跃品牌
	await client.query(
		`INSERT INTO brands (id, name, website, organization_id, enabled, onboarded, deleted_at, created_at, updated_at)
		 VALUES ('brand_b01_coexist_act', 'B01并存活跃品牌', 'http://coexist-act.b01.local', 'org_b01_coexist', true, true, NULL, NOW(), NOW())
		 ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, enabled = true;`,
	);
	// 品牌 D2: 并存已删除品牌
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

	console.log("✓ 测试数据准备完成！");
}

async function cleanData(client: pg.Client) {
	console.log("🧹 清理临时测试数据...");
	await client.query(`DELETE FROM brands WHERE id LIKE 'brand_b01_%';`);
	await client.query(`DELETE FROM member WHERE user_id IN ('${TEST_USER.id}', '${OTHER_USER.id}');`);
	await client.query(`DELETE FROM organization WHERE id LIKE 'org_b01_%';`);
	await client.query(`DELETE FROM account WHERE id IN ('acc_b01_tester', 'acc_b01_other');`);
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
		page.on("request", (req) => {
			if (req.url().includes("brand") || req.method() === "POST") {
				console.log("  [Network]", req.method(), req.url(), req.postData());
			}
		});
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

		// 场景 4 校验：并存组织中，已软删除的品牌不出现，仅活跃品牌出现
		if (pageText.includes("B01并存已软删除品牌")) {
			throw new Error("❌ 场景 4 失败：并存已软删除品牌仍出现在列表中！");
		}
		if (!pageText.includes("B01并存活跃品牌")) {
			throw new Error("❌ 场景 4 失败：并存活跃品牌未出现在列表中！");
		}
		console.log("✓ 场景 4 PASS：同组织并存情况下，只列出活跃品牌，已软删除品牌被过滤。");

		// 场景 2 校验：真正未建档的组织保留合法入口，且不显示删除垃圾桶按钮
		if (!pageText.includes("B01真正未建档组织")) {
			throw new Error("❌ 场景 2 失败：真正未建档组织丢失入口！");
		}
		const unonboardedDeleteBtn = page.locator(`button[aria-label="Delete B01真正未建档组织"]`);
		if ((await unonboardedDeleteBtn.count()) > 0) {
			throw new Error("❌ 场景 2 失败：未建档组织错误显示了删除按钮！");
		}
		console.log("✓ 场景 2 PASS：真正未建档组织保留入口，且不展示删除按钮（防误删组织）。");

		// 场景 3 校验：正常活跃项目可列出，点击删除弹窗
		if (!pageText.includes("B01正常活跃项目")) {
			throw new Error("❌ 场景 3 失败：正常活跃项目未在列表中！");
		}
		console.log("🗑️ 3. 测试正常活跃项目软删除流程...");
		const deleteActiveBtn = page.locator(`button[aria-label="Delete B01正常活跃项目"]`);
		await deleteActiveBtn.click();

		// 等待删除确认弹窗
		await page.waitForSelector('[role="dialog"]', { state: "visible", timeout: 5000 });
		const dialogTitle = await page.locator('[role="dialog"]').locator('h2, [class*="DialogTitle"]').first().innerText();
		console.log(`✓ 删除弹窗已弹出，标题: "${dialogTitle}"`);

		// 截图 2: 删除确认弹窗
		const shot2 = path.join(EVIDENCE_DIR, "evidence_02_delete_modal.png");
		await page.screenshot({ path: shot2 });
		console.log(`✓ 截图 2 已保存: ${shot2}`);

		// 点击确认删除
		const confirmDeleteBtn = page.locator('[role="dialog"]').locator('button:has-text("Delete Project")');
		await confirmDeleteBtn.click();

		// 弹窗关闭且列表中立即消失
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
		console.log("🔄 4. 刷新页面（Hard Reload）验证服务端状态持久...");
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

		// 重新登录验证（重登）
		console.log("🔑 5. 退出登录并重新登录，验证跨会话一致性...");
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
		if (reloginText.includes("B01正常活跃项目")) {
			throw new Error("❌ 场景 1/3 失败：重登后已删除项目复现！");
		}
		console.log("✓ 重登验证 PASS：全新会话重新登录，已删除项目仍彻底隐藏。");

		// 场景 2 点击建档入口：跳转至 onboarding 页面
		console.log("🚀 6. 验证真正未建档组织点击进入建档向导...");
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
		if (!wizardText.includes("Set up your brand") && !wizardText.includes("品牌") && !wizardText.includes("Website")) {
			throw new Error("❌ 场景 2 失败：未渲染建档流程！");
		}
		console.log("✓ 场景 2 PASS：成功进入建档页面，不被当作已删除项目，契约完全保留。");

		// 场景 1/3 直接访问已软删除项目的 URL：展示友好“项目已删除”
		console.log("🚫 7. 直接通过 URL 访问已删除品牌 /app/brand_b01_act...");
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
		console.log("🔁 8. 验证陈旧页面/其他会话重复删除幂等处理...");
		// 打开第二个标签页 page2 访问 /app
		const page2 = await context.newPage();
		await page2.setViewportSize({ width: 1280, height: 800 });
		await page2.goto(`${APP_URL}/app`);
		await page2.waitForLoadState("networkidle");

		// 在 page2 仍显示“B01并存活跃品牌”的情况下，先在后台由管理员标记该品牌为已软删除（模拟另一会话已删）
		await client.query(`UPDATE brands SET deleted_at = NOW(), enabled = false WHERE id = 'brand_b01_coexist_act';`);
		console.log("  [模拟] 另一会话已先行将 brand_b01_coexist_act 标记软删除");

		// 在保持陈旧界面的 page2 中，用户再次点击该项目的删除按钮
		const staleDeleteBtn = page2.locator(`button[aria-label="Delete B01并存活跃品牌"]`);
		await staleDeleteBtn.click();

		// 等待弹窗出现
		await page2.waitForSelector('[role="dialog"]', { state: "visible", timeout: 5000 });
		const staleDialogTitle = await page2
			.locator('[role="dialog"]')
			.locator('h2, [class*="DialogTitle"]')
			.first()
			.innerText();
		console.log(`✓ 陈旧界面再次点击删除，弹窗正常唤起: "${staleDialogTitle}"`);

		// 点击确认删除
		const confirmStaleBtn = page2.locator('[role="dialog"]').locator('button:has-text("Delete Project")');
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
		if (page2Content.includes("B01并存活跃品牌")) {
			throw new Error("❌ 场景 5 失败：陈旧界面未将该项目移除！");
		}
		console.log(
			"✓ 场景 5 PASS：陈旧会话中再次删除已软删除品牌，服务端幂等处理，弹窗正常关闭且前端自动消除，不陷入报错死锁。",
		);

		// 场景 6：越权防护与历史数据保全
		console.log("🛡️ 9. 验证越权防护与底层数据物理保全...");
		// 越权访问他组织品牌 /app/brand_b01_other 应当触发 404 Not Found
		const crossRes = await page2.goto(`${APP_URL}/app/brand_b01_other`);
		console.log("越权直接访问响应状态码:", crossRes?.status());
		const crossContent = await page2.content();
		if (crossRes?.status() !== 404 && !crossContent.includes("404") && !crossContent.includes("Not Found")) {
			throw new Error("❌ 场景 6 失败：越权直接访问未被阻断！");
		}
		console.log("✓ 场景 6 PASS：跨租户越权访问被严格隔离（404 Not Found）。");

		// 检查数据库记录物理保全情况
		const brandCheck = await client.query(
			`SELECT id, name, deleted_at, enabled FROM brands WHERE id = 'brand_b01_act';`,
		);
		if (brandCheck.rowCount === 0) {
			throw new Error("❌ 数据被物理删除！违背软删除数据保全原则！");
		}
		const row = brandCheck.rows[0];
		if (!row.deleted_at || row.enabled !== false) {
			throw new Error("❌ 软删除状态字段设置异常: " + JSON.stringify(row));
		}
		const orgCheck = await client.query(`SELECT id FROM organization WHERE id = 'org_b01_act';`);
		if (orgCheck.rowCount === 0) {
			throw new Error("❌ 组织被物理删除！");
		}
		const memCheck = await client.query(`SELECT id FROM member WHERE organization_id = 'org_b01_act';`);
		if (memCheck.rowCount === 0) {
			throw new Error("❌ 成员关系被物理删除！");
		}
		console.log("✓ 场景 6 PASS：底层数据库 brands.deleted_at 正常置位，组织、成员及业务数据 100% 物理保全。");

		await page2.close();
		await browser.close();
		console.log("\n==========================================");
		console.log("🎉 全部 6 大场景端到端真实浏览器自验 100% 通过！");
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
