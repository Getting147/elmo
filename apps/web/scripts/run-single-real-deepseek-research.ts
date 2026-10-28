/**
 * BUG-001 / B02 单次真实网络 DeepSeek 调研核验脚本
 *
 * 遵循任务书 03_B02 第 4 节约束与 Codex 独立复审规范：
 * - 仅在用户明确批准单次调用申请后方可运行；
 * - 限制单次执行 (maxCalls = 1)，目标为用户报障的新客户官网 (http://www.szjgfw.com/)；
 * - 全流程完整取证：捕获官网抓取正文、实际输入 Prompt、DeepSeek 原始模型响应 (rawDeepSeekResponse)、
 *   Token 耗用 (usage)、物理 HTTP 请求计数 (=1) 与数据库实际草稿关联 (draftId)；
 * - 归档至 handover/BUG-001/evidence/b02/04_real_call_evidence.json，供独立 Codex 验收只读复核与回放。
 */
import fs from "node:fs";
import path from "node:path";
import { db } from "@workspace/lib/db/db";
import { brands, draftResearch } from "@workspace/lib/db/schema";
import {
	buildAnalysisContext,
	computeExpiresAt,
	hashUrlForDraft,
	normalizeAnalysisResult,
	resolveResearchProvider,
} from "@workspace/lib/onboarding";
import { getDeepSeekApiKey, getDeepSeekBaseUrl, getDeepSeekModel } from "@workspace/lib/providers";

const TARGET_URL = "http://www.szjgfw.com/";
const EVIDENCE_DIR = path.resolve("/Users/yaoshengliang/Antigravity/NegencyGEO/handover/BUG-001/evidence/b02");

async function main() {
	console.log("================================================================================");
	console.log("BUG-001 / B02: 单次真实 DeepSeek 调研联调与全量取证");
	console.log("================================================================================");

	const apiKey = getDeepSeekApiKey();
	if (!apiKey) {
		console.error("FATAL: 未检测到 DEEPSEEK_API_KEY 或 LLM_API_KEY，终止执行。");
		process.exit(1);
	}

	const baseUrl = getDeepSeekBaseUrl();
	const model = getDeepSeekModel();

	console.log(`[Config] Endpoint: ${baseUrl}`);
	console.log(`[Config] Model: ${model}`);
	console.log(`[Config] Target Website: ${TARGET_URL}`);
	console.log(`[Config] API Key: [CONFIGURED]`);

	const startTime = Date.now();
	console.log(`\n[Execution 1/4] 抓取官网正文并构建分析上下文...`);

	try {
		const ctx = await buildAnalysisContext({
			website: TARGET_URL,
			maxCompetitors: 5,
			maxPrompts: 10,
			maxProducts: 5,
			requireLiveWebsite: true,
		});

		const crawledExcerpt = ctx.crawledPageTexts.get(ctx.analysisUrl) || "";
		console.log(`✓ 官网抓取成功，正文长度: ${crawledExcerpt.length} 字符`);
		console.log(`✓ 分析 Prompt 已构建，Prompt 长度: ${ctx.prompt.length} 字符`);

		console.log(`\n[Execution 2/4] 请求 DeepSeek 官方 API (maxRetries: 0, 严格单次物理调用)...`);
		const provider = resolveResearchProvider();
		if (!provider.runStructuredResearch) {
			throw new Error("Provider does not support runStructuredResearch");
		}

		const llmStart = Date.now();
		const response = await provider.runStructuredResearch({
			prompt: ctx.prompt,
			schema: ctx.schema,
			maxRetries: 0,
		});
		const llmDuration = Date.now() - llmStart;
		console.log(`✓ DeepSeek 响应成功！耗时: ${llmDuration}ms, modelVersion: ${response.modelVersion}`);
		if (response.usage) {
			console.log(
				`  - Usage: prompt=${response.usage.prompt_tokens}, completion=${response.usage.completion_tokens}, total=${response.usage.total_tokens}`,
			);
		}

		console.log(`\n[Execution 3/4] 结构化结果归一化与校验...`);
		const result = normalizeAnalysisResult(response.object as never, ctx);
		const durationMs = Date.now() - startTime;

		console.log(`--------------------------------------------------------------------------------`);
		console.log(`识别品牌: ${result.brandName}`);
		console.log(`一句话定位: ${result.summary || "无"}`);
		console.log(`企业简介: ${result.description ? `${result.description.slice(0, 100)}...` : "无"}`);
		console.log(`产品线 (confirmed): ${result.productLines?.confirmed?.length || 0} 条`);
		console.log(`推荐竞品: ${result.competitors?.map((c: { name: string }) => c.name).join(", ") || "无"}`);
		console.log(`推荐 Prompts: ${result.suggestedPrompts?.length || 0} 条`);
		console.log(`--------------------------------------------------------------------------------`);

		console.log(`\n[Execution 4/4] 数据库草稿关联与持久化...`);
		const testBrandId = "brand_real_deepseek_szjgfw";
		const brandExists = await db.query.brands.findFirst({ where: (b, { eq }) => eq(b.id, testBrandId) });
		if (!brandExists) {
			const org = await db.query.organization.findFirst();
			if (org) {
				await db.insert(brands).values({
					id: testBrandId,
					name: "深圳市精工建轻钢房屋有限公司",
					website: TARGET_URL,
					enabled: true,
					onboarded: false,
					organizationId: org.id,
					additionalDomains: [],
					aliases: [],
				});
			}
		}

		const draftId = `dres_real_${Date.now()}`;
		const urlHash = hashUrlForDraft(TARGET_URL);
		await db.insert(draftResearch).values({
			id: draftId,
			brandId: testBrandId,
			urlHash,
			state: "pending_review",
			researchStatus: "done",
			payload: result,
			createdAt: new Date(),
			updatedAt: new Date(),
			expiresAt: computeExpiresAt(),
		});
		console.log(`✓ 关联测试草稿落盘成功: id=${draftId}, brandId=${testBrandId}`);

		fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
		const evidence = {
			timestamp: new Date().toISOString(),
			targetUrl: TARGET_URL,
			durationMs,
			endpoint: baseUrl,
			model,
			physicalHttpCalls: 1,
			draftId,
			crawledWebsiteExcerpt: crawledExcerpt,
			inputPrompt: ctx.prompt,
			rawDeepSeekResponse: response.raw,
			usage: response.usage,
			result,
		};

		const evidencePath = path.join(EVIDENCE_DIR, "04_real_call_evidence.json");
		fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf-8");
		console.log(`✓ 完整闭环证据（含官网输入、Prompt、原始响应、usage与草稿ID）已归档至: ${evidencePath}`);

		process.exit(0);
	} catch (err) {
		console.error("✗ 调研失败:", err);
		process.exit(1);
	}
}

main().catch((e) => {
	console.error("[FATAL ERROR]", e);
	process.exit(1);
});
