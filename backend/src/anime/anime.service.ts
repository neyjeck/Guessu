import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Anime, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
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

export interface CharacterSearchResult {
  id: number;
  name: string;
  imageUrl: string;
  animeTitle?: string;
}

const ANILIST_CHARACTER_SEARCH_QUERY = `
query ($q: String) {
  Page(page: 1, perPage: 12) {
    characters(search: $q, sort: FAVOURITES_DESC) {
      id
      name {
        full
      }
      image {
        large
      }
      media(perPage: 1, sort: POPULARITY_DESC) {
        nodes {
          title {
            romaji
            english
          }
        }
      }
    }
  }
}
`;

@Injectable()
export class AnimeService {
  private readonly logger = new Logger(AnimeService.name);
  private static readonly DEFAULT_SEARCH_LIMIT = 15;
  private static readonly CHAR_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour in-memory
  private static readonly CHAR_REDIS_TTL_SECONDS = 24 * 60 * 60; // 24 hours Redis
  private readonly characterSearchCache = new Map<
    string,
    { expiresAt: number; data: CharacterSearchResult[] }
  >();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redisService?: RedisService,
  ) {}

  /**
   * Proxies anime character search to the public AniList GraphQL API with
   * two-tier caching (in-memory + Redis) so users can search and showcase
   * any anime character with portrait images and source anime title.
   */
  async searchCharacters(rawQuery: string): Promise<CharacterSearchResult[]> {
    const query = (rawQuery ?? '').trim();
    if (query.length < 2) {
      return [];
    }

    const cacheKey = query.toLowerCase();
    const now = Date.now();
    const memCached = this.characterSearchCache.get(cacheKey);
    if (memCached && memCached.expiresAt > now) {
      return memCached.data;
    }

    const redisKey = `anime:char_search:${cacheKey}`;
    if (this.redisService) {
      try {
        const rawCached = await this.redisService.getClient().get(redisKey);
        if (rawCached) {
          const parsed = JSON.parse(rawCached) as CharacterSearchResult[];
          if (Array.isArray(parsed)) {
            this.setCharacterMemoryCache(cacheKey, parsed);
            return parsed;
          }
        }
      } catch {
        // Proceed to AniList live fetch on Redis error
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'AnimeGuesser/1.0 (https://github.com/anime-guesser)',
        },
        body: JSON.stringify({
          query: ANILIST_CHARACTER_SEARCH_QUERY,
          variables: { q: query },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`AniList HTTP ${response.status}`);
      }

      const payload = (await response.json()) as {
        data?: {
          Page?: {
            characters?: Array<{
              id?: number;
              name?: { full?: string | null };
              image?: { large?: string | null };
              media?: {
                nodes?: Array<{
                  title?: {
                    romaji?: string | null;
                    english?: string | null;
                  };
                }>;
              };
            }>;
          };
        };
      };

      const characters = payload.data?.Page?.characters ?? [];
      const mapped: CharacterSearchResult[] = [];

      for (const char of characters) {
        const id = Number(char?.id);
        const name = char?.name?.full?.trim();
        const imageUrl = char?.image?.large?.trim();
        if (!Number.isInteger(id) || id <= 0 || !name || !imageUrl) {
          continue;
        }
        const mediaNode = char?.media?.nodes?.[0];
        const animeTitle =
          mediaNode?.title?.english?.trim() ||
          mediaNode?.title?.romaji?.trim() ||
          undefined;

        mapped.push({
          id,
          name,
          imageUrl,
          ...(animeTitle ? { animeTitle } : {}),
        });
      }

      this.setCharacterMemoryCache(cacheKey, mapped);
      if (this.redisService && mapped.length > 0) {
        try {
          await this.redisService
            .getClient()
            .set(
              redisKey,
              JSON.stringify(mapped),
              'EX',
              AnimeService.CHAR_REDIS_TTL_SECONDS,
            );
        } catch {
          // Ignore Redis cache write error
        }
      }

      return mapped;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `AniList character search failed for query="${query}": ${msg}`,
      );
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  private setCharacterMemoryCache(
    key: string,
    data: CharacterSearchResult[],
  ): void {
    if (this.characterSearchCache.size >= 500) {
      const oldestKey = this.characterSearchCache.keys().next().value;
      if (oldestKey) {
        this.characterSearchCache.delete(oldestKey);
      }
    }
    this.characterSearchCache.set(key, {
      expiresAt: Date.now() + AnimeService.CHAR_CACHE_TTL_MS,
      data,
    });
  }

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
