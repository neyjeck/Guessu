import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Anime, Prisma } from '@prisma/client';
import { AnimeDossier, AnimeDossierCharacter } from '../ai/ai-clue.service';
import { PrismaService } from '../prisma/prisma.service';

interface AniListEnrichmentResult {
  titleEn: string | null;
  titleRomaji: string | null;
  titleJa: string | null;
  coverUrl: string | null;
  popularity: number | null;
  genres: string[];
  tags: string[];
  anilistDescription: string;
  characters: AnimeDossierCharacter[];
}

interface WikipediaEnrichmentResult {
  wikipediaPlot: string;
  titleUk: string | null;
  titleRu: string | null;
}

interface FandomEnrichmentResult {
  fandomTrivia: string[];
  fandomUrl: string | null;
}

const ANILIST_ENRICH_QUERY = `
query ($id: Int, $search: String) {
  Media(id: $id, search: $search, type: ANIME, isAdult: false) {
    id
    popularity
    title {
      romaji
      english
      native
    }
    coverImage {
      large
      extraLarge
    }
    genres
    tags {
      name
      rank
      isMediaSpoiler
    }
    description(asHtml: false)
    characters(sort: [ROLE, RELEVANCE, ID], perPage: 10) {
      edges {
        role
        node {
          name {
            full
          }
          description(asHtml: false)
        }
      }
    }
  }
}
`;

@Injectable()
export class AnimeEnrichmentService {
  private readonly logger = new Logger(AnimeEnrichmentService.name);
  private static readonly EXTERNAL_TIMEOUT_MS = 4_000;
  private static readonly USER_AGENT =
    'AnimeGuesserEnrichment/1.0 (https://github.com/anime-guesser)';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ensures the target anime has a populated multi-source dossier (AniList + Wikipedia + Fandom).
   * Returns immediately if `isEnriched === true` and `dossier` is already populated.
   * Otherwise fetches external sources in parallel with a strict 4-second timeout per source
   * and persists the enriched dossier + localized titles back to PostgreSQL.
   */
  async ensureEnriched(animeId: string | number): Promise<Anime> {
    const numericId =
      typeof animeId === 'number'
        ? animeId
        : Number.parseInt(String(animeId), 10);

    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw new NotFoundException(`Invalid anime ID: ${animeId}`);
    }

    const anime = await this.prisma.anime.findUnique({
      where: { id: numericId },
    });

    if (!anime) {
      throw new NotFoundException(`Anime with ID ${numericId} not found`);
    }

    if (anime.isEnriched && this.hasPopulatedDossier(anime.dossier)) {
      return anime;
    }

    const searchTitle = anime.titleEn ?? anime.titleRomaji ?? '';
    const existingDossier = this.asDossierObject(anime.dossier);

    const [anilistSettled, wikiSettled, fandomSettled] =
      await Promise.allSettled([
        this.fetchAniListContext(anime),
        this.fetchWikipediaContext(searchTitle),
        this.fetchFandomContext(anime.titleEn, anime.titleRomaji),
      ]);

    const anilist =
      anilistSettled.status === 'fulfilled' ? anilistSettled.value : null;
    const wiki = wikiSettled.status === 'fulfilled' ? wikiSettled.value : null;
    const fandom =
      fandomSettled.status === 'fulfilled' ? fandomSettled.value : null;

    if (anilistSettled.status === 'rejected') {
      this.logger.debug(
        `AniList enrichment failed for animeId=${anime.id}: ${this.errorMsg(anilistSettled.reason)}`,
      );
    }
    if (wikiSettled.status === 'rejected') {
      this.logger.debug(
        `Wikipedia enrichment failed for animeId=${anime.id}: ${this.errorMsg(wikiSettled.reason)}`,
      );
    }
    if (fandomSettled.status === 'rejected') {
      this.logger.debug(
        `Fandom enrichment failed for animeId=${anime.id}: ${this.errorMsg(fandomSettled.reason)}`,
      );
    }

    const mergedTags = Array.from(
      new Set([
        ...(anilist?.tags ?? []),
        ...(existingDossier.tags ?? []),
        ...(anime.tags ?? []),
      ]),
    ).slice(0, 20);

