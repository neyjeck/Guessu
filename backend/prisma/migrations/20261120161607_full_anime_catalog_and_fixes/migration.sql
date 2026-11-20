-- Ensure pg_trgm extension remains enabled for multilingual fuzzy & substring search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AlterTable: Support full 15,000+ anime catalog with lazy on-demand dossier enrichment
ALTER TABLE "Anime"
  ADD COLUMN "isEnriched" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "type" TEXT,
  ADD COLUMN "year" INTEGER,
  ALTER COLUMN "anilistId" DROP NOT NULL,
  ALTER COLUMN "titleRomaji" DROP NOT NULL,
  ALTER COLUMN "coverUrl" DROP NOT NULL,
  ALTER COLUMN "dossier" DROP NOT NULL;

-- Preserve enriched state for existing pre-seeded records that already have populated dossiers
UPDATE "Anime"
SET "isEnriched" = true
WHERE "dossier" IS NOT NULL
  AND "dossier"::text <> '{}'
  AND "dossier"::text <> 'null';

-- Ensure all pg_trgm GIN indexes on localized title columns and GIN index on synonyms remain active
CREATE INDEX IF NOT EXISTS "Anime_titleRomaji_trgm_idx" ON "Anime" USING GIN ("titleRomaji" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Anime_titleEn_trgm_idx" ON "Anime" USING GIN ("titleEn" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Anime_titleJa_trgm_idx" ON "Anime" USING GIN ("titleJa" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Anime_titleUk_trgm_idx" ON "Anime" USING GIN ("titleUk" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Anime_titleRu_trgm_idx" ON "Anime" USING GIN ("titleRu" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Anime_synonyms_gin_idx" ON "Anime" USING GIN ("synonyms");
