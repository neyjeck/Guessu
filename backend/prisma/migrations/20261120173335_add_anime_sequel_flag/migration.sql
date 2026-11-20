-- AlterTable: Add franchise sequel flag and root AniList ID for root-only selection and forgiving guessing
ALTER TABLE "Anime"
  ADD COLUMN "isSequel" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "rootAnilistId" INTEGER;

-- Immediately flag obvious sequel/season titles in existing catalog rows before full AniList relation sync
UPDATE "Anime"
SET "isSequel" = TRUE
WHERE
  COALESCE("titleRomaji", '') ~* '(\mSeason\s+([2-9]|[0-9]{2,})\M|\m(2nd|3rd|[4-9]th|[0-9]{2,}th)\s+Season\M|\mPart\s+([2-9]|[0-9]{2,})\M|\mCour\s+([2-9]|[0-9]{2,})\M|\mFinal\s+Season\M|\m(2nd|3rd|[4-9]th)\s+Stage\M)'
  OR COALESCE("titleEn", '') ~* '(\mSeason\s+([2-9]|[0-9]{2,})\M|\m(2nd|3rd|[4-9]th|[0-9]{2,}th)\s+Season\M|\mPart\s+([2-9]|[0-9]{2,})\M|\mCour\s+([2-9]|[0-9]{2,})\M|\mFinal\s+Season\M|\m(2nd|3rd|[4-9]th)\s+Stage\M)'
  OR COALESCE("titleRomaji", '') ~ '(\s|:)(II|III|IV)(\s*$|\s*[:\-])'
  OR COALESCE("titleEn", '') ~ '(\s|:)(II|III|IV)(\s*$|\s*[:\-])';

-- CreateIndex
CREATE INDEX "Anime_isSequel_idx" ON "Anime"("isSequel");