    const mergedDossier: AnimeDossier = {
      popularity: anilist?.popularity ?? existingDossier.popularity ?? 0,
      genres:
        (anilist?.genres?.length ? anilist.genres : existingDossier.genres) ??
        [],
      tags: mergedTags,
      anilistDescription:
        anilist?.anilistDescription || existingDossier.anilistDescription || '',
      wikipediaPlot: wiki?.wikipediaPlot || existingDossier.wikipediaPlot || '',
      characters:
        (anilist?.characters?.length
          ? anilist.characters
          : existingDossier.characters) ?? [],
      fandomTrivia:
        (fandom?.fandomTrivia?.length
          ? fandom.fandomTrivia
          : existingDossier.fandomTrivia) ?? [],
      fandomUrl: fandom?.fandomUrl ?? existingDossier.fandomUrl ?? undefined,
    };

    const updated = await this.prisma.anime.update({
      where: { id: anime.id },
      data: {
        dossier: mergedDossier as unknown as Prisma.InputJsonValue,
        titleEn: anime.titleEn || anilist?.titleEn || null,
        titleJa: anime.titleJa || anilist?.titleJa || null,
        titleUk: anime.titleUk || wiki?.titleUk || null,
        titleRu: anime.titleRu || wiki?.titleRu || null,
        coverUrl: anime.coverUrl || anilist?.coverUrl || null,
        popularity:
          typeof anilist?.popularity === 'number' && anilist.popularity > 0
            ? anilist.popularity
            : anime.popularity,
        isEnriched: true,
      },
    });

    this.logger.log(
      `Enriched animeId=${anime.id} (${updated.titleRomaji ?? updated.titleEn ?? 'Unknown'}): ` +
        `chars=${mergedDossier.characters?.length ?? 0}, ` +
        `wiki=${mergedDossier.wikipediaPlot ? 'yes' : 'no'}, ` +
        `fandomTrivia=${mergedDossier.fandomTrivia?.length ?? 0}`,
    );

