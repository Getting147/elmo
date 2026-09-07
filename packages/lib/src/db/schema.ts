import { sql } from "drizzle-orm";
import { pgEnum, pgTable, uuid, text, timestamp, boolean, json, jsonb, index, integer, smallint } from "drizzle-orm/pg-core";
// `organization` is referenced by the brands FK below; the re-export makes it
// (and the rest of the auth schema) visible to `import * as schema` consumers.
import { organization } from "./schema-auth";

// Better-auth tables & relations — re-exported so `import * as schema` sees everything.
// Source file is auto-generated; run `pnpm run generate:auth-schema` to refresh.
export * from "./schema-auth";

// ============================================================================
// Application tables
// ============================================================================

export const reportStatusEnum = pgEnum("report_status", ["pending", "processing", "completed", "failed"]);

export const brands = pgTable(
	"brands",
	{
		id: text("id").primaryKey().notNull(),
		name: text("name").notNull(),
		website: text("website").notNull(),
		additionalDomains: text("additional_domains").array().notNull().default([]),
		aliases: text("aliases").array().notNull().default([]),
		// Epic A-2 (V1.0): 一句话定位（"中国领先的高端家电品牌"）
		summary: text("summary"),
		// Epic A-2 (V1.0): 简介 ~500 字（业务/产品/市场/历史摘要）
		description: text("description"),
		enabled: boolean("enabled").default(true).notNull(),
		onboarded: boolean("onboarded").default(false).notNull(),
		delayOverrideHours: integer("delay_override_hours"),
		enabledModels: text("enabled_models").array(),
		// Hard tenancy scope. Every brand belongs to exactly one better-auth
		// organization; org membership (the `member` table) is the access-control
		// mechanism — see apps/web/src/lib/auth/helpers.ts. Historically `brand.id`
		// equalled `organization.id`; the 0010 backfill makes that mapping explicit
		// so cloud entitlements/metering/enforcement can join on it.
		organizationId: text("organization_id")
			.references(() => organization.id)
			.notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		// Soft delete (V1): 删除 = 隐藏 + 停扫 + 数据保留（Owner 2026-09-07）
		deletedAt: timestamp("deleted_at", { withTimezone: true }),
	},
	(table) => ({
		organizationIdIdx: index("brands_organization_id_idx").on(table.organizationId),
	}),
).enableRLS();

export const prompts = pgTable(
	"prompts",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		brandId: text("brand_id")
			.references(() => brands.id)
			.notNull(),
		value: text("value").notNull(),
		enabled: boolean("enabled").default(true).notNull(),
		tags: text("tags").array().notNull().default([]),
		systemTags: text("system_tags").array().notNull().default([]),
		/** P0-3: target market snapshot (us/uk/de/fr/jp/ca/au or NULL=不限). DB-level free-form, zod enum enforced at API boundary. */
		market: text("market"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => ({
		brandIdIdx: index("prompts_brand_id_idx").on(table.brandId),
		brandIdEnabledIdx: index("prompts_brand_id_enabled_idx").on(table.brandId, table.enabled),
		brandIdMarketIdx: index("prompts_brand_id_market_idx").on(table.brandId, table.market),
	}),
).enableRLS();

export const competitors = pgTable("competitors", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	brandId: text("brand_id")
		.references(() => brands.id)
		.notNull(),
	name: text("name").notNull(),
	domains: text("domains").array().notNull().default([]),
	aliases: text("aliases").array().notNull().default([]),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
}).enableRLS();

