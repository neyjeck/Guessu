import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Anime } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SearchAnimeDto } from './dto/search-anime.dto';

export interface AnimeSearchResult {
  id: number;
  anilistId: number;
  titleEn: string | null;
  titleRomaji: string;
  titleJa: string | null;
  titleUk: string | null;
  titleRu: string | null;
  synonyms: string[];
  coverUrl: string;
}

@Injectable()
export class AnimeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Performs fast case-insensitive substring (ILIKE '%q%') + trigram similarity (pg_trgm)
   * matching across titleEn, titleRomaji, titleUk, titleRu, titleJa, and synonyms.
   * Prefix and substring matches are ranked above fuzzy trigram matches so typing
   * e.g. "guil" immediately ranks "Guilty Crown" at the top.
   */
  async searchMultilingual(dto: SearchAnimeDto): Promise<AnimeSearchResult[]> {
    const query = (dto.q ?? '').trim();
    const limit = dto.limit ?? 10;

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
          a."coverUrl"
        FROM "Anime" a
        WHERE
          a."titleRomaji" ILIKE ${substringPattern}
          OR COALESCE(a."titleEn", '') ILIKE ${substringPattern}
          OR COALESCE(a."titleUk", '') ILIKE ${substringPattern}
          OR COALESCE(a."titleRu", '') ILIKE ${substringPattern}
          OR COALESCE(a."titleJa", '') ILIKE ${substringPattern}
          OR EXISTS (
            SELECT 1 FROM unnest(a."synonyms") AS syn
            WHERE syn ILIKE ${substringPattern} OR SIMILARITY(syn, ${query}) > 0.25
          )
          OR SIMILARITY(a."titleRomaji", ${query}) > 0.2
          OR SIMILARITY(COALESCE(a."titleEn", ''), ${query}) > 0.2
          OR SIMILARITY(COALESCE(a."titleUk", ''), ${query}) > 0.2
          OR SIMILARITY(COALESCE(a."titleRu", ''), ${query}) > 0.2
          OR WORD_SIMILARITY(${query}, a."titleRomaji") > 0.35
          OR WORD_SIMILARITY(${query}, COALESCE(a."titleEn", '')) > 0.35
          OR WORD_SIMILARITY(${query}, COALESCE(a."titleUk", '')) > 0.35
          OR WORD_SIMILARITY(${query}, COALESCE(a."titleRu", '')) > 0.35
        ORDER BY
          (
            CASE
              WHEN COALESCE(a."titleEn", '') ILIKE ${prefixPattern}
                OR a."titleRomaji" ILIKE ${prefixPattern}
                OR COALESCE(a."titleUk", '') ILIKE ${prefixPattern}
                OR COALESCE(a."titleRu", '') ILIKE ${prefixPattern}
                OR COALESCE(a."titleJa", '') ILIKE ${prefixPattern}
              THEN 2.0
              WHEN COALESCE(a."titleEn", '') ILIKE ${substringPattern}
                OR a."titleRomaji" ILIKE ${substringPattern}
                OR COALESCE(a."titleUk", '') ILIKE ${substringPattern}
                OR COALESCE(a."titleRu", '') ILIKE ${substringPattern}
                OR COALESCE(a."titleJa", '') ILIKE ${substringPattern}
                OR EXISTS (
                  SELECT 1 FROM unnest(a."synonyms") AS syn
                  WHERE syn ILIKE ${substringPattern}
                )
              THEN 1.0
              ELSE 0.0
            END
          ) + GREATEST(
            SIMILARITY(a."titleRomaji", ${query}),
            SIMILARITY(COALESCE(a."titleEn", ''), ${query}),
            SIMILARITY(COALESCE(a."titleUk", ''), ${query}),
            SIMILARITY(COALESCE(a."titleRu", ''), ${query}),
            WORD_SIMILARITY(${query}, a."titleRomaji"),
            WORD_SIMILARITY(${query}, COALESCE(a."titleEn", '')),
            WORD_SIMILARITY(${query}, COALESCE(a."titleUk", '')),
            WORD_SIMILARITY(${query}, COALESCE(a."titleRu", ''))
          ) DESC,
          a."id" ASC
        LIMIT ${limit};
      `;
      return results;
    } catch {
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
        },
        take: limit,
      });
    }
  }

  /**
   * Selects a completely random anime from the database excluding only the
   * recently played IDs passed in excludeIds (no rigid popularity tier restrictions).
   */
  async getRandomAnime(excludeIds: Array<string | number> = []): Promise<Anime> {
    const parsedExcludeIds = excludeIds
      .map((rawId) =>
        typeof rawId === 'number' ? rawId : Number.parseInt(String(rawId), 10),
      )
      .filter((id) => Number.isInteger(id) && id > 0);

    const whereClause =
      parsedExcludeIds.length > 0 ? { id: { notIn: parsedExcludeIds } } : {};

    let eligibleCount = await this.prisma.anime.count({ where: whereClause });
    let activeWhere: { id?: { notIn: number[] } } = whereClause;

    // Fallback to all anime if every entry in the DB was excluded
    if (eligibleCount === 0) {
      eligibleCount = await this.prisma.anime.count();
      activeWhere = {};
    }

    if (eligibleCount === 0) {
      throw new BadRequestException(
        'No anime entries available in database. Seed the database first.',
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
      },
    });
    if (!anime) {
      throw new NotFoundException(`Anime with ID ${id} not found`);
    }
    return anime;
  }
}
