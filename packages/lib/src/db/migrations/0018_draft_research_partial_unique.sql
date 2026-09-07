-- Epic A-2 (V1.0) M2: 修正 migration 0017 唯一索引（partial unique）
-- 设计：D:\NegencyWiki\概念\项目管理\GEO\GEO-V2品牌研究管道-设计-20260906.md v1.0
-- 排期：M2 (deadline 2026-09-08 12:00)
--
-- 修正原因：0017 唯一索引 (brand_id, url_hash) 全态唯一会挡历史行后重跑
-- （applied/rolled_back 行占位 → 用户重跑同 URL 研究时报 23505 unique violation）
--
-- 修正方案：唯一索引改为 partial unique：仅约束 active 态（pending_review + confirmed）
-- 终态（applied/done/failed/rolled_back）允许多行（历史归档/可追溯）
-- 注：failed 行允许重复是设计意图——重试覆盖语义（先 deleteFailed 后 insert）

DROP INDEX IF EXISTS "draft_research_brand_id_url_hash_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "draft_research_brand_id_url_hash_active_idx"
	ON "draft_research" ("brand_id", "url_hash")
	WHERE "state" IN ('pending_review', 'confirmed');

-- 索引名同步更新（应用层 getIndex 引用需注意）
EOF
