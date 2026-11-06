ALTER TABLE "brand_product_lines" ADD COLUMN IF NOT EXISTS "research_evidence" jsonb;
--> statement-breakpoint
ALTER TABLE "brand_product_skus" ADD COLUMN IF NOT EXISTS "evidence_quote" text;
