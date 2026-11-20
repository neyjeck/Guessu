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
   * Performs fast, NULL-safe multilingual autocomplete across the 15,000+ anime catalog.
   * Combines case-insensitive substring matching (`ILIKE '%query%'`) with PostgreSQL
   * `pg_trgm` trigram similarity (`SIMILARITY(...) > 0.15`) across all localized title
   * columns and `synonyms` (`array_to_string(synonyms, ' ')`), ranking:
   *   1) Exact prefix matches (`ILIKE 'query%'`) first
   *   2) Substring matches (`ILIKE '%query%'`, including synonyms) second
   *   3) Highest trigram similarity third
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
          a."year"
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
          GREATEST(
            SIMILARITY(COALESCE(a."titleEn", ''), ${query}),
            SIMILARITY(COALESCE(a."titleRomaji", ''), ${query}),
            SIMILARITY(COALESCE(a."titleUk", ''), ${query}),
            SIMILARITY(COALESCE(a."titleRu", ''), ${query}),
            SIMILARITY(COALESCE(a."titleJa", ''), ${query}),
            SIMILARITY(COALESCE(array_to_string(a."synonyms", ' '), ''), ${query})
          ) DESC,
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
        },
        take: limit,
      });
    }
  }

  /**
   * Selects a random anime across the full catalog requiring non-null `coverUrl`
   * and `anilistId`, excluding recently played IDs passed in `excludeIds`.
   */
  async getRandomAnime(excludeIds: Array<string | number> = []): Promise<Anime> {
    const parsedExcludeIds = excludeIds
      .map((rawId) =>
        typeof rawId === 'number' ? rawId : Number.parseInt(String(rawId), 10),
      )
      .filter((id) => Number.isInteger(id) && id > 0);

    const baseEligibleWhere: Prisma.AnimeWhereInput = {
      coverUrl: { not: null },
      NOT: { coverUrl: '' },
      anilistId: { not: null },
    };

    const whereClause: Prisma.AnimeWhereInput =
      parsedExcludeIds.length > 0
        ? {
            ...baseEligibleWhere,
            id: { notIn: parsedExcludeIds },
          }
        : baseEligibleWhere;

    let eligibleCount = await this.prisma.anime.count({ where: whereClause });
    let activeWhere: Prisma.AnimeWhereInput = whereClause;

    // Fallback to all eligible catalog records if every eligible entry was excluded
    if (eligibleCount === 0) {
      eligibleCount = await this.prisma.anime.count({
        where: baseEligibleWhere,
      });
      activeWhere = baseEligibleWhere;
    }

    if (eligibleCount === 0) {
      throw new BadRequestException(
        'No eligible anime entries available in database. Import the catalog first.',
      );
    }

    const randomOffset = Math.floor(Math.random() * eligibleCount);
    const [randomAnime] = await this.prisma.anime.findMany({
      where: activeWhere,
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
      },
    });
    if (!anime) {
      throw new NotFoundException(`Anime with ID ${id} not found`);
    }
    return anime;
  }
}