    return updated;
  }

  private async fetchAniListContext(
    anime: Anime,
  ): Promise<AniListEnrichmentResult | null> {
    const variables: Record<string, unknown> = {};
    if (anime.anilistId) {
      variables.id = anime.anilistId;
    } else if (anime.titleEn || anime.titleRomaji) {
      variables.search = anime.titleEn ?? anime.titleRomaji;
    } else {
      return null;
    }

    const response = await this.fetchWithTimeout('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': AnimeEnrichmentService.USER_AGENT,
      },
      body: JSON.stringify({
        query: ANILIST_ENRICH_QUERY,
        variables,
      }),
    });

    if (!response.ok) {
      throw new Error(`AniList HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      data?: {
        Media?: {
          popularity?: number;
          title?: { romaji?: string; english?: string; native?: string };
          coverImage?: { large?: string; extraLarge?: string };
          genres?: string[];
          tags?: Array<{ name?: string; rank?: number; isMediaSpoiler?: boolean }>;
          description?: string;
          characters?: {
            edges?: Array<{
              role?: string;
              node?: {
                name?: { full?: string };
                description?: string;
              };
            }>;
          };
        };
      };
    };

    const media = payload.data?.Media;
    if (!media) {
      return null;
    }

    const tags = (media.tags ?? [])
      .filter(
        (t) =>
          typeof t.name === 'string' &&
          !t.isMediaSpoiler &&
          (t.rank ?? 0) >= 50,
      )
      .map((t) => t.name as string)
      .slice(0, 15);

    const characters: AnimeDossierCharacter[] = [];
    for (const edge of media.characters?.edges ?? []) {
      const name = edge.node?.name?.full?.trim();
      if (!name) continue;
      characters.push({
        name,
        role: edge.role ?? 'SUPPORTING',
        description: this.cleanMarkup(edge.node?.description, 320),
      });
    }

    return {
      titleEn: media.title?.english?.trim() || null,
      titleRomaji: media.title?.romaji?.trim() || null,
      titleJa: media.title?.native?.trim() || null,
      coverUrl:
        media.coverImage?.large || media.coverImage?.extraLarge || null,
      popularity: media.popularity ?? null,
      genres: (media.genres ?? []).filter(Boolean),
      tags,
      anilistDescription: this.cleanMarkup(media.description, 1100),
      characters,
    };
  }

  private async fetchWikipediaContext(
    searchTitle: string,
  ): Promise<WikipediaEnrichmentResult | null> {
    const trimmed = searchTitle.trim();
    if (!trimmed) {
      return null;
    }

    const deadline = Date.now() + AnimeEnrichmentService.EXTERNAL_TIMEOUT_MS;

    const searchParams = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: `${trimmed} anime`,
      srlimit: '1',
      format: 'json',
    });

    const searchResp = await this.fetchWithTimeout(
      `https://en.wikipedia.org/w/api.php?${searchParams.toString()}`,
      {
        headers: { 'User-Agent': AnimeEnrichmentService.USER_AGENT },
      },
      Math.max(500, deadline - Date.now()),
    );

    if (!searchResp.ok) {
      return null;
    }

    const searchJson = (await searchResp.json()) as {
      query?: { search?: Array<{ title?: string }> };
    };
    const resolvedTitle = searchJson.query?.search?.[0]?.title;
    if (!resolvedTitle) {
      return null;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs < 350) {
      return null;
    }

    const extractParams = new URLSearchParams({
      action: 'query',
      titles: resolvedTitle,
      prop: 'extracts|langlinks',
      explaintext: '1',
      exsectionformat: 'plain',
      exintro: '0',
      exchars: '1800',
      lllimit: '500',
      redirects: '1',
      format: 'json',
    });

    const pageResp = await this.fetchWithTimeout(
      `https://en.wikipedia.org/w/api.php?${extractParams.toString()}`,
      {
        headers: { 'User-Agent': AnimeEnrichmentService.USER_AGENT },
      },
      remainingMs,
    );

    if (!pageResp.ok) {
      return null;
    }

    const pageJson = (await pageResp.json()) as {
      query?: {
        pages?: Record<
          string,
          {
            extract?: string;
            langlinks?: Array<{ lang?: string; '*'?: string }>;
          }
        >;
      };
    };

    const pages = Object.values(pageJson.query?.pages ?? {});
    const page = pages[0];
    if (!page) {
      return null;
    }

    let titleUk: string | null = null;
    let titleRu: string | null = null;
    for (const link of page.langlinks ?? []) {
      const cleaned = (link['*'] ?? '').replace(/\s*\(.*?\)\s*$/, '').trim();
      if (!cleaned) continue;
      if (link.lang === 'uk') titleUk = cleaned;
      if (link.lang === 'ru') titleRu = cleaned;
    }

    return {
      wikipediaPlot: this.cleanMarkup(page.extract, 1400),
      titleUk,
      titleRu,
    };
  }

  private async fetchFandomContext(
    titleEn: string | null,
    titleRomaji: string | null,
  ): Promise<FandomEnrichmentResult | null> {
    const slugs = this.buildFandomSlugs(titleEn, titleRomaji);
    if (slugs.length === 0) {
      return null;
    }

    const deadline = Date.now() + AnimeEnrichmentService.EXTERNAL_TIMEOUT_MS;
    const queryTitle = (titleEn || titleRomaji || '').trim();

    for (const slug of slugs) {
      const remaining = deadline - Date.now();
      if (remaining < 500) {
        break;
      }

      const apiBase = `https://${slug}.fandom.com/api.php`;
      try {
        const searchParams = new URLSearchParams({
          action: 'query',
          list: 'search',
          srsearch: queryTitle,
          srlimit: '1',
          format: 'json',
        });

        const searchResp = await this.fetchWithTimeout(
          `${apiBase}?${searchParams.toString()}`,
          {
            headers: { 'User-Agent': AnimeEnrichmentService.USER_AGENT },
          },
          Math.min(2000, remaining),
        );

        if (!searchResp.ok) {
          continue;
        }

        const searchJson = (await searchResp.json()) as {
          query?: { search?: Array<{ title?: string }> };
        };
        const pageTitle = searchJson.query?.search?.[0]?.title;
        if (!pageTitle) {
          continue;
        }

        const parseRemaining = deadline - Date.now();
        if (parseRemaining < 400) {
          break;
        }

        const parseParams = new URLSearchParams({
          action: 'parse',
          page: pageTitle,
          prop: 'text',
          redirects: '1',
          format: 'json',
        });

        const parseResp = await this.fetchWithTimeout(
          `${apiBase}?${parseParams.toString()}`,
          {
            headers: { 'User-Agent': AnimeEnrichmentService.USER_AGENT },
          },
          parseRemaining,
        );

        if (!parseResp.ok) {
          continue;
        }

        const parseJson = (await parseResp.json()) as {
          parse?: { text?: { '*'?: string } };
        };
        const htmlContent = parseJson.parse?.text?.['*'] ?? '';
        if (!htmlContent) {
          continue;
        }

        const trivia = this.extractTriviaFromFandomHtml(htmlContent);
        if (trivia.length > 0) {
          return {
            fandomTrivia: trivia,
            fandomUrl: `https://${slug}.fandom.com/wiki/${encodeURIComponent(
              pageTitle.replace(/ /g, '_'),
            )}`,
          };
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private buildFandomSlugs(
    titleEn: string | null,
    titleRomaji: string | null,
  ): string[] {
    const candidates: string[] = [];
    for (const raw of [titleEn, titleRomaji]) {
      if (!raw) continue;
      const base = raw.toLowerCase().split(':')[0].trim();
      const compact = base.replace(/[^a-z0-9]/g, '');
      if (compact.length >= 3 && !candidates.includes(compact)) {
        candidates.push(compact);
      }
      const dashed = base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (dashed.length >= 3 && !candidates.includes(dashed)) {
        candidates.push(dashed);
      }
    }
    return candidates.slice(0, 2);
  }

  private extractTriviaFromFandomHtml(html: string): string[] {
    const items: string[] = [];
    const sectionRegex =
      /<h[23][^>]*>[\s\S]*?(?:trivia|quotes|personality|abilities|references|memes)[\s\S]*?<\/h[23]>([\s\S]{0,6000}?)(?=<h2\b|$)/gi;

    let sectionMatch: RegExpExecArray | null;
    while ((sectionMatch = sectionRegex.exec(html)) !== null) {
      const sectionBody = sectionMatch[1] ?? '';
      const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
      let liMatch: RegExpExecArray | null;
      while ((liMatch = liRegex.exec(sectionBody)) !== null) {
        const cleaned = this.cleanMarkup(liMatch[1], 280);
        if (cleaned.length >= 25 && !items.includes(cleaned)) {
          items.push(cleaned);
        }
        if (items.length >= 8) {
          return items;
        }
      }
    }

    return items;
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit = {},
    timeoutMs: number = AnimeEnrichmentService.EXTERNAL_TIMEOUT_MS,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private hasPopulatedDossier(dossier: Prisma.JsonValue | null): boolean {
    if (!dossier || typeof dossier !== 'object' || Array.isArray(dossier)) {
      return false;
    }
    const d = dossier as Record<string, unknown>;
    return (
      (typeof d.anilistDescription === 'string' &&
        d.anilistDescription.trim().length > 0) ||
      (typeof d.wikipediaPlot === 'string' &&
        d.wikipediaPlot.trim().length > 0) ||
      (Array.isArray(d.characters) && d.characters.length > 0) ||
      (Array.isArray(d.fandomTrivia) && d.fandomTrivia.length > 0) ||
      (Array.isArray(d.genres) && d.genres.length > 0) ||
      (Array.isArray(d.tags) && d.tags.length > 0)
    );
  }

  private asDossierObject(dossier: Prisma.JsonValue | null): AnimeDossier {
    if (dossier && typeof dossier === 'object' && !Array.isArray(dossier)) {
      return dossier as unknown as AnimeDossier;
    }
    return {};
  }

  private cleanMarkup(text: string | null | undefined, maxLen = 1200): string {
    if (!text) return '';
    return text
      .replace(/~![\s\S]*?!~/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/__(.+?)__/g, '$1')
      .replace(/\[\d+\]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLen);
  }

  private errorMsg(reason: unknown): string {
    return reason instanceof Error ? reason.message : String(reason);
  }
}