export const promptRuns = pgTable(
	"prompt_runs",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		promptId: uuid("prompt_id")
			.references(() => prompts.id)
			.notNull(),
		brandId: text("brand_id")
			.references(() => brands.id)
			.notNull(),
		model: text("model").notNull(),
		provider: text("provider"),
		version: text("version").notNull(),
		webSearchEnabled: boolean("web_search_enabled").notNull(),
		rawOutput: json("raw_output").notNull(),
		webQueries: text("web_queries").array().notNull().default([]),
		brandMentioned: boolean("brand_mentioned").notNull(),
		competitorsMentioned: text("competitors_mentioned").array().notNull().default([]),
		answerRank: smallint("answer_rank"),
		answerType: text("answer_type"),
		/** P0-3: market snapshot (NULL=不限). Snapshot from prompts.market at run creation time. */
		market: text("market"),
		/** P0-3: actual prompt string sent to provider (with market prefix if applicable). NULL = same as prompt.value (no market). */
		injectedValue: text("injected_value"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		promptIdCreatedAtIdx: index("prompt_runs_prompt_id_created_at_idx").on(table.promptId, table.createdAt),
		createdAtIdx: index("prompt_runs_created_at_idx").on(table.createdAt),
		webSearchCreatedAtIdx: index("prompt_runs_web_search_created_at_idx").on(table.webSearchEnabled, table.createdAt),
		webSearchModelCreatedAtIdx: index("prompt_runs_web_search_model_created_at_idx").on(
			table.webSearchEnabled,
			table.model,
			table.createdAt,
		),
		providerIdx: index("prompt_runs_provider_idx").on(table.provider),
		modelCreatedAtIdx: index("prompt_runs_model_created_at_idx").on(table.model, table.createdAt),
		brandIdMarketIdx: index("prompt_runs_brand_id_market_idx").on(table.brandId, table.market, table.createdAt),
		promptIdMarketIdx: index("prompt_runs_prompt_id_market_idx").on(table.promptId, table.market),
	}),
).enableRLS();

export const citations = pgTable(
	"citations",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		promptRunId: uuid("prompt_run_id")
			.references(() => promptRuns.id)
			.notNull(),
		promptId: uuid("prompt_id")
			.references(() => prompts.id)
			.notNull(),
		brandId: text("brand_id")
			.references(() => brands.id)
			.notNull(),
		model: text("model").notNull(),
		url: text("url").notNull(),
		domain: text("domain").notNull(),
		title: text("title"),
		citationIndex: smallint("citation_index").notNull(),
		/** P0-3: market snapshot propagated from prompt_run. */
		market: text("market"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		brandAnalyticsIdx: index("idx_citations_brand_analytics").on(
			table.brandId,
			table.createdAt,
			table.url,
			table.domain,
			table.title,
			table.promptId,
			table.model,
		),
		promptCreatedIdx: index("citations_prompt_id_created_at_idx").on(table.promptId, table.createdAt),
		domainIdx: index("citations_domain_idx").on(table.domain),
		brandIdMarketIdx: index("citations_brand_id_market_idx").on(table.brandId, table.market, table.createdAt),
	}),
).enableRLS();

export const reports = pgTable(
	"reports",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		brandName: text("brand_name").notNull(),
		brandWebsite: text("brand_website").notNull(),
		status: reportStatusEnum().notNull().default("pending"),
		progress: integer("progress").notNull().default(0),
		rawOutput: json("raw_output"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => ({
		createdAtIdx: index("reports_created_at_idx").on(table.createdAt),
	}),
).enableRLS();

// One row per generated Opportunities report, per brand — append-only history
// (every generation is kept, not overwritten). The page reads the latest row and
// regenerates only when it's stale; see apps/web/src/server/opportunities.ts.
export const brandOpportunities = pgTable(
	"brand_opportunities",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		brandId: text("brand_id")
			.references(() => brands.id)
			.notNull(),
		/** The full enriched opportunities report the page renders (OpportunitiesReport JSON). */
		report: json("report").notNull(),
		/** Model/provider that generated it, when known. */
		model: text("model"),
		/** Report content language (en/zh) — generated from the UI language at request time. */
		language: text("language").notNull().default("en"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		brandCreatedIdx: index("brand_opportunities_brand_id_created_at_idx").on(table.brandId, table.createdAt),
	}),
).enableRLS();

export type BrandOpportunity = typeof brandOpportunities.$inferSelect;
export type NewBrandOpportunity = typeof brandOpportunities.$inferInsert;

