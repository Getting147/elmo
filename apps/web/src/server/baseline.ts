/**
 * /server/baseline.ts — elmo 与 Python 豆包基线微服务 (REPORT-001D/E) 服务端适配层
 *
 * 职责与约束：
 * 1. 严格复用 elmo 会话鉴权 (requireAuthSession) 与组织/品牌权限 (requireOrgAccess)；
 * 2. 服务端从 brand 查 organization，严禁假定 brandId === organizationId；
 * 3. 内部通信携带 X-Service-Token 与受控租户头，浏览器绝不直连 Python 后端，不暴露内部 Token 或 Key；
 * 4. 仅作为安全代理，不重算分母，不修改 A 模块指标契约，不伪造审核结果。
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "@workspace/lib/db/db";
import { brands, competitors, prompts, organization } from "@workspace/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";

export const BASELINE_API_URL =
	process.env.BASELINE_API_URL || "http://127.0.0.1:8000";
export const BASELINE_SERVICE_TOKEN =
	process.env.BASELINE_SERVICE_TOKEN || "test-baseline-internal-token-secret-20261025";

/**
 * 辅助：根据 brandId 安全解析其 organizationId 与品牌记录
 */
export async function getBrandAndOrg(brandId: string) {
	const [brand] = await db
		.select()
		.from(brands)
		.where(and(eq(brands.id, brandId), isNull(brands.deletedAt)))
		.limit(1);

	if (!brand) {
		throw new Error(`未找到品牌档案或该品牌已被删除: ${brandId}`);
	}

	return {
		brand,
		organizationId: brand.organizationId,
	};
}

/**
 * 内部统一发起向 Python 后端的鉴权 HTTP 调用
 */
export async function callBaselineBackend<T = any>(args: {
	method: "GET" | "POST" | "PUT" | "DELETE";
	path: string;
	organizationId: string;
	brandId: string;
	callerId?: string;
	body?: any;
	adminToken?: string;
}): Promise<T> {
	const url = `${BASELINE_API_URL}${args.path}`;
	const headers: Record<string, string> = {
		"X-Service-Token": BASELINE_SERVICE_TOKEN,
		"X-Organization-Id": args.organizationId,
		"X-Brand-Id": args.brandId,
		"X-Caller-Id": args.callerId || "elmo-server",
		"Content-Type": "application/json",
	};

	if (args.adminToken) {
		headers["X-Admin-Token"] = args.adminToken;
	}

	const resp = await fetch(url, {
		method: args.method,
		headers,
		body: args.body ? JSON.stringify(args.body) : undefined,
	});

	if (!resp.ok) {
		let errJson: any = null;
		try {
			errJson = await resp.json();
		} catch {
			// fallback
		}
		const msg = errJson?.detail?.message || errJson?.message || `HTTP ${resp.status} ${resp.statusText}`;
		const err = new Error(msg);
		(err as any).statusCode = resp.status;
		(err as any).errorCategory = errJson?.detail?.error || errJson?.error;
		throw err;
	}

	return (await resp.json()) as T;
}

// ============================================================================
// 1. 获取当前品牌档案、多业务题集与基线输入摘要
// ============================================================================

export const getBrandBaselineProfileFn = createServerFn({ method: "GET" })
	.validator(z.object({ brandId: z.string() }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		await requireOrgAccess(session.user.id, organizationId);

		const compList = await db
			.select()
			.from(competitors)
			.where(eq(competitors.brandId, brand.id));

		const promptList = await db
			.select()
			.from(prompts)
			.where(and(eq(prompts.brandId, brand.id), eq(prompts.enabled, true)));

		const parsedPrompts = promptList.map((p, idx) => {
			const isProbe = p.systemTags?.includes("probe") || p.tags?.includes("probe") || p.tags?.includes("is_probe") || false;
			// 维度映射
			const dimTag = p.tags?.find((t) => t.startsWith("dim:"))?.replace(/^dim:/, "") || "基础业务维度";
			return {
				id: p.id,
				code: `P${String(idx + 1).padStart(2, "0")}`,
				text: p.value,
				keywordText: p.value.slice(0, 20),
				dimensionName: dimTag,
				isProbe,
			};
		});

		const formalCount = parsedPrompts.filter((p) => !p.isProbe).length;
		const probeCount = parsedPrompts.filter((p) => p.isProbe).length;

		return {
			brand: {
				id: brand.id,
				name: brand.name,
				website: brand.website,
				aliases: brand.aliases || [],
				organizationId,
			},
			competitors: compList.map((c) => ({
				id: c.id,
				name: c.name,
				website: c.domains?.[0] || "",
				aliases: c.aliases || [],
			})),
			prompts: parsedPrompts,
			summary: {
				totalPrompts: parsedPrompts.length,
				formalCount,
				probeCount,
			},
		};
	});

// ============================================================================
// 2. 冻结客户输入，生成确定性快照
// ============================================================================

