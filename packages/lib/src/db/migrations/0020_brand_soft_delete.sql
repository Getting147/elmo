-- Brand soft delete (V1): 删除 = 停止展示 + 停止自动扫描, 历史数据保留
-- 拍板：Owner 2026-09-07（"删除意味着停止展示，停止自动扫描。历史数据可以留着"）
--
-- 内容：
-- 1) brands 表加 deleted_at（NULL = 活跃；非 NULL = 已删除/隐藏）
-- 2) 删除动作 = SET deleted_at = now() + enabled = false（双保险：调度只认 enabled）

ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;
