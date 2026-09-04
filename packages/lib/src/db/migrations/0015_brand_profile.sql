-- Epic A-1 品牌档案（产品线 + 资质背书）
-- 数据模型：US-A02 (product lines) + US-A03 (credentials) + US-A05 (completeness)
-- 排期：v1.1 定稿（hill 拍板 2026-09-04）

-- brand_product_lines：产品线（差异化卖点 = 事实校验基准主体）
CREATE TABLE IF NOT EXISTS "brand_product_lines" (
	"id" text PRIMARY KEY,
	"brand_id" text NOT NULL REFERENCES "brands"("id") ON DELETE CASCADE,
	"name" text NOT NULL,
	"category" text,
	"core_params" text,
	"differentiators" text NOT NULL,
	"target_audience" text,
	"position" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- brand_credentials：资质背书（第三方公开标记 = US-A03 核心）
CREATE TABLE IF NOT EXISTS "brand_credentials" (
	"id" text PRIMARY KEY,
	"brand_id" text NOT NULL REFERENCES "brands"("id") ON DELETE CASCADE,
	"cred_type" text NOT NULL,
	"name" text NOT NULL,
	"year" text,
	"is_third_party_public" boolean DEFAULT false NOT NULL,
	"url" text,
	"position" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- 索引：按 brand 过滤是高频查询路径
CREATE INDEX IF NOT EXISTS "brand_product_lines_brand_id_idx"
	ON "brand_product_lines" ("brand_id", "position");
CREATE INDEX IF NOT EXISTS "brand_credentials_brand_id_idx"
	ON "brand_credentials" ("brand_id", "position");
CREATE INDEX IF NOT EXISTS "brand_credentials_third_party_idx"
	ON "brand_credentials" ("brand_id")
	WHERE "is_third_party_public" = true;

-- updated_at trigger 复用 brands 表 trigger function（已存在）
DROP TRIGGER IF EXISTS update_brand_product_lines_updated_at ON "brand_product_lines";
CREATE TRIGGER update_brand_product_lines_updated_at
	BEFORE UPDATE ON "brand_product_lines"
	FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_brand_credentials_updated_at ON "brand_credentials";
CREATE TRIGGER update_brand_credentials_updated_at
	BEFORE UPDATE ON "brand_credentials"
	FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS：与现有表一致（elmo 走 service-role key 实际绕过 RLS；
-- 但 Drizzle .enableRLS() 标记使表符合预期安全模型）
ALTER TABLE "brand_product_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brand_credentials" ENABLE ROW LEVEL SECURITY;

-- updated_at CHECK 约束（防御性）：确保 updated_at >= created_at
-- 注意：跨行比较无法用 CHECK 约束，依赖 app 层 updateBrand etc 守卫
