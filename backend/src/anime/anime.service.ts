import { Injectable, NotFoundException } from '@nestjs/common';
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
  coverUrl: string;
}

@Injectable()
export class AnimeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Performs multilingual fuzzy search across English, Romaji, Japanese,
   * Ukrainian, Russian titles, and synonyms using PostgreSQL pg_trgm similarity
   * with ILIKE fallback.
   */
  async searchMultilingual(dto: SearchAnimeDto): Promise<AnimeSearchResult[]> {
    const query = dto.q.trim();
    const limit = dto.limit ?? 8;

    if (!query) {
      return [];
    }

    try {
      const results = await this.prisma.$queryRaw<AnimeSearchResult[]>`
        SELECT
          "id",
          "anilistId",
          "titleEn",
          "titleRomaji",
          "titleJa",
          "titleUk",
          "titleRu",
          "coverUrl"
        FROM "Anime"
        WHERE
          "titleRomaji" ILIKE '%' || ${query} || '%'
          OR COALESCE("titleEn", '') ILIKE '%' || ${query} || '%'
          OR COALESCE("titleJa", '') ILIKE '%' || ${query} || '%'
          OR COALESCE("titleUk", '') ILIKE '%' || ${query} || '%'
          OR COALESCE("titleRu", '') ILIKE '%' || ${query} || '%'
          OR SIMILARITY("titleRomaji", ${query}) > 0.2
          OR SIMILARITY(COALESCE("titleEn", ''), ${query}) > 0.2
          OR SIMILARITY(COALESCE("titleUk", ''), ${query}) > 0.2
          OR SIMILARITY(COALESCE("titleRu", ''), ${query}) > 0.2
        ORDER BY GREATEST(
          SIMILARITY("titleRomaji", ${query}),
          SIMILARITY(COALESCE("titleEn", ''), ${query}),
          SIMILARITY(COALESCE("titleUk", ''), ${query}),
          SIMILARITY(COALESCE("titleRu", ''), ${query})
        ) DESC
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
          coverUrl: true,
        },
        take: limit,
      });
    }
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
        coverUrl: true,
      },
    });
    if (!anime) {
      throw new NotFoundException(`Anime with ID ${id} not found`);
    }
    return anime;
  }
}
