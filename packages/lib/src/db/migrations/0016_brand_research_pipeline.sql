-- Epic A-2 品牌研究管道（M1：schema 扩展 + product_skus 新表）
-- 设计：D:\NegencyWiki\概念\项目管理\GEO\GEO-V2品牌研究管道-设计-20260906.md v1.0
-- 排期：hill 拍板 2026-09-06
--
-- 内容：
-- 1) brands 表加 summary（定位一句话）+ description（简介 ~500 字）—— 来源 LLM analyzeBrand
-- 2) brand_product_skus 新表（产品线→SKU 层级，evidence_url 列防幻觉）

-- 1) brands 表加 2 列
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "summary" text;
-- ① 一句话定位（"中国领先的高端家电品牌"）→ 来源 LLM analyzeBrand

ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "description" text;
-- ① 简介 ~500 字（业务/产品/市场/历史摘要）→ 来源 LLM analyzeBrand

-- 2) brand_product_skus 新表（产品线→SKU 层级）
CREATE TABLE IF NOT EXISTS "brand_product_skus" (
	"id" text PRIMARY KEY,
	"brand_id" text NOT NULL REFERENCES "brands"("id") ON DELETE CASCADE,
	"product_line_id" text NOT NULL REFERENCES "brand_product_lines"("id") ON DELETE CASCADE,
	"name" text NOT NULL,
	"model" text,
	"one_liner" text,
	"position" smallint DEFAULT 0 NOT NULL,
	"evidence_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "brand_product_skus_product_line_id_idx"
	ON "brand_product_skus" ("product_line_id", "position");
CREATE INDEX IF NOT EXISTS "brand_product_skus_brand_id_idx"
	ON "brand_product_skus" ("brand_id");

DROP TRIGGER IF EXISTS update_brand_product_skus_updated_at ON "brand_product_skus";
CREATE TRIGGER update_brand_product_skus_updated_at
	BEFORE UPDATE ON "brand_product_skus"
	FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE "brand_product_skus" ENABLE ROW LEVEL SECURITY;

-- competitors / prompts 0 改动（已支持 aliases / domains / market P0-3）
-- 注意：0015 已包含 brand_product_lines + brand_credentials，本 migration 加 SKU 层级
