-- P0-3: 目标市场（market）快照 + 注入后完整 prompt 文本存证
-- market: TEXT NULL（us/uk/de/fr/jp/ca/au + NULL=不限；DB 层不锁枚举，zod 校验层锁定）
-- injected_value: TEXT NULL（仅 prompt_runs；存实际发送给 provider 的完整字符串，含市场前缀）
-- 设计：market 是运行时参数，不是 prompt 模板内容
--       prompts.value 库值保持原始模板不变，market 在 provider 调用层注入
--       prompt_runs.injected_value 存注入后完整串供追溯

ALTER TABLE "prompts" ADD COLUMN IF NOT EXISTS "market" TEXT NULL;
ALTER TABLE "prompt_runs" ADD COLUMN IF NOT EXISTS "market" TEXT NULL;
ALTER TABLE "prompt_runs" ADD COLUMN IF NOT EXISTS "injected_value" TEXT NULL;
ALTER TABLE "citations" ADD COLUMN IF NOT EXISTS "market" TEXT NULL;

-- 索引：按 brand + market 分桶查（NegencyGEO 报告层 + 按市场统计）
CREATE INDEX IF NOT EXISTS "prompts_brand_id_market_idx"
	ON "prompts" ("brand_id", "market")
	WHERE "market" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "prompt_runs_brand_id_market_idx"
	ON "prompt_runs" ("brand_id", "market", "created_at")
	WHERE "market" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "prompt_runs_prompt_id_market_idx"
	ON "prompt_runs" ("prompt_id", "market")
	WHERE "market" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "citations_brand_id_market_idx"
	ON "citations" ("brand_id", "market", "created_at")
	WHERE "market" IS NOT NULL;

-- RLS policy 兼容：原 policies 已覆盖 * 全部列，新列自动继承（无需追加）
-- （如未来需按 market 收紧 → 单独发 0015_rls_market.sql）
