ALTER TABLE "brand_opportunities" ADD COLUMN "language" text NOT NULL DEFAULT 'en';
CREATE INDEX "brand_opportunities_brand_id_language_created_at_idx" ON "brand_opportunities" ("brand_id", "language", "created_at");
