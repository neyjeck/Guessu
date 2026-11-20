-- AlterTable: Add AniList popularity score for streak-based difficulty progression
ALTER TABLE "Anime" ADD COLUMN "popularity" INTEGER NOT NULL DEFAULT 0;

-- Backfill popularity from existing enriched dossiers where available
UPDATE "Anime"
SET "popularity" = COALESCE(
  NULLIF("dossier"->>'popularity', '')::INTEGER,
  0
)
WHERE "dossier" IS NOT NULL
  AND ("dossier"->>'popularity') ~ '^[0-9]+$';

-- CreateIndex
CREATE INDEX "Anime_popularity_idx" ON "Anime"("popularity");
