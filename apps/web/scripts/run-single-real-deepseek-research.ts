/**
 * BUG-001 / B02 单次真实网络 DeepSeek 调研核验脚本
 *
 * 遵循任务书 03_B02 第 4 节约束：
 * - 仅在用户明确批准单次调用申请后方可运行；
 * - 限制单次执行 (maxCalls = 1)，目标为用户报障的新客户官网 (http://www.szjgfw.com/)；
 * - 捕获脱敏抓取正文、DeepSeek 响应内容、Token 耗用与最终生成的草稿结构；
 * - 归档至 handover/BUG-001/evidence/b02/04_real_call_evidence.json，供独立 Codex 验收只读复核/回放。
 */
import fs from "node:fs";
import path from "node:path";
import { analyzeBrand } from "@workspace/lib/onboarding";
import { getDeepSeekApiKey, getDeepSeekBaseUrl, getDeepSeekModel } from "@workspace/lib/providers";

const TARGET_URL = "http://www.szjgfw.com/";
const EVIDENCE_DIR = path.resolve("/Users/yaoshengliang/Antigravity/NegencyGEO/handover/BUG-001/evidence/b02");

async function main() {
	console.log("================================================================================");
	console.log("BUG-001 / B02: 单次真实 DeepSeek 调研联调");
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
	console.log(`\n[Execution] 开始抓取官网与请求 DeepSeek 结构化分析...`);

	try {
		const result = await analyzeBrand({
			website: TARGET_URL,
			maxCompetitors: 5,
			maxPrompts: 10,
			maxProducts: 5,
		});

		const durationMs = Date.now() - startTime;
		console.log(`\n✓ 调研完成！耗时: ${durationMs}ms`);
		console.log(`--------------------------------------------------------------------------------`);
		console.log(`识别品牌: ${result.brandName}`);
		console.log(`一句话定位: ${result.summary || "无"}`);
		console.log(`企业简介: ${result.description ? `${result.description.slice(0, 100)}...` : "无"}`);
		console.log(`产品线 (confirmed): ${result.productLines?.confirmed?.length || 0} 条`);
		console.log(`推荐竞品: ${result.competitors?.map((c) => c.name).join(", ") || "无"}`);
		console.log(`推荐 Prompts: ${result.suggestedPrompts?.length || 0} 条`);
		if (result.suggestedPrompts && result.suggestedPrompts.length > 0) {
			console.log(
				`示例 Prompt: "${result.suggestedPrompts[0]?.prompt}" (tags: ${result.suggestedPrompts[0]?.tags.join(", ")})`,
			);
		}
		console.log(`--------------------------------------------------------------------------------`);

		fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
		const evidence = {
			timestamp: new Date().toISOString(),
			targetUrl: TARGET_URL,
			durationMs,
			endpoint: baseUrl,
			model,
			result,
		};

		const evidencePath = path.join(EVIDENCE_DIR, "04_real_call_evidence.json");
		fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf-8");
		console.log(`✓ 真实联调证据已归档至: ${evidencePath}`);

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