export const freezeBaselineInputsFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string(),
			versionLabel: z.string().default("v1.0"),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		await requireOrgAccess(session.user.id, organizationId);

		const compList = await db
			.select()
			.from(competitors)
			.where(eq(competitors.brandId, brand.id));

		const promptList = await db
			.select()
			.from(prompts)
			.where(and(eq(prompts.brandId, brand.id), eq(prompts.enabled, true)));

		if (promptList.length === 0) {
			throw new Error("当前品牌无可用问题，请先在问题管理中录入至少一个问题");
		}

		const parsedPrompts = promptList.map((p, idx) => {
			const isProbe = p.systemTags?.includes("probe") || p.tags?.includes("probe") || p.tags?.includes("is_probe") || false;
			const dimTag = p.tags?.find((t) => t.startsWith("dim:"))?.replace(/^dim:/, "") || "核心业务板块";
			return {
				code: isProbe ? `PR${String(idx + 1).padStart(2, "0")}` : `P${String(idx + 1).padStart(2, "0")}`,
				text: p.value,
				keyword_text: p.value.slice(0, 20),
				dimension_name: dimTag,
				is_probe: isProbe,
			};
		});

		const domain = brand.website ? [brand.website.replace(/^https?:\/\//, "").replace(/\/.*$/, "")] : [];

		const freezePayload = {
			profile: {
				brand_id: brand.id,
				brand_name: brand.name,
				aliases: brand.aliases || [brand.name],
				domains: domain,
				disambiguation_keywords: [],
				industry_keywords: [],
				competitors: compList.map((c) => ({
					name: c.name,
					aliases: c.aliases || [],
					domains: c.domains || [],
				})),
			},
			questions: parsedPrompts,
			snapshot_meta: {
				snapshot_id: `snap_${brand.id.toLowerCase()}_${Date.now()}`,
				version_label: data.versionLabel,
				confirmed_by: (session.user as any).name || session.user.id,
				confirmed_at: new Date().toISOString().split("T")[0],
			},
		};

		return callBaselineBackend({
			method: "POST",
			path: "/api/baseline/v1/inputs/freeze",
			organizationId,
			brandId: brand.id,
			callerId: (session.user as any).name || session.user.id,
			body: freezePayload,
		});
	});

// ============================================================================
// 3. 手动创建单次有限诊断任务 (REPORT-001E)
// ============================================================================

export const createBaselineRunFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string(),
			snapshotId: z.string(),
			requestBudget: z.number().int().min(1).max(100).default(30),
			maxRetries: z.number().int().min(0).max(3).default(0),
			idempotencyKey: z.string().optional(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		await requireOrgAccess(session.user.id, organizationId);

		const runId = `run_${brand.id.toLowerCase()}_${Date.now()}`;
		const idempotencyKey = data.idempotencyKey || `idemp_${brand.id.toLowerCase()}_${data.snapshotId}`;

		const payload = {
			snapshot_id: data.snapshotId,
			mode: "synthetic", // REPORT-001E: 首期使用合成模式进行受控验证
			run_id: runId,
			idempotency_key: idempotencyKey,
			request_budget: data.requestBudget,
			max_retries: data.maxRetries,
		};

		return callBaselineBackend({
			method: "POST",
			path: "/api/baseline/v1/runs",
			organizationId,
			brandId: brand.id,
			callerId: (session.user as any).name || session.user.id,
			body: payload,
		});
	});

// ============================================================================
// 4. 查询任务详情与进度
// ============================================================================

export const getBaselineRunFn = createServerFn({ method: "GET" })
	.validator(z.object({ brandId: z.string(), runId: z.string() }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		await requireOrgAccess(session.user.id, organizationId);

		return callBaselineBackend({
			method: "GET",
			path: `/api/baseline/v1/runs/${data.runId}`,
			organizationId,
			brandId: brand.id,
			callerId: (session.user as any).name || session.user.id,
		});
	});

// ============================================================================
// 5. 查询任务逐题证据明细 (GET /runs/{run_id}/evidence)
// ============================================================================

export const getBaselineEvidenceFn = createServerFn({ method: "GET" })
	.validator(z.object({ brandId: z.string(), runId: z.string() }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		await requireOrgAccess(session.user.id, organizationId);

		return callBaselineBackend({
			method: "GET",
			path: `/api/baseline/v1/runs/${data.runId}/evidence`,
			organizationId,
			brandId: brand.id,
			callerId: (session.user as any).name || session.user.id,
		});
	});

// ============================================================================
// 6. 查询客观统计指标 (GET /runs/{run_id}/metrics)
// ============================================================================

export const getBaselineMetricsFn = createServerFn({ method: "GET" })
	.validator(z.object({ brandId: z.string(), runId: z.string() }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		await requireOrgAccess(session.user.id, organizationId);

		return callBaselineBackend({
			method: "GET",
			path: `/api/baseline/v1/runs/${data.runId}/metrics`,
			organizationId,
			brandId: brand.id,
			callerId: (session.user as any).name || session.user.id,
		});
	});