// =============================================================================
// Epic A-2 (V1.0) M2: 草稿表 draftResearch（与 brands 解耦，仅引用 brands.id FK CASCADE）
// 状态机: pending_review → confirmed → applied → done / failed / rolled_back
// idempotency: 唯一索引 (brand_id, url_hash) 保证同 URL 重跑命中现有草稿
// payload JSONB: OnboardingSuggestion 完整快照（确认后 populate 各表）
// research_status（migration 0019）: queued/running/done/failed — 异步 LLM 处理状态（独立于 state）
// =============================================================================

export const draftResearchState = pgEnum("draft_research_state", [
	"pending_review", // LLM 完成等用户确认
	"confirmed", // 用户已确认待灌库
	"applied", // 已 populate 目标表（v1 与 confirmed 同义，保留 V1.1 拆分明细）
	"done", // 流程完成
	"failed", // LLM/抓取失败（error 字段有原因）
	"rolled_back", // 用户后悔放弃（V1 软删 = 状态标记）
]);

export const draftResearchResearchStatus = pgEnum("draft_research_research_status", [
	"queued", // triggerResearch 建 draft（enqueue 前）
	"running", // processResearchJob 开始
	"done", // analyzeBrand + validateEvidence 完成，payload 已写入
	"failed", // job 异常（同 batch research_status='failed' + state='failed'）
]);

export const draftResearch = pgTable(
	"draft_research",
	{
		id: text("id").primaryKey().notNull(),
		brandId: text("brand_id")
			.references(() => brands.id, { onDelete: "cascade" })
			.notNull(),
		/** SHA256(cleanUrl(website)).slice(0,16) — idempotency key */
		urlHash: text("url_hash").notNull(),
		state: draftResearchState("state").notNull().default("pending_review"),
		/** OnboardingSuggestion 完整 JSONB 快照（summary/description/productLines confirmed+unverified/competitors/prompts） */
		payload: jsonb("payload").notNull(),
		/** 失败时填：错误描述（如 LLM 调用失败 / 抓取失败） */
		error: text("error"),
		/** 异步 LLM 处理状态（V1.0 加列，避免 payload 探测 hack） */
		researchStatus: draftResearchResearchStatus("research_status")
			.notNull()
			.default("queued"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		/** V1 默认 30 天后过期（应用层查列表时 WHERE expires_at > now() 过滤） */
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		// 唯一性：active 态（pending_review/confirmed）唯一（migration 0018 partial unique）—
		// 终态（applied/done/failed/rolled_back）允许多行（重试覆盖/历史归档可追溯）
		brandUrlActiveIdx: index("draft_research_brand_id_url_hash_active_idx").on(table.brandId, table.urlHash),
		// 列表查询（按 brand + 状态过滤 + 时间倒序）
		brandStateIdx: index("draft_research_brand_id_state_idx").on(
			table.brandId,
			table.state,
			table.createdAt.desc(),
		),
		// 监控/dashboard
		stateIdx: index("draft_research_state_idx").on(table.state, table.createdAt.desc()),
		// 监控/dashboard（按 research_status 过滤 + 时间倒序）
		brandResearchStatusIdx: index("draft_research_brand_id_research_status_idx").on(
			table.brandId,
			table.researchStatus,
			table.createdAt.desc(),
		),
	}),
).enableRLS();

export type DraftResearch = typeof draftResearch.$inferSelect;
export type NewDraftResearch = typeof draftResearch.$inferInsert;

// =============================================================================
// Epic A-1 品牌档案（US-A02 产品线 + US-A03 资质背书）
// 设计：EPIC-A-BRAND-PROFILE-DESIGN-v1.md（hill 2026-09-04 拍板）
// 不同iators 必填（事实校验基准主体）；year TEXT 兼容 "2023-2024"；is_third_party_public 必填布尔。
// =============================================================================

export const CRED_TYPES = [
	"certification",
	"patent",
	"award",
	"membership",
	"case_study",
	"media",
] as const;

