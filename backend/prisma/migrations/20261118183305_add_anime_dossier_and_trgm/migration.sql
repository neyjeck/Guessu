-- Enable pg_trgm extension for multilingual fuzzy and substring search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AlterTable: Replace static clues with rich scraped dossier
ALTER TABLE "Anime" DROP COLUMN IF EXISTS "clues",
ADD COLUMN "dossier" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "Anime" ALTER COLUMN "dossier" DROP DEFAULT;

-- CreateIndex: GIN trigram indexes on localized title columns & GIN index on synonyms
CREATE INDEX IF NOT EXISTS "Anime_titleRomaji_trgm_idx" ON "Anime" USING GIN ("titleRomaji" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Anime_titleEn_trgm_idx" ON "Anime" USING GIN ("titleEn" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Anime_titleJa_trgm_idx" ON "Anime" USING GIN ("titleJa" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Anime_titleUk_trgm_idx" ON "Anime" USING GIN ("titleUk" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Anime_titleRu_trgm_idx" ON "Anime" USING GIN ("titleRu" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Anime_synonyms_gin_idx" ON "Anime" USING GIN ("synonyms");
