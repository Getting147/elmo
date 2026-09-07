-- Epic A-2 (V1.0) M2 c3-job-fix1: research_status 列加
-- 设计：GEO-V2品牌研究管道-设计-20260906.md v1.0
-- 排期：M2 (deadline 09-08 12:00)
--
-- 理由：payload 探测 hack 脆弱（空结果 vs 处理中无法区分）
-- 4 态机：queued（trigger 建 draft）→ running（job 开始）→ done（payload UPDATE 完成，state 仍=pending_review 等确认）→ failed（异常）
-- 注意：state（pending_review/confirmed/applied/done/failed/rolled_back）= 草稿状态机（确认/回滚）
--       research_status（queued/running/done/failed）= 异步 LLM 处理状态（仅触发与处理阶段，独立于 state）

ALTER TABLE "draft_research" ADD COLUMN IF NOT EXISTS "research_status" text NOT NULL DEFAULT 'queued';

DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'draft_research_research_status_check'
	) THEN
		ALTER TABLE "draft_research" ADD CONSTRAINT "draft_research_research_status_check" CHECK (
			"research_status" IN ('queued', 'running', 'done', 'failed')
		);
	END IF;
END $$;

-- 索引（监控/dashboard 用：按 brand + research_status 过滤 + 时间倒序）
CREATE INDEX IF NOT EXISTS "draft_research_brand_id_research_status_idx"
	ON "draft_research" ("brand_id", "research_status", "created_at" DESC);

-- 旧行已存在 DEFAULT 'queued'（migration 自动回填）
-- V1.1 dashboard 不在本 migration 范围
