-- DropIndex
DROP INDEX "Anime_synonyms_gin_idx";

-- DropIndex
DROP INDEX "Anime_titleEn_trgm_idx";

-- DropIndex
DROP INDEX "Anime_titleJa_trgm_idx";

-- DropIndex
DROP INDEX "Anime_titleRomaji_trgm_idx";

-- DropIndex
DROP INDEX "Anime_titleRu_trgm_idx";

-- DropIndex
DROP INDEX "Anime_titleUk_trgm_idx";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bio" TEXT,
ADD COLUMN     "favoriteAnime" JSONB,
ADD COLUMN     "favoriteCharacters" JSONB,
ADD COLUMN     "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "gamesWon" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isPublicProfile" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showFavorites" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showStats" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "theme" TEXT NOT NULL DEFAULT 'midnight';