// ============================================================================
// 7. 保存结构化人工分析版本 (POST /runs/{run_id}/analysis)
// ============================================================================

export const saveBaselineAnalysisFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string(),
			runId: z.string(),
			analystName: z.string().min(1),
			executiveConclusion: z.string().min(1),
			keyFindings: z.array(z.string()).min(1),
			brandIdentityAudit: z.string().default("主体识别清晰"),
			rootCauses: z.array(
				z.object({
					cause_id: z.string(),
					title: z.string(),
					observed_facts: z.array(z.string()),
					analytic_judgements: z.array(z.string()),
					unverified_hypotheses: z.array(z.string()).default([]),
				}),
			).default([]),
			channelGaps: z.array(
				z.object({
					channel_type: z.string(),
					citation_count: z.number().int(),
					citation_share_text: z.string(),
					actionability: z.string(),
					strategic_note: z.string(),
				}),
			).default([]),
			contentGaps: z.string().default(""),
			actionPlan: z.array(
				z.object({
					finding: z.string(),
					evidence_refs: z.array(z.string()),
					action: z.string(),
					priority: z.enum(["P1", "P2", "P3"]),
					priority_rationale: z.string(),
					deliverable: z.string(),
					verification_method: z.string(),
				}),
			).min(1),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		await requireOrgAccess(session.user.id, organizationId);

		const payload = {
			analyst_name: data.analystName,
			executive_conclusion: data.executiveConclusion,
			key_findings: data.keyFindings,
			brand_identity_audit: data.brandIdentityAudit,
			root_causes: data.rootCauses,
			channel_gaps: data.channelGaps,
			content_gaps: data.contentGaps,
			action_plan: data.actionPlan,
		};

		return callBaselineBackend({
			method: "POST",
			path: `/api/baseline/v1/runs/${data.runId}/analysis`,
			organizationId,
			brandId: brand.id,
			callerId: (session.user as any).name || session.user.id,
			body: payload,
		});
	});

// ============================================================================
// 8. 生成版本化报告修订 (POST /runs/{run_id}/reports)
// ============================================================================

export const generateBaselineReportRevisionFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string(),
			runId: z.string(),
			revisionId: z.string().default("rev_01"),
			analysisId: z.string(),
			clientSlug: z.string().optional(),
			draftNotice: z.string().default("内部评估草稿（rev_01）"),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		await requireOrgAccess(session.user.id, organizationId);

		const payload = {
			revision_id: data.revisionId,
			analysis_id: data.analysisId,
			client_slug: data.clientSlug || brand.name.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, "_"),
			draft_notice: data.draftNotice,
		};

		return callBaselineBackend({
			method: "POST",
			path: `/api/baseline/v1/runs/${data.runId}/reports`,
			organizationId,
			brandId: brand.id,
			callerId: (session.user as any).name || session.user.id,
			body: payload,
		});
	});

// ============================================================================
// 9. 审核指定报告修订 (POST /reports/{report_id}/revisions/{revision_id}/review)
// ============================================================================

export const reviewBaselineReportRevisionFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string(),
			reportId: z.string(),
			revisionId: z.string(),
			action: z.enum(["approve", "reject"]),
			reason: z.string(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		await requireOrgAccess(session.user.id, organizationId);

		const payload = {
			action: data.action,
			reason: data.reason,
		};

		return callBaselineBackend({
			method: "POST",
			path: `/api/baseline/v1/reports/${data.reportId}/revisions/${data.revisionId}/review`,
			organizationId,
			brandId: brand.id,
			callerId: (session.user as any).name || session.user.id,
			body: payload,
		});
	});

// ============================================================================
// 10. 查询单次报告修订详情
// ============================================================================

export const getBaselineReportRevisionFn = createServerFn({ method: "GET" })
	.validator(
		z.object({
			brandId: z.string(),
			reportId: z.string(),
			revisionId: z.string(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		await requireOrgAccess(session.user.id, organizationId);

		return callBaselineBackend({
			method: "GET",
			path: `/api/baseline/v1/reports/${data.reportId}/revisions/${data.revisionId}`,
			organizationId,
			brandId: brand.id,
			callerId: (session.user as any).name || session.user.id,
		});
	});

// ============================================================================
// 11. 列出当前租户所有任务
// ============================================================================

export const listBaselineRunsFn = createServerFn({ method: "GET" })
	.validator(z.object({ brandId: z.string() }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		await requireOrgAccess(session.user.id, organizationId);

		return callBaselineBackend({
			method: "GET",
			path: "/api/baseline/v1/runs?limit=20&offset=0",
			organizationId,
			brandId: brand.id,
			callerId: (session.user as any).name || session.user.id,
		});
	});
