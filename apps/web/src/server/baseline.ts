/**
 * /server/baseline.ts — elmo 与 Python 豆包基线微服务 (REPORT-001D/E) 服务端函数层
 *
 * 架构规范：
 * 1. 严格只导出 createServerFn 服务端函数，绝不在此导出原生 Node/DB 依赖；
 * 2. 数据库与敏感通信统一封装在 baseline.server.ts，由 .handler 内部动态按需加载，杜绝 Client Bundle 污染与 Buffer 崩溃；
 * 3. 严格核验组织归属 (requireBaselineOperatorAccess) 与审核权限门禁 (requireBaselineReviewerAccess)；
 * 4. 保持稳定的原问题 ID 映射 (original_prompt_id) 与题型编号 (Q01 / PR01)；
 * 5. 缺失分类严禁静默伪造，阻断并提示人工补齐。
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuthSession } from "@/lib/auth/helpers";

// ============================================================================
// 1. 获取当前品牌档案、多业务题集与基线输入摘要
// ============================================================================

export const getBrandBaselineProfileFn = createServerFn({ method: "GET" })
	.validator(z.object({ brandId: z.string() }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		const {
			getBrandAndOrg,
			requireBaselineOperatorAccess,
		} = await import("./baseline.server");

		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		await requireBaselineOperatorAccess(session, organizationId);

		const { db } = await import("@workspace/lib/db/db");
		const { competitors, prompts, brandProductLines, brandCredentials } = await import("@workspace/lib/db/schema");
		const { eq, and, asc } = await import("drizzle-orm");

		const compList = await db
			.select()
			.from(competitors)
			.where(eq(competitors.brandId, brand.id));

		const productLinesList = await db
			.select()
			.from(brandProductLines)
			.where(eq(brandProductLines.brandId, brand.id))
			.orderBy(asc(brandProductLines.position));

		const credentialsList = await db
			.select()
			.from(brandCredentials)
			.where(eq(brandCredentials.brandId, brand.id));

		const promptList = await db
			.select()
			.from(prompts)
			.where(and(eq(prompts.brandId, brand.id), eq(prompts.enabled, true)))
			.orderBy(asc(prompts.createdAt), asc(prompts.id));

		let formalIdx = 0;
		let probeIdx = 0;

		const parsedPrompts = promptList.map((p) => {
			const isProbe =
				p.systemTags?.includes("probe") ||
				p.tags?.includes("probe") ||
				p.tags?.includes("is_probe") ||
				false;

			const dimTag =
				p.tags?.find((t) => t.startsWith("dim:"))?.replace(/^dim:/, "") ||
				p.tags?.find((t) => t.startsWith("cat:"))?.replace(/^cat:/, "") ||
				"";

			const code = isProbe
				? `PR${String(++probeIdx).padStart(2, "0")}`
				: `Q${String(++formalIdx).padStart(2, "0")}`;

			return {
				id: p.id,
				original_prompt_id: p.id,
				code,
				text: p.value,
				keywordText: p.value.slice(0, 20),
				dimensionName: dimTag || "未分类",
				unclassified: !dimTag,
				isProbe,
			};
		});

		const formalCount = parsedPrompts.filter((p) => !p.isProbe).length;
		const probeCount = parsedPrompts.filter((p) => p.isProbe).length;
		const unclassifiedCount = parsedPrompts.filter((p) => p.unclassified).length;

		return {
			brand: {
				id: brand.id,
				name: brand.name,
				website: brand.website,
				additionalDomains: brand.additionalDomains || [],
				aliases: brand.aliases || [],
				summary: brand.summary || "",
				description: brand.description || "",
				productLines: productLinesList.map((pl) => ({
					name: pl.name,
					category: pl.category,
					differentiators: pl.differentiators,
				})),
				credentials: credentialsList.map((cr) => ({
					name: cr.name,
					credType: cr.credType,
				})),
				organizationId,
			},
			competitors: compList.map((c) => ({
				id: c.id,
				name: c.name,
				website: c.domains?.[0] || "",
				domains: c.domains || [],
				aliases: c.aliases || [],
			})),
			prompts: parsedPrompts,
			summary: {
				totalPrompts: parsedPrompts.length,
				formalCount,
				probeCount,
				unclassifiedCount,
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
			// 可选的人工补充分类映射: { [promptId]: "维度名称" }
			dimensionOverrides: z.record(z.string(), z.string()).optional(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		const {
			getBrandAndOrg,
			requireBaselineOperatorAccess,
			callBaselineBackend,
		} = await import("./baseline.server");

		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		await requireBaselineOperatorAccess(session, organizationId);

		const { db } = await import("@workspace/lib/db/db");
		const { competitors, prompts, brandProductLines, brandCredentials } = await import("@workspace/lib/db/schema");
		const { eq, and, asc } = await import("drizzle-orm");

		const compList = await db
			.select()
			.from(competitors)
			.where(eq(competitors.brandId, brand.id));

		const productLinesList = await db
			.select()
			.from(brandProductLines)
			.where(eq(brandProductLines.brandId, brand.id))
			.orderBy(asc(brandProductLines.position));

		const credentialsList = await db
			.select()
			.from(brandCredentials)
			.where(eq(brandCredentials.brandId, brand.id));

		const promptList = await db
			.select()
			.from(prompts)
			.where(and(eq(prompts.brandId, brand.id), eq(prompts.enabled, true)))
			.orderBy(asc(prompts.createdAt), asc(prompts.id));

		if (promptList.length === 0) {
			throw new Error("当前品牌无可用问题，请先在问题管理中录入至少一个问题");
		}

		let formalIdx = 0;
		let probeIdx = 0;
		const unclassifiedList: string[] = [];

		const parsedPrompts = promptList.map((p) => {
			const isProbe =
				p.systemTags?.includes("probe") ||
				p.tags?.includes("probe") ||
				p.tags?.includes("is_probe") ||
				false;

			const overrideDim = data.dimensionOverrides?.[p.id];
			const dimTag =
				overrideDim ||
				p.tags?.find((t) => t.startsWith("dim:"))?.replace(/^dim:/, "") ||
				p.tags?.find((t) => t.startsWith("cat:"))?.replace(/^cat:/, "") ||
				"";

			if (!dimTag) {
				unclassifiedList.push(p.value);
			}

			const code = isProbe
				? `PR${String(++probeIdx).padStart(2, "0")}`
				: `Q${String(++formalIdx).padStart(2, "0")}`;

			return {
				code,
				original_prompt_id: p.id,
				text: p.value,
				keyword_text: p.value.slice(0, 20),
				dimension_name: dimTag || "未分类业务板块",
				is_probe: isProbe,
			};
		});

		// 严格质量门禁：分类缺失阻断冻结并要求人工补齐 (E-R04)
		if (unclassifiedList.length > 0) {
			throw new Error(
				`存在 ${unclassifiedList.length} 道未分类问题（例如: "${unclassifiedList[0]}"），必须人工指定业务板块或分类后再冻结输入。`,
			);
		}

		// 规范提取品牌主域名与附加域名
		const domains: string[] = [];
		if (brand.website) {
			domains.push(brand.website.replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
		}
		if (Array.isArray(brand.additionalDomains)) {
			for (const d of brand.additionalDomains) {
				const clean = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
				if (clean && !domains.includes(clean)) domains.push(clean);
			}
		}

		const freezePayload = {
			profile: {
				brand_id: brand.id,
				brand_name: brand.name,
				aliases: brand.aliases || [brand.name],
				domains,
				disambiguation_keywords: [],
				industry_keywords: [],
				product_lines: productLinesList.map((pl) => ({
					name: pl.name,
					category: pl.category,
					differentiators: pl.differentiators,
				})),
				credentials: credentialsList.map((cr) => ({
					name: cr.name,
					credType: cr.credType,
				})),
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
				confirmed_by: session.user.id,
				confirmed_at: new Date().toISOString().split("T")[0],
			},
		};

		return callBaselineBackend({
			method: "POST",
			path: "/api/baseline/v1/inputs/freeze",
			organizationId,
			brandId: brand.id,
			callerId: session.user.id,
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
			runId: z.string().optional(),
			mode: z.enum(["synthetic", "real"]).default("synthetic"),
			requestBudget: z.number().int().min(1).max(500).default(30),
			maxRetries: z.number().int().min(0).max(3).default(0),
			idempotencyKey: z.string().optional(),
			modelName: z.string().optional(),
			webSearch: z.boolean().optional(),
			maxOutputTokens: z.number().int().optional(),
			maxToolCalls: z.number().int().optional(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		const {
			getBrandAndOrg,
			requireBaselineOperatorAccess,
			callBaselineBackend,
		} = await import("./baseline.server");

		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		await requireBaselineOperatorAccess(session, organizationId);

		let runId = data.runId;
		let modelName = data.modelName;
		let webSearch = data.webSearch;
		let requestBudget = data.requestBudget;
		let maxRetries = data.maxRetries;

		// real 模式下若未显式指定 runId，自动查询并绑定当前快照未消费的活跃服务端授权 (E5-R01)
		if (data.mode === "real" && !runId) {
			try {
				const authRes = await callBaselineBackend({
					method: "GET",
					path: `/api/baseline/v1/auth/authorizations?snapshot_id=${encodeURIComponent(data.snapshotId)}`,
					organizationId,
					brandId: brand.id,
					callerId: session.user.id,
				});
				if (authRes?.authorization?.run_id) {
					runId = authRes.authorization.run_id;
					if (!modelName && authRes.authorization.model_name) {
						modelName = authRes.authorization.model_name;
					}
					if (webSearch === undefined && authRes.authorization.web_search !== undefined) {
						webSearch = Boolean(authRes.authorization.web_search);
					}
					if (authRes.authorization.request_limit) {
						requestBudget = authRes.authorization.request_limit;
					}
					if (authRes.authorization.retry_limit !== undefined) {
						maxRetries = authRes.authorization.retry_limit;
					}
				}
			} catch {
				// 保持容错，若后端不可达或无授权，交由后端门禁判定
			}
		}

		if (!runId) {
			runId = `run_${brand.id.toLowerCase()}_${Date.now()}`;
		}
		const idempotencyKey =
			data.idempotencyKey || `idemp_${brand.id.toLowerCase()}_${runId}`;

		const payload: Record<string, any> = {
			snapshot_id: data.snapshotId,
			mode: data.mode,
			run_id: runId,
			idempotency_key: idempotencyKey,
			request_budget: requestBudget,
			max_retries: maxRetries,
		};
		if (modelName) payload.model_name = modelName;
		if (webSearch !== undefined) payload.web_search = webSearch;
		if (data.maxOutputTokens !== undefined) payload.max_output_tokens = data.maxOutputTokens;
		if (data.maxToolCalls !== undefined) payload.max_tool_calls = data.maxToolCalls;

		return callBaselineBackend({
			method: "POST",
			path: "/api/baseline/v1/runs",
			organizationId,
			brandId: brand.id,
			callerId: session.user.id,
			body: payload,
		});
	});

export const registerBaselineServerAuthFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string(),
			snapshotId: z.string(),
			runId: z.string().min(1, "runId 必须明确指定"),
			snapshotHash: z.string().min(1, "snapshotHash 必须明确指定"),
			modelName: z.string().default("doubao-seed-2-1-pro-260628"),
			webSearch: z.boolean().default(true),
			maxOutputTokens: z.number().int().optional(),
			maxToolCalls: z.number().int().optional(),
			requestLimit: z.number().int().min(1).max(500).default(30),
			retryLimit: z.number().int().min(0).max(3).default(0),
			targetBaseUrl: z.string().optional(),
			expiresAt: z.string().optional(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		const {
			getBrandAndOrg,
			requireBaselineReviewerAccess,
			callBaselineBackend,
		} = await import("./baseline.server");

		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		await requireBaselineReviewerAccess(session, organizationId);

		const payload = {
			snapshot_id: data.snapshotId,
			run_id: data.runId,
			snapshot_hash: data.snapshotHash,
			model_name: data.modelName,
			web_search: data.webSearch,
			max_output_tokens: data.maxOutputTokens,
			max_tool_calls: data.maxToolCalls,
			request_limit: data.requestLimit,
			retry_limit: data.retryLimit,
			target_base_url: data.targetBaseUrl,
			expires_at: data.expiresAt,
			authorized_by: session.user.id,
		};

		return callBaselineBackend({
			method: "POST",
			path: "/api/baseline/v1/auth/authorizations",
			organizationId,
			brandId: brand.id,
			callerId: session.user.id,
			body: payload,
		});
	});

export const getBaselineActiveAuthFn = createServerFn({ method: "GET" })
	.validator(
		z.object({
			brandId: z.string(),
			snapshotId: z.string(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		const {
			getBrandAndOrg,
			requireBaselineOperatorAccess,
			callBaselineBackend,
		} = await import("./baseline.server");

		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		await requireBaselineOperatorAccess(session, organizationId);

		try {
			return await callBaselineBackend({
				method: "GET",
				path: `/api/baseline/v1/auth/authorizations?snapshot_id=${encodeURIComponent(data.snapshotId)}`,
				organizationId,
				brandId: brand.id,
				callerId: session.user.id,
			});
		} catch {
			return { authorization: null };
		}
	});

// ============================================================================
// 4. 查询任务详情与进度
// ============================================================================

export const getBaselineRunFn = createServerFn({ method: "GET" })
	.validator(z.object({ brandId: z.string(), runId: z.string() }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		const {
			getBrandAndOrg,
			requireBaselineOperatorAccess,
			callBaselineBackend,
		} = await import("./baseline.server");

		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		await requireBaselineOperatorAccess(session, organizationId);

		return callBaselineBackend({
			method: "GET",
			path: `/api/baseline/v1/runs/${data.runId}`,
			organizationId,
			brandId: brand.id,
			callerId: session.user.id,
		});
	});

// ============================================================================
// 5. 查询任务逐题证据明细 (GET /runs/{run_id}/evidence)
// ============================================================================

export const getBaselineEvidenceFn = createServerFn({ method: "GET" })
	.validator(z.object({ brandId: z.string(), runId: z.string() }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		const {
			getBrandAndOrg,
			requireBaselineOperatorAccess,
			callBaselineBackend,
		} = await import("./baseline.server");

		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		await requireBaselineOperatorAccess(session, organizationId);

		return callBaselineBackend({
			method: "GET",
			path: `/api/baseline/v1/runs/${data.runId}/evidence`,
			organizationId,
			brandId: brand.id,
			callerId: session.user.id,
		});
	});

// ============================================================================
// 6. 查询客观统计指标 (GET /runs/{run_id}/metrics)
// ============================================================================

export const getBaselineMetricsFn = createServerFn({ method: "GET" })
	.validator(z.object({ brandId: z.string(), runId: z.string() }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		const {
			getBrandAndOrg,
			requireBaselineOperatorAccess,
			callBaselineBackend,
		} = await import("./baseline.server");

		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		await requireBaselineOperatorAccess(session, organizationId);

		return callBaselineBackend({
			method: "GET",
			path: `/api/baseline/v1/runs/${data.runId}/metrics`,
			organizationId,
			brandId: brand.id,
			callerId: session.user.id,
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
			brandIdentityAudit: z.string().default("待人工核实与完善"),
			rootCauses: z
				.array(
					z.object({
						cause_id: z.string(),
						title: z.string(),
						observed_facts: z.array(z.string()),
						analytic_judgements: z.array(z.string()),
						unverified_hypotheses: z.array(z.string()).default([]),
					}),
				)
				.default([]),
			channelGaps: z
				.array(
					z.object({
						channel_type: z.string(),
						citation_count: z.number().int(),
						citation_share_text: z.string(),
						actionability: z.string(),
						strategic_note: z.string(),
					}),
				)
				.default([]),
			contentGaps: z.string().default("待人工补充内容资产缺口"),
			actionPlan: z
				.array(
					z.object({
						finding: z.string(),
						evidence_refs: z.array(z.string()),
						action: z.string(),
						priority: z.enum(["P1", "P2", "P3"]),
						priority_rationale: z.string(),
						deliverable: z.string(),
						verification_method: z.string(),
					}),
				)
				.min(1),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		const {
			getBrandAndOrg,
			requireBaselineOperatorAccess,
			callBaselineBackend,
		} = await import("./baseline.server");

		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		await requireBaselineOperatorAccess(session, organizationId);

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
			callerId: session.user.id,
			body: payload,
		});
	});

// ============================================================================
// 7.1. 查询指定任务最新或指定版本人工分析 (GET /runs/{run_id}/analysis) (E2-R04)
// ============================================================================

export const getBaselineAnalysisFn = createServerFn({ method: "GET" })
	.validator(
		z.object({
			brandId: z.string(),
			runId: z.string(),
			analysisId: z.string().optional(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		const {
			getBrandAndOrg,
			requireBaselineOperatorAccess,
			callBaselineBackend,
		} = await import("./baseline.server");

		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		await requireBaselineOperatorAccess(session, organizationId);

		const path = data.analysisId
			? `/api/baseline/v1/runs/${encodeURIComponent(data.runId)}/analysis?analysis_id=${encodeURIComponent(data.analysisId)}`
			: `/api/baseline/v1/runs/${encodeURIComponent(data.runId)}/analysis`;

		try {
			return await callBaselineBackend({
				method: "GET",
				path,
				organizationId,
				brandId: brand.id,
				callerId: session.user.id,
			});
		} catch (err: any) {
			if (err.message?.includes("404") || err.message?.includes("analysis_not_found")) {
				return null;
			}
			throw err;
		}
	});

// ============================================================================
// 7.2. 查询报告修订列表与状态 (GET /reports/{report_id}) (E2-R04)
// ============================================================================

export const getBaselineReportFn = createServerFn({ method: "GET" })
	.validator(
		z.object({
			brandId: z.string(),
			reportId: z.string(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		const {
			getBrandAndOrg,
			requireBaselineOperatorAccess,
			callBaselineBackend,
		} = await import("./baseline.server");

		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		await requireBaselineOperatorAccess(session, organizationId);

		try {
			return await callBaselineBackend({
				method: "GET",
				path: `/api/baseline/v1/reports/${encodeURIComponent(data.reportId)}`,
				organizationId,
				brandId: brand.id,
				callerId: session.user.id,
			});
		} catch (err: any) {
			if (err.message?.includes("404") || err.message?.includes("report_not_found")) {
				return null;
			}
			throw err;
		}
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
			draftNotice: z.string().default("内部评估草稿"),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		const {
			getBrandAndOrg,
			requireBaselineOperatorAccess,
			callBaselineBackend,
		} = await import("./baseline.server");

		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		await requireBaselineOperatorAccess(session, organizationId);

		const payload = {
			revision_id: data.revisionId,
			analysis_id: data.analysisId,
			client_slug:
				data.clientSlug || brand.name.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, "_"),
			draft_notice: data.draftNotice,
		};

		return callBaselineBackend({
			method: "POST",
			path: `/api/baseline/v1/runs/${data.runId}/reports`,
			organizationId,
			brandId: brand.id,
			callerId: session.user.id,
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
		const {
			getBrandAndOrg,
			requireBaselineReviewerAccess,
			callBaselineBackend,
		} = await import("./baseline.server");

		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		// 角色强门禁：普通 member 严禁审核批准，必须为 org owner/admin (E-R07)
		await requireBaselineReviewerAccess(session, organizationId);

		const payload = {
			action: data.action,
			reason: data.reason,
			reviewer: session.user.id,
		};

		return callBaselineBackend({
			method: "POST",
			path: `/api/baseline/v1/reports/${data.reportId}/revisions/${data.revisionId}/review`,
			organizationId,
			brandId: brand.id,
			callerId: session.user.id,
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
		const {
			getBrandAndOrg,
			requireBaselineOperatorAccess,
			callBaselineBackend,
		} = await import("./baseline.server");

		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		await requireBaselineOperatorAccess(session, organizationId);

		return callBaselineBackend({
			method: "GET",
			path: `/api/baseline/v1/reports/${data.reportId}/revisions/${data.revisionId}`,
			organizationId,
			brandId: brand.id,
			callerId: session.user.id,
		});
	});

// ============================================================================
// 11. 列出当前租户所有任务
// ============================================================================

export const listBaselineRunsFn = createServerFn({ method: "GET" })
	.validator(z.object({ brandId: z.string() }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		const {
			getBrandAndOrg,
			requireBaselineOperatorAccess,
			callBaselineBackend,
		} = await import("./baseline.server");

		const { brand, organizationId } = await getBrandAndOrg(data.brandId);
		await requireBaselineOperatorAccess(session, organizationId);

		return callBaselineBackend({
			method: "GET",
			path: "/api/baseline/v1/runs?limit=30&offset=0",
			organizationId,
			brandId: brand.id,
			callerId: session.user.id,
		});
	});
