import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Anime } from '@prisma/client';
import { RedisService } from '../redis/redis.service';

export type SupportedLanguage = 'uk' | 'en' | 'ru';

export interface GeneratedClueSet {
  hard: [string, string];
  medium: [string, string];
  easy: [string, string];
}

export interface AnimeDossierCharacter {
  name: string;
  role?: string;
  description?: string;
}

export interface AnimeDossier {
  popularity?: number;
  genres?: string[];
  tags?: string[];
  anilistDescription?: string;
  wikipediaPlot?: string;
  characters?: AnimeDossierCharacter[];
  fandomTrivia?: string[];
  fandomUrl?: string;
}

@Injectable()
export class AiClueService {
  private readonly logger = new Logger(AiClueService.name);
  private static readonly REDIS_BACKUP_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
  private static readonly REQUEST_TIMEOUT_MS = 12_000;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Generates 6 progressive clues on the fly (temperature: 0.9) in strict JSON format:
   * { "hard": [string, string], "medium": [string, string], "easy": [string, string] }
   * written natively in the requested UI language ('uk' | 'en' | 'ru').
   *
   * Primary: Groq (llama-3.3-70b-versatile)
   * Fallback: Google Gemini (gemini-2.5-flash)
   * Emergency Backup: Redis cache per (animeId, lang), then deterministic dossier synthesis.
   */
  async generateClues(
    anime: Anime,
    lang: SupportedLanguage = 'en',
  ): Promise<GeneratedClueSet> {
    const normalizedLang: SupportedLanguage =
      lang === 'uk' || lang === 'ru' || lang === 'en' ? lang : 'en';
    const dossier = this.extractDossier(anime);
    const forbiddenTitles = this.collectForbiddenTitles(anime);

    const systemPrompt = this.buildSystemPrompt(normalizedLang, forbiddenTitles);
    const userPrompt = this.buildUserPrompt(anime, dossier, normalizedLang);

    // 1. Primary: Groq (llama-3.3-70b-versatile)
    try {
      const groqClues = await this.callGroq(systemPrompt, userPrompt);
      const sanitized = this.validateAndSanitizeClueSet(
        groqClues,
        forbiddenTitles,
      );
      await this.cacheBackupClues(anime.id, normalizedLang, sanitized);
      return sanitized;
    } catch (groqError) {
      const msg =
        groqError instanceof Error ? groqError.message : String(groqError);
      this.logger.warn(
        `Groq clue generation failed for animeId=${anime.id} (${normalizedLang}): ${msg}. Falling back to Gemini...`,
      );
    }

    // 2. Fallback: Gemini (gemini-2.5-flash)
    try {
      const geminiClues = await this.callGemini(systemPrompt, userPrompt);
      const sanitized = this.validateAndSanitizeClueSet(
        geminiClues,
        forbiddenTitles,
      );
      await this.cacheBackupClues(anime.id, normalizedLang, sanitized);
      return sanitized;
    } catch (geminiError) {
      const msg =
        geminiError instanceof Error
          ? geminiError.message
          : String(geminiError);
      this.logger.warn(
        `Gemini fallback failed for animeId=${anime.id} (${normalizedLang}): ${msg}. Checking Redis emergency backup...`,
      );
    }

    // 3. Emergency Backup: Redis cached clue set for (animeId, lang)
    const cached = await this.getCachedBackupClues(anime.id, normalizedLang);
    if (cached) {
      this.logger.log(
        `Served emergency cached clue set from Redis for animeId=${anime.id} (${normalizedLang})`,
      );
      return cached;
    }

    // 4. Last-resort deterministic synthesis from dossier so gameplay never fails
    const synthesized = this.synthesizeFallbackFromDossier(
      anime,
      dossier,
      normalizedLang,
      forbiddenTitles,
    );
    await this.cacheBackupClues(anime.id, normalizedLang, synthesized);
    return synthesized;
  }

  /**
   * Flattens a structured { hard, medium, easy } clue set into a 6-step ordered array.
   */
  flattenClueSet(clueSet: GeneratedClueSet): string[] {
    return [...clueSet.hard, ...clueSet.medium, ...clueSet.easy];
  }

