-- P0-1: 落库前从 LLM 输出后置提取 answer_rank + answer_type
-- answer_rank: SMALLINT NULL (1..N 品牌出现位次, NULL=品牌未出现)
-- answer_type: TEXT NULL (list | comparison | recommendation | NULL=非列举类不入分母)

ALTER TABLE "prompt_runs" ADD COLUMN "answer_rank" SMALLINT NULL;
ALTER TABLE "prompt_runs" ADD COLUMN "answer_type" TEXT NULL;

-- 索引: 节点②/④按 answer_type 过滤列举类 + 按 answer_rank 排序
CREATE INDEX "prompt_runs_brand_id_answer_type_answer_rank_idx"
	ON "prompt_runs" ("brand_id", "answer_type", "answer_rank")
	WHERE "answer_type" IS NOT NULL AND "answer_rank" IS NOT NULL;