export const brandProductLines = pgTable(
	"brand_product_lines",
	{
		id: text("id").primaryKey().notNull(),
		brandId: text("brand_id")
			.references(() => brands.id, { onDelete: "cascade" })
			.notNull(),
		name: text("name").notNull(),
		category: text("category"),
		coreParams: text("core_params"),
		differentiators: text("differentiators").notNull(),
		targetAudience: text("target_audience"),
		position: smallint("position").default(0).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => ({
		brandIdIdx: index("brand_product_lines_brand_id_idx").on(table.brandId, table.position),
	}),
).enableRLS();

export const brandCredentials = pgTable(
	"brand_credentials",
	{
		id: text("id").primaryKey().notNull(),
		brandId: text("brand_id")
			.references(() => brands.id, { onDelete: "cascade" })
			.notNull(),
		credType: text("cred_type").notNull(),
		name: text("name").notNull(),
		year: text("year"),
		isThirdPartyPublic: boolean("is_third_party_public").default(false).notNull(),
		url: text("url"),
		position: smallint("position").default(0).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => ({
		brandIdIdx: index("brand_credentials_brand_id_idx").on(table.brandId, table.position),
		thirdPartyIdx: index("brand_credentials_third_party_idx")
			.on(table.brandId)
			.where(sql`${table.isThirdPartyPublic} = true`),
	}),
).enableRLS();

export type BrandProductLine = typeof brandProductLines.$inferSelect;
export type NewBrandProductLine = typeof brandProductLines.$inferInsert;
export type BrandCredential = typeof brandCredentials.$inferSelect;
export type NewBrandCredential = typeof brandCredentials.$inferInsert;

/**
 * Epic A-2 (V1.0): 产品线 SKU（独立表，与 Epic A-1 product_lines 1:N）。
 * evidence_url 是防幻觉证据源（M1 evidence.ts 校验 SKU name grep 对应页文本）。
 */
export const brandProductSkus = pgTable(
	"brand_product_skus",
	{
		id: text("id").primaryKey().notNull(),
		brandId: text("brand_id")
			.references(() => brands.id, { onDelete: "cascade" })
			.notNull(),
		productLineId: text("product_line_id")
			.references(() => brandProductLines.id, { onDelete: "cascade" })
			.notNull(),
		name: text("name").notNull(),
		model: text("model"),
		oneLiner: text("one_liner"),
		position: smallint("position").default(0).notNull(),
		/** M1 evidence.ts L1 校验：URL 属抓取页集合（normalize 后）；L2：SKU name grep 此 URL 文本 */
		evidenceUrl: text("evidence_url"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => ({
		productLineIdIdx: index("brand_product_skus_product_line_id_idx").on(table.productLineId, table.position),
		brandIdIdx: index("brand_product_skus_brand_id_idx").on(table.brandId),
	}),
).enableRLS();

export type BrandProductSku = typeof brandProductSkus.$inferSelect;
export type NewBrandProductSku = typeof brandProductSkus.$inferInsert;

export type Brand = typeof brands.$inferSelect;
export type NewBrand = typeof brands.$inferInsert;

export type Prompt = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;

export type Competitor = typeof competitors.$inferSelect;
export type NewCompetitor = typeof competitors.$inferInsert;

export type PromptRun = typeof promptRuns.$inferSelect;
export type NewPromptRun = typeof promptRuns.$inferInsert;

export type BrandWithPrompts = Brand & {
	prompts: Prompt[];
	competitors: Competitor[];
};

export type CitationRecord = typeof citations.$inferSelect;
export type NewCitationRecord = typeof citations.$inferInsert;

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;

export const SYSTEM_TAGS = {
	BRANDED: "branded",
	UNBRANDED: "unbranded",
} as const;

export type SystemTag = (typeof SYSTEM_TAGS)[keyof typeof SYSTEM_TAGS];

// Encrypted overrides for credential environment variables, keyed by the env-var
// name they stand in for. Separate table, strictest access.
export const secrets = pgTable("secrets", {
	name: text("name").primaryKey().notNull(),
	encryptedValue: text("encrypted_value").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
}).enableRLS();
