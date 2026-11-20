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

const CYRILLIC_RE = /[А-Яа-яЁёІіЇїЄєҐґ]/;

@Injectable()
export class AiClueService {
  private readonly logger = new Logger(AiClueService.name);
  private static readonly REDIS_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
  private static readonly REQUEST_TIMEOUT_MS = 12_000;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Generates 6 progressive clues on the fly (temperature: 0.9) in strict JSON format:
   * { "hard": [string, string], "medium": [string, string], "easy": [string, string] }
   * written natively and strictly in the requested UI language ('uk' | 'en' | 'ru').
   *
   * Primary: Groq (llama-3.3-70b-versatile)
   * Fallback: Google Gemini (gemini-2.5-flash)
   * Emergency Backup: Language-scoped Redis cache (`ai_clues:<animeId>:<lang>`),
   * then deterministic localized dossier synthesis.
   */
  async generateClues(
    anime: Anime,
    lang: SupportedLanguage = 'en',
  ): Promise<GeneratedClueSet> {
    const normalizedLang: SupportedLanguage =
      lang === 'uk' || lang === 'ru' || lang === 'en' ? lang : 'en';
    const dossier = this.extractDossier(anime);
    const forbiddenTitles = this.collectForbiddenTitles(anime);
    const mainCharacterNames = this.extractMainCharacterNames(dossier);

    const systemPrompt = this.buildSystemPrompt(
      normalizedLang,
      forbiddenTitles,
      mainCharacterNames,
    );
    const userPrompt = this.buildUserPrompt(
      anime,
      dossier,
      normalizedLang,
      mainCharacterNames,
    );

    // 1. Primary: Groq (llama-3.3-70b-versatile)
    try {
      const groqClues = await this.callGroq(systemPrompt, userPrompt);
      const sanitized = this.validateAndSanitizeClueSet(
        groqClues,
        forbiddenTitles,
        normalizedLang,
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
        normalizedLang,
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

    // 3. Emergency Backup: Language-scoped Redis cache `ai_clues:<animeId>:<lang>`
    const cached = await this.getCachedBackupClues(anime.id, normalizedLang);
    if (cached) {
      this.logger.log(
        `Served emergency cached clue set from Redis (${this.buildRedisCacheKey(anime.id, normalizedLang)})`,
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
  ): Promise<unknown> {
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
    mainCharacterNames: string[],
  ): string {
    const languageSpecs: Record<SupportedLanguage, string> = {
      uk: 'Ukrainian (Українська мова) — STRICTLY Ukrainian Cyrillic text only. NEVER fallback to English or Russian sentences, and ALWAYS translate any English dossier facts naturally into Ukrainian.',
      en: 'English — STRICTLY natural English text only.',
      ru: 'Russian (Русский язык) — STRICTLY Russian Cyrillic text only. NEVER fallback to English sentences, and ALWAYS translate any English dossier facts naturally into Russian.',
    };

    const mainCharsBlock =
      mainCharacterNames.length > 0
        ? `Identified main characters (protagonists/deuteragonists): ${mainCharacterNames.join(', ')}.`
        : 'Identify the main protagonist(s) and deuteragonist(s) from the dossier.';

    return [
      `You are an expert anime trivia game master creating 6 progressive deduction clues for a mystery anime.`,
      ``,
      `MANDATORY TARGET LANGUAGE:`,
      `ALL 6 clues MUST be written natively and strictly in ${languageSpecs[lang]}`,
      `Never copy raw English text from the dossier when Ukrainian or Russian is requested.`,
      ``,
      `OUTPUT FORMAT: Return STRICT JSON ONLY matching this exact schema:`,
      `{"hard": ["clue 1", "clue 2"], "medium": ["clue 3", "clue 4"], "easy": ["clue 5", "clue 6"]}`,
      ``,
      `STRICT DIFFICULTY TIER PROGRESSION & CHARACTER NAME RULES:`,
      `- HARD (Clues 1 & 2): Obscure Fandom trivia, background memes, specific world rules, or minor side-character quirks.`,
      `  STRICTLY FORBIDDEN in HARD clues: Do NOT mention any main character (protagonist/deuteragonist) names and do NOT mention the anime title.`,
      `- MEDIUM (Clues 3 & 4): Core plot premise, central conflict, or ironic summary of how the protagonist solves problems.`,
      `  STRICTLY FORBIDDEN in MEDIUM clues: Do NOT mention main character names (refer to them only by role, occupation, or traits) and do NOT repeat facts from Hard clues.`,
      `- EASY (Clues 5 & 6): Iconic plot twists, signature powers/items, famous memes, or major character names/catchphrases that make the show recognizable — without stating the anime title itself and without repeating clues 1–4.`,
      ``,
      mainCharsBlock,
      ``,
      `NO-REPEAT RULE (CRITICAL):`,
      `All 6 clues must describe 6 completely distinct facts/aspects. Clue 5 and Clue 6 must NEVER paraphrase or repeat Clue 1 or Clue 2. Never reuse the same fact across tiers.`,
      ``,
      `FORBIDDEN ANIME TITLES (NEVER WRITE THESE IN ANY CLUE):`,
      `${forbiddenTitles.join(' / ') || 'N/A'}`,
      `If a character's name is also the exact anime title, never write that exact title; refer to their surname, nickname, role, or companions instead.`,
      ``,
      `STYLE: Keep each clue concise (1–2 vivid sentences), accurate, and engaging.`,
    ].join('\n');
  }

  private buildUserPrompt(
    anime: Anime,
    dossier: AnimeDossier,
    lang: SupportedLanguage,
    mainCharacterNames: string[],
  ): string {
    const languageLabel: Record<SupportedLanguage, string> = {
      uk: 'Ukrainian (uk)',
      en: 'English (en)',
      ru: 'Russian (ru)',
    };

    const charactersText = (dossier.characters ?? [])
      .slice(0, 10)
      .map(
        (c) =>
          `- ${c.name}${c.role ? ` [${c.role}]` : ''}: ${(c.description ?? '').slice(0, 220)}`,
      )
      .join('\n');

    const triviaText = (dossier.fandomTrivia ?? [])
      .slice(0, 8)
      .map((t) => `- ${t}`)
      .join('\n');

    const combinedTags = Array.from(
      new Set([...(dossier.tags ?? []), ...(anime.tags ?? [])]),
    ).slice(0, 15);

    return [
      `Generate 6 completely distinct progressive clues strictly in ${languageLabel[lang]} for this anime:`,
      `Romaji Title (DO NOT MENTION): ${anime.titleRomaji ?? 'N/A'}`,
      `English Title (DO NOT MENTION): ${anime.titleEn ?? 'N/A'}`,
      `Ukrainian Title (DO NOT MENTION): ${anime.titleUk ?? 'N/A'}`,
      `Russian Title (DO NOT MENTION): ${anime.titleRu ?? 'N/A'}`,
      `Format / Release Year: ${anime.type ?? 'Unknown'} / ${anime.year ?? 'Unknown'}`,
      `Genres: ${(dossier.genres ?? []).join(', ') || 'Unknown'}`,
      `Tags: ${combinedTags.join(', ') || 'Unknown'}`,
      `Main Characters (FORBIDDEN in Hard & Medium clues; allowed ONLY in Easy clues): ${mainCharacterNames.join(', ') || 'See Characters list below'}`,
      `AniList Synopsis:\n${(dossier.anilistDescription ?? '').slice(0, 1000) || 'N/A'}`,
      `Wikipedia Plot Summary:\n${(dossier.wikipediaPlot ?? '').slice(0, 1200) || 'N/A'}`,
      `Characters:\n${charactersText || 'N/A'}`,
      `Fandom Wiki Trivia & Memes:\n${triviaText || 'N/A'}`,
    ].join('\n\n');
  }

  private extractMainCharacterNames(dossier: AnimeDossier): string[] {
    const characters = dossier.characters ?? [];
    const mainChars = characters
      .filter((c) => (c.role ?? '').toUpperCase() === 'MAIN')
      .map((c) => c.name.trim())
      .filter(Boolean);

    if (mainChars.length > 0) {
      return Array.from(new Set(mainChars)).slice(0, 6);
    }

    return Array.from(
      new Set(
        characters
          .slice(0, 2)
          .map((c) => c.name.trim())
          .filter(Boolean),
      ),
    );
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
          .filter(
            (t): t is string => typeof t === 'string' && t.trim().length >= 3,
          )
          .map((t) => t.trim()),
      ),
    );
  }

  private validateAndSanitizeClueSet(
    raw: unknown,
    forbiddenTitles: string[],
    lang: SupportedLanguage,
  ): GeneratedClueSet {
    if (!raw || typeof raw !== 'object') {
      throw new Error('AI response is not a JSON object');
    }

    const obj = raw as Record<string, unknown>;
    const hard = this.normalizePair(obj.hard, 'hard', forbiddenTitles, lang);
    const medium = this.normalizePair(
      obj.medium,
      'medium',
      forbiddenTitles,
      lang,
    );
    const easy = this.normalizePair(obj.easy, 'easy', forbiddenTitles, lang);

    // Reject duplicate clues across tiers
    const normalizedSet = new Set(
      [...hard, ...medium, ...easy].map((c) => c.toLowerCase()),
    );
    if (normalizedSet.size < 6) {
      throw new Error('AI response contained duplicate clues across tiers');
    }

    return { hard, medium, easy };
  }

  private normalizePair(
    value: unknown,
    tier: string,
    forbiddenTitles: string[],
    lang: SupportedLanguage,
  ): [string, string] {
    if (!Array.isArray(value) || value.length < 2) {
      throw new Error(`Invalid "${tier}" clue array in AI response`);
    }

    const first = this.scrubForbiddenTitles(
      String(value[0] ?? '').trim(),
      forbiddenTitles,
    );
    const second = this.scrubForbiddenTitles(
      String(value[1] ?? '').trim(),
      forbiddenTitles,
    );

    if (!first || !second) {
      throw new Error(`Empty clue string in "${tier}" tier`);
    }

    // Ensure Ukrainian and Russian responses actually use Cyrillic script instead of English fallback
    if (lang === 'uk' || lang === 'ru') {
      if (!CYRILLIC_RE.test(first) || !CYRILLIC_RE.test(second)) {
        throw new Error(
          `AI returned non-Cyrillic text for target language "${lang}" in "${tier}" tier`,
        );
      }
    }

    return [first, second];
  }

  private scrubForbiddenTitles(
    text: string,
    forbiddenTitles: string[],
  ): string {
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

  private buildRedisCacheKey(
    animeId: number,
    lang: SupportedLanguage,
  ): string {
    return `ai_clues:${animeId}:${lang}`;
  }

  private async cacheBackupClues(
    animeId: number,
    lang: SupportedLanguage,
    clueSet: GeneratedClueSet,
  ): Promise<void> {
    try {
      const key = this.buildRedisCacheKey(animeId, lang);
      await this.redisService
        .getClient()
        .set(
          key,
          JSON.stringify(clueSet),
          'EX',
          AiClueService.REDIS_CACHE_TTL_SECONDS,
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
      const key = this.buildRedisCacheKey(animeId, lang);
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
    anime: Anime,
    dossier: AnimeDossier,
    lang: SupportedLanguage,
    forbiddenTitles: string[],
  ): GeneratedClueSet {
    const genres = (dossier.genres ?? []).slice(0, 3);
    const tags = Array.from(
      new Set([...(dossier.tags ?? []), ...(anime.tags ?? [])]),
    ).slice(0, 5);
    const yearText = anime.year ? String(anime.year) : '';
    const typeText = anime.type ?? 'TV';
    const supportingChars = (dossier.characters ?? [])
      .filter((c) => (c.role ?? '').toUpperCase() !== 'MAIN')
      .slice(0, 2)
      .map((c) => c.name);
    const mainChars = this.extractMainCharacterNames(dossier).slice(0, 3);

    const scrub = (s: string) => this.scrubForbiddenTitles(s, forbiddenTitles);

    if (lang === 'uk') {
      return {
        hard: [
          scrub(
            yearText
              ? `Це аніме формату ${typeText} вийшло у ${yearText} році та вирізняється незвичними правилами свого світу.`
              : `Це аніме формату ${typeText} вирізняється специфічною атмосферою та впізнаваними деталями світобудови.`,
          ),
          scrub(
            supportingChars.length > 0
              ? `Серед другорядних персонажів цієї історії згадуються ${supportingChars.join(', ')}.`
              : `Серед тематичних мотивів тайтлу виділяють: ${tags.slice(0, 3).join(', ') || 'пригоди, драма'}.`,
          ),
        ],
        medium: [
          scrub(
            `У центрі конфлікту — головний герой, якому доводиться долати несподівані випробування у жанрах: ${genres.join(', ') || 'екшн, драма'}.`,
          ),
          scrub(
            `Сюжетна зав'язка будується навколо поєднання мотивів ${tags.slice(0, 4).join(', ') || 'таємниці та боротьби'} і поступового розкриття правди.`,
          ),
        ],
        easy: [
          scrub(
            mainChars.length > 0
              ? `Серед ключових головних персонажів цієї історії: ${mainChars.join(', ')}.`
              : `Протагоністи цієї історії стали культовими завдяки своїм унікальним здібностям та сюжетним поворотам.`,
          ),
          scrub(
            yearText
              ? `Відомий тайтл ${yearText} року у форматі ${typeText}, який поєднує жанри ${genres.join(', ') || 'екшн і драму'}.`
              : `Відомий тайтл формату ${typeText}, який поєднує жанри ${genres.join(', ') || 'екшн і драму'}.`,
          ),
        ],
      };
    }

    if (lang === 'ru') {
      return {
        hard: [
          scrub(
            yearText
              ? `Это аниме формата ${typeText} вышло в ${yearText} году и выделяется особыми правилами своего мира.`
              : `Это аниме формата ${typeText} выделяется специфической атмосферой и узнаваемыми деталями мироустройства.`,
          ),
          scrub(
            supportingChars.length > 0
              ? `Среди второстепенных персонажей этой истории встречаются ${supportingChars.join(', ')}.`
              : `Среди тематических мотивов тайтла выделяются: ${tags.slice(0, 3).join(', ') || 'приключения, драма'}.`,
          ),
        ],
        medium: [
          scrub(
            `В центре конфликта — протагонист, которому приходится преодолевать неожиданные испытания в жанрах: ${genres.join(', ') || 'экшен, драма'}.`,
          ),
          scrub(
            `Завязка сюжета строится вокруг сочетания мотивов ${tags.slice(0, 4).join(', ') || 'тайны и противостояния'} и постепенного раскрытия интриги.`,
          ),
        ],
        easy: [
          scrub(
            mainChars.length > 0
              ? `Среди ключевых главных персонажей этой истории: ${mainChars.join(', ')}.`
              : `Главные герои этой истории стали культовыми благодаря своим уникальным способностям и сюжетным поворотам.`,
          ),
          scrub(
            yearText
              ? `Известный тайтл ${yearText} года в формате ${typeText}, объединяющий жанры ${genres.join(', ') || 'экшен и драму'}.`
              : `Известный тайтл формата ${typeText}, объединяющий жанры ${genres.join(', ') || 'экшен и драму'}.`,
          ),
        ],
      };
    }

    const trivia1 =
      dossier.fandomTrivia?.[0] ??
      (yearText
        ? `Released in ${yearText} (${typeText}), this series is known for distinct worldbuilding quirks.`
        : `This ${typeText} series is known for distinct worldbuilding rules and community trivia.`);
    const plotSnippet = (
      dossier.anilistDescription ??
      dossier.wikipediaPlot ??
      'The protagonist faces an escalating conflict driven by unusual rules and alliances.'
    ).slice(0, 220);

    return {
      hard: [
        scrub(trivia1),
        scrub(
          supportingChars.length > 0
            ? `Supporting figures appearing in this world include ${supportingChars.join(', ')}.`
            : `Notable thematic tags include: ${tags.slice(0, 4).join(', ') || 'Mystery, Supernatural'}.`,
        ),
      ],
      medium: [
        scrub(
          `Core genre blend: ${genres.join(', ') || 'Action, Drama'}, centered on how the lead navigates an unusual conflict.`,
        ),
        scrub(`Premise overview: ${plotSnippet}`),
      ],
      easy: [
        scrub(
          mainChars.length > 0
            ? `Major characters who define this story include ${mainChars.join(', ')}.`
            : `Iconic abilities, plot twists, and signature confrontations make this series immediately recognizable.`,
        ),
        scrub(
          yearText
            ? `A memorable ${yearText} ${typeText} release combining ${genres.join(', ') || 'Action and Drama'} with ${tags.slice(0, 3).join(', ') || 'standout twists'}.`
            : `A memorable ${typeText} release combining ${genres.join(', ') || 'Action and Drama'} with ${tags.slice(0, 3).join(', ') || 'standout twists'}.`,
        ),
      ],
    };
  }
}
