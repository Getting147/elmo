-- Epic A-2 (V1.0): draft_research 草稿表（M2 草稿状态机 + 研究端点）
-- 设计：D:\NegencyWiki\概念\项目管理\GEO\GEO-V2品牌研究管道-设计-20260906.md v1.0
-- 排期：M2 (deadline 2026-09-08 12:00)
--
-- 状态机：pending_review → confirmed → applied → done / failed / rolled_back
-- idempotency：同 brand_id + url_hash 命中现有 pending_review/confirmed 草稿
-- payload JSONB：OnboardingSuggestion 完整快照（summary/description/productLines confirmed+unverified/competitors/prompts）
--
-- 与 brands 解耦：draft 仅快照 LLM 输出，确认后 populate brands/competitors/prompts/brand_product_lines/brand_product_skus

CREATE TABLE IF NOT EXISTS "draft_research" (
	"id" text PRIMARY KEY,
	"brand_id" text NOT NULL REFERENCES "brands"("id") ON DELETE CASCADE,
	"url_hash" text NOT NULL,                              -- idempotency key: SHA256(normalizedURL).slice(0,16)
	"state" text NOT NULL DEFAULT 'pending_review',       -- 5 态 enum (CHECK 约束)
	"payload" jsonb NOT NULL,                             -- OnboardingSuggestion 完整快照
	"error" text,                                          -- 失败时错误原因
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,        -- 30 天默认（V1 仅查过滤不强制后台归档）
	CONSTRAINT "draft_research_state_check" CHECK (
		"state" IN ('pending_review', 'confirmed', 'applied', 'done', 'failed', 'rolled_back')
	)
);

-- 唯一性：同 brand_id + url_hash 仅 1 个 active 草稿（idempotency 强约束）
-- 注：url_hash 重复时 INSERT 失败，由应用层捕获 PG unique violation → 查现有草稿
CREATE UNIQUE INDEX IF NOT EXISTS "draft_research_brand_id_url_hash_idx"
	ON "draft_research" ("brand_id", "url_hash");

-- 列表查询索引（按 brand + 状态过滤 + 时间倒序）
CREATE INDEX IF NOT EXISTS "draft_research_brand_id_state_idx"
	ON "draft_research" ("brand_id", "state", "created_at" DESC);

-- 全局状态查询（监控/dashboard 用）
CREATE INDEX IF NOT EXISTS "draft_research_state_idx"
	ON "draft_research" ("state", "created_at" DESC);

-- expires_at 检查（V1.1 后台归档任务会扫描 state=pending_review AND expires_at < now()）
-- V1 不创建后台归档 cron，应用层查列表时 WHERE expires_at > now()

-- updated_at trigger（复用 brands 表 trigger function）
DROP TRIGGER IF EXISTS update_draft_research_updated_at ON "draft_research";
CREATE TRIGGER update_draft_research_updated_at
	BEFORE UPDATE ON "draft_research"
	FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE "draft_research" ENABLE ROW LEVEL SECURITY;

-- 与 0015/0016 表关系：draft_research 仅引用 brands.id（FK CASCADE）
-- 不引用 brand_product_lines / brand_credentials / prompts / competitors（避免链式 cascade 与 brand 错位）
-- 确认后灌库由应用层（saveWizardOnboarding）populate 这些表（与 M1 onboarding-core 复用）
