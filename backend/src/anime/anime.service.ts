import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Anime, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SearchAnimeDto } from './dto/search-anime.dto';

export interface AnimeSearchResult {
  id: number;
  anilistId: number | null;
  titleEn: string | null;
  titleRomaji: string | null;
  titleJa: string | null;
  titleUk: string | null;
  titleRu: string | null;
  synonyms: string[];
  coverUrl: string | null;
  type?: string | null;
  year?: number | null;
  isSequel?: boolean;
  rootAnilistId?: number | null;
}

@Injectable()
export class AnimeService {
  private readonly logger = new Logger(AnimeService.name);
  private static readonly DEFAULT_SEARCH_LIMIT = 15;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Convenience wrapper accepting a raw query string (defaults to top 15 results).
   */
  async search(
    query: string,
    limit: number = AnimeService.DEFAULT_SEARCH_LIMIT,
  ): Promise<AnimeSearchResult[]> {
    return this.searchMultilingual({ q: query, limit });
  }

  /**
   * Performs fast, NULL-safe multilingual autocomplete across the 30,000+ anime catalog.
   * Combines case-insensitive substring matching (`ILIKE '%query%'`) with PostgreSQL
   * `pg_trgm` trigram similarity (`SIMILARITY(...) > 0.15`) across all localized title
   * columns and `synonyms`, ranking:
   *   1) Exact title matches first, prefix matches second, substring matches third, fuzzy fourth
   *   2) Base/root franchise entries (`isSequel = FALSE`) above sequels/parts within each tier
   *   3) Highest trigram similarity and popularity descending
   */
  async searchMultilingual(dto: SearchAnimeDto): Promise<AnimeSearchResult[]> {
    const query = (dto.q ?? '').trim();
    const limit = dto.limit ?? AnimeService.DEFAULT_SEARCH_LIMIT;

    if (query.length < 2) {
      return [];
    }

    const prefixPattern = `${query}%`;
    const substringPattern = `%${query}%`;

    try {
      const results = await this.prisma.$queryRaw<AnimeSearchResult[]>`
        SELECT
          a."id",
          a."anilistId",
          a."titleEn",
          a."titleRomaji",
          a."titleJa",
          a."titleUk",
          a."titleRu",
          a."synonyms",
          a."coverUrl",
          a."type",
          a."year",
          a."isSequel",
          a."rootAnilistId"
        FROM "Anime" a
        WHERE
          COALESCE(a."titleEn", '') ILIKE ${substringPattern}
          OR COALESCE(a."titleRomaji", '') ILIKE ${substringPattern}
          OR COALESCE(a."titleUk", '') ILIKE ${substringPattern}
          OR COALESCE(a."titleRu", '') ILIKE ${substringPattern}
          OR COALESCE(a."titleJa", '') ILIKE ${substringPattern}
          OR COALESCE(array_to_string(a."synonyms", ' '), '') ILIKE ${substringPattern}
          OR SIMILARITY(COALESCE(a."titleEn", ''), ${query}) > 0.15
          OR SIMILARITY(COALESCE(a."titleRomaji", ''), ${query}) > 0.15
          OR SIMILARITY(COALESCE(a."titleUk", ''), ${query}) > 0.15
          OR SIMILARITY(COALESCE(a."titleRu", ''), ${query}) > 0.15
          OR SIMILARITY(COALESCE(a."titleJa", ''), ${query}) > 0.15
          OR SIMILARITY(COALESCE(array_to_string(a."synonyms", ' '), ''), ${query}) > 0.15
        ORDER BY
          CASE
            WHEN LOWER(COALESCE(a."titleEn", '')) = LOWER(${query})
              OR LOWER(COALESCE(a."titleRomaji", '')) = LOWER(${query})
              OR LOWER(COALESCE(a."titleUk", '')) = LOWER(${query})
              OR LOWER(COALESCE(a."titleRu", '')) = LOWER(${query})
              OR LOWER(COALESCE(a."titleJa", '')) = LOWER(${query})
            THEN 3
            WHEN COALESCE(a."titleEn", '') ILIKE ${prefixPattern}
              OR COALESCE(a."titleRomaji", '') ILIKE ${prefixPattern}
              OR COALESCE(a."titleUk", '') ILIKE ${prefixPattern}
              OR COALESCE(a."titleRu", '') ILIKE ${prefixPattern}
              OR COALESCE(a."titleJa", '') ILIKE ${prefixPattern}
            THEN 2
            WHEN COALESCE(a."titleEn", '') ILIKE ${substringPattern}
              OR COALESCE(a."titleRomaji", '') ILIKE ${substringPattern}
              OR COALESCE(a."titleUk", '') ILIKE ${substringPattern}
              OR COALESCE(a."titleRu", '') ILIKE ${substringPattern}
              OR COALESCE(a."titleJa", '') ILIKE ${substringPattern}
              OR COALESCE(array_to_string(a."synonyms", ' '), '') ILIKE ${substringPattern}
            THEN 1
            ELSE 0
          END DESC,
          CASE WHEN a."isSequel" = FALSE THEN 1 ELSE 0 END DESC,
          GREATEST(
            SIMILARITY(COALESCE(a."titleEn", ''), ${query}),
            SIMILARITY(COALESCE(a."titleRomaji", ''), ${query}),
            SIMILARITY(COALESCE(a."titleUk", ''), ${query}),
            SIMILARITY(COALESCE(a."titleRu", ''), ${query}),
            SIMILARITY(COALESCE(a."titleJa", ''), ${query}),
            SIMILARITY(COALESCE(array_to_string(a."synonyms", ' '), ''), ${query})
          ) DESC,
          a."popularity" DESC,
          a."id" ASC
        LIMIT ${limit};
      `;
      return results;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Raw pg_trgm search failed for query="${query}", falling back to Prisma ILIKE: ${msg}`,
      );
      return this.prisma.anime.findMany({
        where: {
          OR: [
            { titleRomaji: { contains: query, mode: 'insensitive' } },
            { titleEn: { contains: query, mode: 'insensitive' } },
            { titleJa: { contains: query, mode: 'insensitive' } },
            { titleUk: { contains: query, mode: 'insensitive' } },
            { titleRu: { contains: query, mode: 'insensitive' } },
            { synonyms: { has: query } },
          ],
        },
        orderBy: [{ isSequel: 'asc' }, { popularity: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          anilistId: true,
          titleEn: true,
          titleRomaji: true,
          titleJa: true,
          titleUk: true,
          titleRu: true,
          synonyms: true,
          coverUrl: true,
          type: true,
          year: true,
          isSequel: true,
          rootAnilistId: true,
        },
        take: limit,
      });
    }
  }

  /**
   * Maps a player's current streak to the maximum top-popularity catalog pool size:
   *  - streak < 4  (Rounds 1–4):   top 100 mainstream root TV/MOVIE hits (`popularity > 0`)
   *  - streak < 10 (Rounds 5–10):  top 400 mainstream root TV/MOVIE hits (`popularity > 0`)
   *  - streak < 20 (Rounds 11–20): top 1,500 ranked root titles (`popularity > 0`)
   *  - streak >= 20:               entire 30,000+ eligible root catalog (`null` = uncapped)
   */
  getPopularityPoolLimit(currentStreak: number): number | null {
    if (currentStreak < 4) return 100;
    if (currentStreak < 10) return 400;
    if (currentStreak < 20) return 1500;
    return null;
  }

  /**
   * Selects a random eligible root/base anime (`isSequel: false`, non-null `coverUrl`
   * and `anilistId`) ordered by `popularity DESC` within a strict streak-scaled mainstream
   * difficulty pool while excluding `excludeIds` (the last 30 played anime IDs).
   *
   * Never picks sequels, Season 2+, Part 2+, or Final Season entries.
   */
  async getRandomAnime(
    excludeIds: Array<string | number> = [],
    currentStreak = 0,
  ): Promise<Anime> {
    const parsedExcludeIds = excludeIds
      .map((rawId) =>
        typeof rawId === 'number' ? rawId : Number.parseInt(String(rawId), 10),
      )
      .filter((id) => Number.isInteger(id) && id > 0);

    const baseEligibleWhere: Prisma.AnimeWhereInput = {
      coverUrl: { not: null },
      NOT: { coverUrl: '' },
      anilistId: { not: null },
      isSequel: false,
    };

    const withExclusions = (
      where: Prisma.AnimeWhereInput,
    ): Prisma.AnimeWhereInput =>
      parsedExcludeIds.length > 0
        ? { ...where, id: { notIn: parsedExcludeIds } }
        : where;

    const poolLimit = this.getPopularityPoolLimit(currentStreak);
    const requiresPopularity = currentStreak < 20;
    const requiresMainstreamFormat = currentStreak < 10;

    // Build ordered candidate filter stages from strictest to most permissive fallback
    // (all stages strictly enforce `isSequel: false`)
    const candidateStages: Prisma.AnimeWhereInput[] = [];

    if (requiresPopularity && requiresMainstreamFormat) {
      const mainstreamRanked: Prisma.AnimeWhereInput = {
        ...baseEligibleWhere,
        popularity: { gt: 0 },
        type: { in: ['TV', 'MOVIE'] },
      };
      candidateStages.push(withExclusions(mainstreamRanked));
      candidateStages.push(mainstreamRanked);
    }

    if (requiresPopularity) {
      const anyRanked: Prisma.AnimeWhereInput = {
        ...baseEligibleWhere,
        popularity: { gt: 0 },
      };
      candidateStages.push(withExclusions(anyRanked));
      candidateStages.push(anyRanked);

      // Graceful fallback when popularity scores haven't been synced yet:
      // prefer well-known localized root titles (titleUk or titleRu populated)
      const localizedFallback: Prisma.AnimeWhereInput = {
        ...baseEligibleWhere,
        ...(requiresMainstreamFormat ? { type: { in: ['TV', 'MOVIE'] } } : {}),
        OR: [{ titleUk: { not: null } }, { titleRu: { not: null } }],
      };
      candidateStages.push(withExclusions(localizedFallback));
      candidateStages.push(localizedFallback);
    }

    candidateStages.push(withExclusions(baseEligibleWhere));
    candidateStages.push(baseEligibleWhere);

    let activeWhere: Prisma.AnimeWhereInput | null = null;
    let eligibleCount = 0;

    for (const stageWhere of candidateStages) {
      const count = await this.prisma.anime.count({ where: stageWhere });
      if (count > 0) {
        activeWhere = stageWhere;
        eligibleCount = count;
        break;
      }
    }

    if (!activeWhere || eligibleCount === 0) {
      throw new BadRequestException(
        'No eligible root anime entries available in database. Import the catalog first.',
      );
    }

    const effectivePoolSize =
      poolLimit !== null ? Math.min(eligibleCount, poolLimit) : eligibleCount;

    const randomOffset = Math.floor(Math.random() * effectivePoolSize);
    const [randomAnime] = await this.prisma.anime.findMany({
      where: activeWhere,
      orderBy: [{ popularity: 'desc' }, { id: 'asc' }],
      skip: randomOffset,
      take: 1,
    });

    return randomAnime;
  }

  async findPublicById(id: number): Promise<AnimeSearchResult> {
    const anime = await this.prisma.anime.findUnique({
      where: { id },
      select: {
        id: true,
        anilistId: true,
        titleEn: true,
        titleRomaji: true,
        titleJa: true,
        titleUk: true,
        titleRu: true,
        synonyms: true,
        coverUrl: true,
        type: true,
        year: true,
        isSequel: true,
        rootAnilistId: true,
      },
    });
    if (!anime) {
      throw new NotFoundException(`Anime with ID ${id} not found`);
    }
    return anime;
  }
}