  private async callGroq(
    systemPrompt: string,
    userPrompt: string,
  ): Promise< unknown > {
    const apiKey = this.configService.get<string>('GROQ_API_KEY')?.trim();
    if (!apiKey || apiKey.startsWith('gsk_your_')) {
      throw new Error('GROQ_API_KEY is not configured');
    }

    const model =
      this.configService.get<string>('GROQ_MODEL')?.trim() ||
      'llama-3.3-70b-versatile';

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      AiClueService.REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            temperature: 0.9,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(
          `Groq HTTP ${response.status}: ${errBody.slice(0, 200)}`,
        );
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const rawContent = data.choices?.[0]?.message?.content;
      if (!rawContent) {
        throw new Error('Groq returned empty message content');
      }

      return JSON.parse(rawContent);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async callGemini(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<unknown> {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY')?.trim();
    if (!apiKey || apiKey.startsWith('your_')) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    const model =
      this.configService.get<string>('GEMINI_MODEL')?.trim() ||
      'gemini-2.5-flash';

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      AiClueService.REQUEST_TIMEOUT_MS,
    );

    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model,
      )}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: userPrompt }],
            },
          ],
          generationConfig: {
            temperature: 0.9,
            responseMimeType: 'application/json',
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(
          `Gemini HTTP ${response.status}: ${errBody.slice(0, 200)}`,
        );
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        throw new Error('Gemini returned empty candidate content');
      }

      return JSON.parse(rawText);
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildSystemPrompt(
    lang: SupportedLanguage,
    forbiddenTitles: string[],
  ): string {
    const languageNames: Record<SupportedLanguage, string> = {
      uk: 'Ukrainian (Українська мова)',
      en: 'English',
      ru: 'Russian (Русский язык)',
    };

    return [
      `You are an expert anime trivia game master creating 6 progressive deduction clues for a mystery anime.`,
      `TARGET OUTPUT LANGUAGE: Write all 6 clues natively and naturally in ${languageNames[lang]}.`,
      `OUTPUT FORMAT: Return STRICT JSON ONLY matching this exact schema:`,
      `{"hard": ["clue 1", "clue 2"], "medium": ["clue 3", "clue 4"], "easy": ["clue 5", "clue 6"]}`,
      ``,
      `IMPORTANT CLUE DESIGN RULES:`,
      `1. Character names, factions, organizations, world terms, specific abilities/techniques, and Fandom memes/trivia ARE ALLOWED and strongly encouraged!`,
      `   - "hard": Deep lore, behind-the-scenes trivia, Fandom memes, minor character quirks, or specific worldbuilding mechanics without naming the main protagonist immediately.`,
      `   - "medium": Iconic factions, secondary characters, signature powers/weapons, or pivotal story arcs.`,
      `   - "easy": Famous character names (including protagonists/antagonists), iconic catchphrases, or unmistakable plot hooks.`,
      `2. FORBIDDEN: Never write the exact title of the anime itself in any language (${forbiddenTitles.join(' / ')}) directly inside the clues. If a character's name is also the exact title, refer to their surname, nickname, role, or companions instead.`,
      `3. Keep each clue concise (1–2 sentences), vivid, and fresh on every generation.`,
    ].join('\n');
  }

  private buildUserPrompt(
    anime: Anime,
    dossier: AnimeDossier,
    lang: SupportedLanguage,
  ): string {
    const charactersText = (dossier.characters ?? [])
      .slice(0, 8)
      .map(
        (c) =>
          `- ${c.name}${c.role ? ` (${c.role})` : ''}: ${(c.description ?? '').slice(0, 220)}`,
      )
      .join('\n');

    const triviaText = (dossier.fandomTrivia ?? [])
      .slice(0, 8)
      .map((t) => `- ${t}`)
      .join('\n');

    return [
      `Generate 6 fresh clues in "${lang}" for this anime based on its scraped 3-source dossier:`,
      `Romaji Title (DO NOT MENTION): ${anime.titleRomaji}`,
      `English Title (DO NOT MENTION): ${anime.titleEn ?? 'N/A'}`,
      `Ukrainian Title (DO NOT MENTION): ${anime.titleUk ?? 'N/A'}`,
      `Russian Title (DO NOT MENTION): ${anime.titleRu ?? 'N/A'}`,
      `Genres: ${(dossier.genres ?? []).join(', ') || 'Unknown'}`,
      `Tags: ${(dossier.tags ?? []).slice(0, 12).join(', ') || 'Unknown'}`,
      `AniList Synopsis:\n${(dossier.anilistDescription ?? '').slice(0, 900)}`,
      `Wikipedia Plot Summary:\n${(dossier.wikipediaPlot ?? '').slice(0, 1100)}`,
      `Characters:\n${charactersText || 'N/A'}`,
      `Fandom Wiki Trivia & Memes:\n${triviaText || 'N/A'}`,
    ].join('\n\n');
  }

  private collectForbiddenTitles(anime: Anime): string[] {
    const raw = [
      anime.titleRomaji,
      anime.titleEn,
      anime.titleJa,
      anime.titleUk,
      anime.titleRu,
      ...(anime.synonyms ?? []),
    ];
    return Array.from(
      new Set(
        raw
          .filter((t): t is string => typeof t === 'string' && t.trim().length >= 3)
          .map((t) => t.trim()),
      ),
    );
  }

  private validateAndSanitizeClueSet(
    raw: unknown,
    forbiddenTitles: string[],
  ): GeneratedClueSet {
    if (!raw || typeof raw !== 'object') {
      throw new Error('AI response is not a JSON object');
    }

    const obj = raw as Record<string, unknown>;
    const hard = this.normalizePair(obj.hard, 'hard', forbiddenTitles);
    const medium = this.normalizePair(obj.medium, 'medium', forbiddenTitles);
    const easy = this.normalizePair(obj.easy, 'easy', forbiddenTitles);

    return { hard, medium, easy };
  }

  private normalizePair(
    value: unknown,
    tier: string,
    forbiddenTitles: string[],
  ): [string, string] {
    if (!Array.isArray(value) || value.length < 2) {
      throw new Error(`Invalid "${tier}" clue array in AI response`);
    }

    const first = this.scrubForbiddenTitles(String(value[0] ?? '').trim(), forbiddenTitles);
    const second = this.scrubForbiddenTitles(String(value[1] ?? '').trim(), forbiddenTitles);

    if (!first || !second) {
      throw new Error(`Empty clue string in "${tier}" tier`);
    }

    return [first, second];
  }

  private scrubForbiddenTitles(text: string, forbiddenTitles: string[]): string {
    let scrubbed = text;
    for (const title of forbiddenTitles) {
      if (title.length < 4) continue;
      const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'gi');
      scrubbed = scrubbed.replace(regex, '[***]');
    }
    return scrubbed;
  }

  private extractDossier(anime: Anime): AnimeDossier {
    if (
      anime.dossier &&
      typeof anime.dossier === 'object' &&
      !Array.isArray(anime.dossier)
    ) {
      return anime.dossier as unknown as AnimeDossier;
    }
    return {};
  }

  private buildRedisBackupKey(animeId: number, lang: SupportedLanguage): string {
    return `ai_clues:backup:${animeId}:${lang}`;
  }

  private async cacheBackupClues(
    animeId: number,
    lang: SupportedLanguage,
    clueSet: GeneratedClueSet,
  ): Promise<void> {
    try {
      const key = this.buildRedisBackupKey(animeId, lang);
      await this.redisService
        .getClient()
        .set(
          key,
          JSON.stringify(clueSet),
          'EX',
          AiClueService.REDIS_BACKUP_TTL_SECONDS,
        );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to write Redis backup clues: ${msg}`);
    }
  }

  private async getCachedBackupClues(
    animeId: number,
    lang: SupportedLanguage,
  ): Promise<GeneratedClueSet | null> {
    try {
      const key = this.buildRedisBackupKey(animeId, lang);
      const raw = await this.redisService.getClient().get(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as GeneratedClueSet;
      if (
        Array.isArray(parsed.hard) &&
        parsed.hard.length === 2 &&
        Array.isArray(parsed.medium) &&
        parsed.medium.length === 2 &&
        Array.isArray(parsed.easy) &&
        parsed.easy.length === 2
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private synthesizeFallbackFromDossier(
    _anime: Anime,
    dossier: AnimeDossier,
    lang: SupportedLanguage,
    forbiddenTitles: string[],
  ): GeneratedClueSet {
    const genres = (dossier.genres ?? ['Action', 'Drama']).slice(0, 3).join(', ');
    const tags = (dossier.tags ?? ['Mystery', 'Supernatural']).slice(0, 4).join(', ');
    const trivia1 =
      dossier.fandomTrivia?.[0] ??
      dossier.wikipediaPlot?.split('. ')[0] ??
      'Features a distinctive world hierarchy and recurring community memes.';
    const trivia2 =
      dossier.fandomTrivia?.[1] ??
      dossier.anilistDescription?.split('. ')[0] ??
      'Known for atmospheric worldbuilding and high-stakes turning points.';
    const charNames = (dossier.characters ?? [])
      .slice(0, 3)
      .map((c) => c.name)
      .join(', ');
    const plotSummary = (
      dossier.anilistDescription ??
      dossier.wikipediaPlot ??
      'A pivotal journey where the protagonists confront extraordinary forces.'
    ).slice(0, 220);

    if (lang === 'uk') {
      return {
        hard: [
          this.scrubForbiddenTitles(
            `Тематичні теги цього всесвіту включають: ${tags}.`,
            forbiddenTitles,
          ),
          this.scrubForbiddenTitles(
            `Цікавий факт або деталь лору: ${trivia1}`,
            forbiddenTitles,
          ),
        ],
        medium: [
          this.scrubForbiddenTitles(
            `Основні жанри історії: ${genres}. ${trivia2}`,
            forbiddenTitles,
          ),
          this.scrubForbiddenTitles(
            `Сюжетна зав'язка: ${plotSummary}`,
            forbiddenTitles,
          ),
        ],
        easy: [
          this.scrubForbiddenTitles(
            charNames
              ? `Серед ключових персонажів цієї історії: ${charNames}.`
              : `Головні герої проходять через визначальні випробування у жанрах ${genres}.`,
            forbiddenTitles,
          ),
          this.scrubForbiddenTitles(
            `Культова історія, де поєднуються ${genres} та мотиви ${tags}.`,
            forbiddenTitles,
          ),
        ],
      };
    }

    if (lang === 'ru') {
      return {
        hard: [
          this.scrubForbiddenTitles(
            `Ключевые теги и мотивы этой вселенной: ${tags}.`,
            forbiddenTitles,
          ),
          this.scrubForbiddenTitles(
            `Интересный факт из лора или фандома: ${trivia1}`,
            forbiddenTitles,
          ),
        ],
        medium: [
          this.scrubForbiddenTitles(
            `Основные жанры произведения: ${genres}. ${trivia2}`,
            forbiddenTitles,
          ),
          this.scrubForbiddenTitles(
            `Завязка сюжета: ${plotSummary}`,
            forbiddenTitles,
          ),
        ],
        easy: [
          this.scrubForbiddenTitles(
            charNames
              ? `Среди ключевых персонажей этой истории: ${charNames}.`
              : `Главные герои проходят через знаковые испытания в жанрах ${genres}.`,
            forbiddenTitles,
          ),
          this.scrubForbiddenTitles(
            `Знаковое аниме, сочетающее жанры ${genres} и темы ${tags}.`,
            forbiddenTitles,
          ),
        ],
      };
    }

    return {
      hard: [
        this.scrubForbiddenTitles(
          `Core thematic tags in this universe include: ${tags}.`,
          forbiddenTitles,
        ),
        this.scrubForbiddenTitles(
          `Lore & community trivia note: ${trivia1}`,
          forbiddenTitles,
        ),
      ],
      medium: [
        this.scrubForbiddenTitles(
          `Primary genres: ${genres}. ${trivia2}`,
          forbiddenTitles,
        ),
        this.scrubForbiddenTitles(
          `Story premise: ${plotSummary}`,
          forbiddenTitles,
        ),
      ],
      easy: [
        this.scrubForbiddenTitles(
          charNames
            ? `Notable characters in this series include ${charNames}.`
            : `The protagonists face defining trials across ${genres}.`,
          forbiddenTitles,
        ),
        this.scrubForbiddenTitles(
          `An iconic series blending ${genres} with ${tags}.`,
          forbiddenTitles,
        ),
      ],
    };
  }
}
