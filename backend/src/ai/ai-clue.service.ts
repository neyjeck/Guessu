import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Anime } from '@prisma/client';
import { RedisService } from '../redis/redis.service';

export type SupportedLanguage = 'uk' | 'en' | 'ru';
export type ClueProvider = 'groq' | 'gemini' | 'redis-backup' | 'fallback';

export interface GeneratedClueSet {
  hard: [string, string];
  medium: [string, string];
  easy: [string, string];
  isFallback?: boolean;
  provider?: ClueProvider;
}

export interface AnimeDossierCharacter {
  name: string;
  role?: string;
  description?: string;
}

export interface AnimeDossier {
  popularity?: number;
  seasonYear?: number | null;
  studios?: string[];
  genres?: string[];
  tags?: string[];
  description?: string;
  anilistDescription?: string;
  wikipediaPlot?: string;
  characters?: AnimeDossierCharacter[];
  fandomTrivia?: string[];
  fandomUrl?: string;
}

const CYRILLIC_RE = /[А-Яа-яЁёІіЇїЄєҐґ]/;
const LEAKED_ENGLISH_SENTENCE_RE = /\b[a-z]{3,}(?:\s+[a-z]{2,}){5,}\b/;
const BANNED_GENRE_TEMPLATE_RE =
  /(?:у жанрах\s*:|в жанрах\s*:|core genre blend\s*:|primary genres\s*:|основні жанри\s*:|основные жанры\s*:)/i;

@Injectable()
export class AiClueService implements OnModuleInit {
  private readonly logger = new Logger(AiClueService.name);
  private static readonly REDIS_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
  private static readonly REQUEST_TIMEOUT_MS = 18_000;
  private static readonly GROQ_FALLBACK_MODELS = [
    'llama-3.3-70b-versatile',
    'openai/gpt-oss-120b',
    'qwen/qwen3.8-27b',
    'openai/gpt-oss-20b',
  ];

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  onModuleInit(): void {
    const groqLoaded = this.hasValidApiKey('GROQ_API_KEY', 'gsk_your_');
    const geminiLoaded = this.hasValidApiKey('GEMINI_API_KEY', 'your_');
    const groqModel =
      this.configService.get<string>('GROQ_MODEL')?.trim() ||
      'llama-3.3-70b-versatile';
    const geminiModel =
      this.configService.get<string>('GEMINI_MODEL')?.trim() ||
      'gemini-2.5-flash';

    this.logger.log(
      `Groq API key loaded: ${groqLoaded} (configured model=${groqModel})`,
    );
    this.logger.log(
      `Gemini API key loaded: ${geminiLoaded} (configured model=${geminiModel})`,
    );

    if (!groqLoaded && !geminiLoaded) {
      this.logger.error(
        'Neither GROQ_API_KEY nor GEMINI_API_KEY is configured in backend/.env! ' +
          'Clue generation will fall back to offline synthesis (isFallback=true) until a valid key is set.',
      );
    }
  }

  /**
   * Generates 6 progressive clues on the fly (temperature: 0.9) in strict JSON format:
   * { "hard": [string, string], "medium": [string, string], "easy": [string, string] }
   * written natively and strictly in the requested UI language ('uk' | 'en' | 'ru').
   *
   * Execution order:
   *  1. Groq (configured model, auto-falling back to live Groq chat models on 404 model_not_found)
   *  2. Google Gemini (`gemini-2.5-flash`)
   *  3. Emergency Redis cache (`ai_clues:<animeId>:<lang>`, storing ONLY valid LLM outputs)
   *  4. Offline deterministic dossier synthesis (`isFallback: true`)
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

    let groqErrMsg = '';
    let geminiErrMsg = '';

    // 1. Primary: Groq
    try {
      const groqClues = await this.callGroq(systemPrompt, userPrompt);
      const sanitized = this.validateAndSanitizeClueSet(
        groqClues,
        forbiddenTitles,
        normalizedLang,
      );
      const result: GeneratedClueSet = {
        ...sanitized,
        isFallback: false,
        provider: 'groq',
      };
      await this.cacheBackupClues(anime.id, normalizedLang, result);
      return result;
    } catch (groqError) {
      groqErrMsg =
        groqError instanceof Error ? groqError.message : String(groqError);
      this.logger.error(
        `[Groq FAILED] animeId=${anime.id} (${anime.titleRomaji ?? anime.titleEn ?? 'Unknown'}, lang=${normalizedLang}): ${groqErrMsg}. Falling back to Gemini...`,
      );
    }

    // 2. Fallback: Google Gemini (gemini-2.5-flash)
    try {
      const geminiClues = await this.callGemini(systemPrompt, userPrompt);
      const sanitized = this.validateAndSanitizeClueSet(
        geminiClues,
        forbiddenTitles,
        normalizedLang,
      );
      const result: GeneratedClueSet = {
        ...sanitized,
        isFallback: false,
        provider: 'gemini',
      };
      await this.cacheBackupClues(anime.id, normalizedLang, result);
      return result;
    } catch (geminiError) {
      geminiErrMsg =
        geminiError instanceof Error
          ? geminiError.message
          : String(geminiError);
      this.logger.error(
        `[Gemini FAILED] animeId=${anime.id} (${anime.titleRomaji ?? anime.titleEn ?? 'Unknown'}, lang=${normalizedLang}): ${geminiErrMsg}. Checking Redis emergency LLM backup...`,
      );
    }

    // 3. Emergency Backup: Language-scoped Redis cache `ai_clues:<animeId>:<lang>` (LLM outputs only)
    const cached = await this.getCachedBackupClues(anime.id, normalizedLang);
    if (cached) {
      this.logger.warn(
        `Served emergency cached LLM clue set from Redis (${this.buildRedisCacheKey(anime.id, normalizedLang)})`,
      );
      return {
        ...cached,
        isFallback: false,
        provider: 'redis-backup',
      };
    }

    // 4. Offline deterministic dossier fallback (flagged isFallback: true, NOT cached to Redis)
    this.logger.error(
      `[AI FALLBACK ACTIVE] Both Groq and Gemini failed for animeId=${anime.id} (${normalizedLang}). ` +
        `GroqError="${groqErrMsg}" | GeminiError="${geminiErrMsg}"`,
    );
    return {
      ...this.synthesizeFallbackFromDossier(
        anime,
        dossier,
        normalizedLang,
        forbiddenTitles,
      ),
      isFallback: true,
      provider: 'fallback',
    };
  }

  /**
   * Flattens a structured { hard, medium, easy } clue set into a 6-step ordered array.
   */
  flattenClueSet(clueSet: GeneratedClueSet): string[] {
    return [...clueSet.hard, ...clueSet.medium, ...clueSet.easy];
  }

  private hasValidApiKey(envKey: string, placeholderPrefix: string): boolean {
    const val = this.configService.get<string>(envKey)?.trim();
    return Boolean(val && !val.startsWith(placeholderPrefix));
  }

  private async callGroq(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<unknown> {
    const apiKey = this.configService.get<string>('GROQ_API_KEY')?.trim();
    if (!apiKey || apiKey.startsWith('gsk_your_')) {
      throw new Error(
        'GROQ_API_KEY is missing or still set to placeholder in backend/.env',
      );
    }

    const configuredModel =
      this.configService.get<string>('GROQ_MODEL')?.trim() ||
      'llama-3.3-70b-versatile';
    const candidateModels = Array.from(
      new Set([configuredModel, ...AiClueService.GROQ_FALLBACK_MODELS]),
    );

    let lastError = new Error('Groq call failed');

    for (const model of candidateModels) {
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
          lastError = new Error(
            `Groq API HTTP ${response.status} (model=${model}): ${errBody.slice(0, 400)}`,
          );

          // Automatically try the next live Groq model if the configured model was deprecated/not found
          if (
            response.status === 404 ||
            errBody.includes('model_not_found') ||
            errBody.includes('model_decommissioned')
          ) {
            this.logger.warn(
              `Groq model "${model}" unavailable (HTTP ${response.status}); trying next Groq model...`,
            );
            continue;
          }

          throw lastError;
        }

        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const rawContent = data.choices?.[0]?.message?.content;
        if (!rawContent) {
          throw new Error(`Groq returned empty message content (model=${model})`);
        }

        if (model !== configuredModel) {
          this.logger.log(
            `Groq clue generation succeeded using fallback model="${model}"`,
          );
        }

        return this.parseJsonObject(rawContent, `Groq(${model})`);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError;
  }

  private async callGemini(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<unknown> {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY')?.trim();
    if (!apiKey || apiKey.startsWith('your_')) {
      throw new Error(
        'GEMINI_API_KEY is missing or still set to placeholder in backend/.env',
      );
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
          `Gemini API HTTP ${response.status} (model=${model}): ${errBody.slice(0, 400)}`,
        );
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        throw new Error(
          `Gemini returned empty candidate content (model=${model})`,
        );
      }

      return this.parseJsonObject(rawText, `Gemini(${model})`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseJsonObject(rawText: string, providerLabel: string): unknown {
    const cleaned = rawText
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `${providerLabel} returned invalid JSON (${msg}): ${cleaned.slice(0, 200)}`,
      );
    }
  }

  private buildSystemPrompt(
    lang: SupportedLanguage,
    forbiddenTitles: string[],
    mainCharacterNames: string[],
  ): string {
    const targetLanguageNames: Record<SupportedLanguage, string> = {
      uk: 'Ukrainian (Українська мова)',
      en: 'English',
      ru: 'Russian (Русский язык)',
    };

    const mainCharsBlock =
      mainCharacterNames.length > 0
        ? `Main characters (FORBIDDEN in Clues 1–4; REQUIRED/ALLOWED in Clues 5–6): ${mainCharacterNames.join(', ')}.`
        : 'Identify the main protagonist(s) and deuteragonist(s) from the dossier. Keep their names strictly out of Clues 1–4 and use them in Clues 5–6.';

    return [
      `You are an expert anime trivia game master creating 6 progressive deduction clues for a mystery anime.`,
      ``,
      `MANDATORY TRANSLATION & TARGET LANGUAGE RULE (targetLang="${lang}"):`,
      `The source dossier below is in English, but you MUST translate and rewrite ALL 6 clues completely into natural, idiomatic ${targetLanguageNames[lang]} matching targetLang="${lang}".`,
      `NEVER copy-paste raw English sentences from the dossier when targetLang is 'uk' or 'ru'. Every single clue must read like it was written natively in ${targetLanguageNames[lang]}.`,
      ``,
      `OUTPUT FORMAT: Return STRICT JSON ONLY matching this exact schema:`,
      `{"hard": ["clue 1", "clue 2"], "medium": ["clue 3", "clue 4"], "easy": ["clue 5", "clue 6"]}`,
      ``,
      `STRICTLY FORBIDDEN GENERIC TEMPLATES:`,
      `- NEVER list raw AniList genre or tag names (e.g. NEVER write "у жанрах: Action, Drama, Mecha", "в жанрах: ...", "genres include ...", or comma-separated English tags).`,
      `- Every clue must convey concrete story details, trivia, mechanics, scenes, or character identities — NEVER vague filler.`,
      ``,
      `EXACT 6-CLUE DIFFICULTY PROGRESSION:`,
      `- Clues 1 & 2 ("hard"): Obscure Fandom trivia, background details, specific world rules, or minor side-character quirks.`,
      `  STRICTLY FORBIDDEN in Clues 1–2: NO main character names and NO anime title.`,
      `- Clues 3 & 4 ("medium"): The core plot premise, central conflict, or unique mechanics of the story (for example: a viral outbreak in Japan and a teenager gaining the power to pull weapons/Voids out of people's chests).`,
      `  STRICTLY FORBIDDEN in Clues 3–4: NO main character names (refer to them only by role/traits), NO anime title, and NO repeating Clues 1–2.`,
      `- Clue 5 ("easy"[0]): Iconic turning points, famous memes/scenes, or the names of the main characters (e.g. Shu Ouma, Inori Yuzuriha...) and their roles — without repeating Clues 1–4 or naming the anime.`,
      `- Clue 6 ("easy"[1] — FINAL GIVEAWAY): A direct, crystal-clear summary combining the release year, animation studio (if known), the protagonist's most famous iconic premise/signature ability, and the main character names so anyone who has watched the show immediately recognizes it — still without writing the exact anime title itself and without repeating earlier clues.`,
      ``,
      mainCharsBlock,
      ``,
      `NO-REPEAT RULE (CRITICAL):`,
      `All 6 clues MUST describe 6 completely distinct facts/aspects. Clue 5 and Clue 6 must NEVER paraphrase or repeat Clue 1, 2, 3, or 4.`,
      ``,
      `FORBIDDEN ANIME TITLES (NEVER WRITE THESE IN ANY CLUE):`,
      `${forbiddenTitles.join(' / ') || 'N/A'}`,
      `If a character's name is identical to the exact anime title, never write that exact title; refer to their surname, nickname, role, or companions instead.`,
      ``,
      `STYLE: Keep each clue vivid, concrete, and concise (1–2 sentences).`,
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

    const cleanedDescription = this.cleanHtml(
      dossier.anilistDescription ?? dossier.description ?? '',
      1500,
    );
    const cleanedWikiPlot = this.cleanHtml(dossier.wikipediaPlot ?? '', 1400);
    const seasonYear = dossier.seasonYear ?? anime.year ?? null;
    const studios = (dossier.studios ?? []).filter(Boolean);

    const charactersText = (dossier.characters ?? [])
      .slice(0, 10)
      .map(
        (c) =>
          `- ${c.name}${c.role ? ` [${c.role}]` : ''}: ${this.cleanHtml(c.description ?? '', 240)}`,
      )
      .join('\n');

    const triviaText = (dossier.fandomTrivia ?? [])
      .slice(0, 8)
      .map((t) => `- ${this.cleanHtml(t, 280)}`)
      .join('\n');

    return [
      `Target Language (targetLang): ${languageLabel[lang]}`,
      `Remember: Translate and rewrite EVERY clue natively into ${languageLabel[lang]}. Do NOT leave English sentences untranslated.`,
      `Romaji Title (DO NOT MENTION): ${anime.titleRomaji ?? 'N/A'}`,
      `English Title (DO NOT MENTION): ${anime.titleEn ?? 'N/A'}`,
      `Ukrainian Title (DO NOT MENTION): ${anime.titleUk ?? 'N/A'}`,
      `Russian Title (DO NOT MENTION): ${anime.titleRu ?? 'N/A'}`,
      `Release Year (seasonYear): ${seasonYear ?? 'Unknown'}`,
      `Animation Studios: ${studios.length > 0 ? studios.join(', ') : 'Unknown'}`,
      `Format: ${anime.type ?? 'TV'}`,
      `Main Characters (FORBIDDEN in Clues 1–4; use in Clues 5–6): ${mainCharacterNames.join(', ') || 'See Characters list below'}`,
      `English Source — AniList Plot Description:\n${cleanedDescription || 'N/A'}`,
      `English Source — Wikipedia Plot Summary:\n${cleanedWikiPlot || 'N/A'}`,
      `English Source — Characters:\n${charactersText || 'N/A'}`,
      `English Source — Fandom Wiki Trivia & Memes:\n${triviaText || 'N/A'}`,
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

    const allClues = [...hard, ...medium, ...easy];

    // Reject duplicate clues across tiers
    const normalizedSet = new Set(allClues.map((c) => c.toLowerCase()));
    if (normalizedSet.size < 6) {
      throw new Error('AI response contained duplicate clues across tiers');
    }

    // Reject banned generic genre-list templates
    if (allClues.some((c) => BANNED_GENRE_TEMPLATE_RE.test(c))) {
      throw new Error(
        'AI response contained forbidden generic genre-list template wording',
      );
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

    // Ensure Ukrainian and Russian responses use Cyrillic script and do not leak raw English sentences
    if (lang === 'uk' || lang === 'ru') {
      for (const clue of [first, second]) {
        if (!CYRILLIC_RE.test(clue)) {
          throw new Error(
            `AI returned non-Cyrillic text for target language "${lang}" in "${tier}" tier`,
          );
        }
        if (LEAKED_ENGLISH_SENTENCE_RE.test(clue)) {
          throw new Error(
            `AI leaked untranslated English sentence for target language "${lang}" in "${tier}" tier`,
          );
        }
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

  private scrubMainNames(text: string, mainCharacterNames: string[]): string {
    let scrubbed = text;
    for (const fullName of mainCharacterNames) {
      const tokens = fullName
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3);
      for (const token of [fullName, ...tokens]) {
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        scrubbed = scrubbed.replace(
          new RegExp(`\\b${escaped}\\b`, 'gi'),
          'the protagonist',
        );
      }
    }
    return scrubbed;
  }

  private cleanHtml(text: string, maxLen = 1400): string {
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
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLen);
  }

  private splitSentences(text: string): string[] {
    if (!text) return [];
    return text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 25);
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
          JSON.stringify({
            hard: clueSet.hard,
            medium: clueSet.medium,
            easy: clueSet.easy,
          }),
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
        const all = [...parsed.hard, ...parsed.medium, ...parsed.easy];
        if (all.some((c) => BANNED_GENRE_TEMPLATE_RE.test(c))) {
          return null;
        }
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Offline fallback when both Groq and Gemini are unavailable and no LLM backup exists in Redis.
   * Splits real plot sentences from `dossier.description` / `wikipediaPlot`, Fandom trivia,
   * `seasonYear`, `studios`, and `characters` across 6 distinct steps without ever outputting
   * generic genre-list templates.
   */
  private synthesizeFallbackFromDossier(
    anime: Anime,
    dossier: AnimeDossier,
    lang: SupportedLanguage,
    forbiddenTitles: string[],
  ): GeneratedClueSet {
    const mainChars = this.extractMainCharacterNames(dossier).slice(0, 4);
    const supportingChars = (dossier.characters ?? [])
      .filter((c) => (c.role ?? '').toUpperCase() !== 'MAIN')
      .slice(0, 3)
      .map((c) => c.name);
    const mainCharDetails = (dossier.characters ?? [])
      .filter((c) => (c.role ?? '').toUpperCase() === 'MAIN')
      .slice(0, 2)
      .map((c) => {
        const firstLine = this.splitSentences(
          this.cleanHtml(c.description ?? '', 260),
        )[0];
        return firstLine ? `${c.name} — ${firstLine}` : c.name;
      });

    const cleanedDesc = this.cleanHtml(
      dossier.anilistDescription ?? dossier.description ?? '',
      1500,
    );
    const cleanedWiki = this.cleanHtml(dossier.wikipediaPlot ?? '', 1200);
    const plotSentences = Array.from(
      new Set([
        ...this.splitSentences(cleanedDesc),
        ...this.splitSentences(cleanedWiki),
      ]),
    );

    const triviaItems = (dossier.fandomTrivia ?? [])
      .map((t) => this.cleanHtml(t, 260))
      .filter((t) => t.length >= 25);

    const seasonYear = dossier.seasonYear ?? anime.year ?? null;
    const studios = (dossier.studios ?? []).filter(Boolean);
    const studioText = studios.join(', ');
    const formatText = anime.type ?? 'TV';

    const scrubAll = (s: string) =>
      this.scrubForbiddenTitles(s, forbiddenTitles);
    const scrubNoMain = (s: string) =>
      this.scrubMainNames(scrubAll(s), mainChars);

    const plot1 = plotSentences[0] ?? '';
    const plot2 = plotSentences[1] ?? '';
    const plot3 = plotSentences[2] ?? '';
    const plot4 = plotSentences[3] ?? '';

    const rawHard1 = triviaItems[0] || plot3 || '';
    const rawHard2 = triviaItems[1] || '';
    const rawMed1 = plot1;
    const rawMed2 = plot2 || plot4 || '';
    const rawEasyGiveawayPlot = plot4 || plot3 || plot1 || '';

    if (lang === 'uk') {
      const hard1 = rawHard1
        ? `Цікавий факт про світ цієї історії: ${scrubNoMain(rawHard1)}`
        : studioText
          ? `Над виробництвом цього тайтлу (${formatText}) працювала студія ${studioText}.`
          : `Це аніме формату ${formatText} вирізняється впізнаваними правилами свого світу та прихованими деталями лору.`;

      const hard2 = rawHard2
        ? `Фандомна деталь: ${scrubNoMain(rawHard2)}`
        : supportingChars.length > 0
          ? `Серед другорядних персонажів історії з'являються: ${supportingChars.join(', ')}.`
          : seasonYear
            ? `Прем'єра цього серіалу (${formatText}) відбулася у ${seasonYear} році.`
            : `У центрі подій стоїть незвичний конфлікт із нестандартними правилами протистояння.`;

      const med1 = rawMed1
        ? `Сюжетна зав'язка: ${scrubNoMain(rawMed1)}`
        : `Головний герой опиняється у центрі кризи, яка змушує його по-новому поглянути на власні можливості.`;

      const med2 = rawMed2
        ? `Розвиток конфлікту: ${scrubNoMain(rawMed2)}`
        : `Ключова механіка історії поступово змінює баланс сил між ворогуючими сторонами.`;

      const easy1 =
        mainCharDetails.length > 0
          ? `Ключові герої цієї історії: ${scrubAll(mainCharDetails.join(' | '))}`
          : mainChars.length > 0
            ? `Головними дійовими особами цієї історії є ${mainChars.join(', ')}.`
            : `Сюжетний поворот із головним героєм став однією з найвідоміших сцен цього аніме.`;

      const giveawayParts: string[] = [];
      if (seasonYear) giveawayParts.push(`рік виходу — ${seasonYear}`);
      if (studioText) giveawayParts.push(`студія — ${studioText}`);
      if (mainChars.length > 0) {
        giveawayParts.push(`головні персонажі — ${mainChars.join(', ')}`);
      }
      const easy2 = scrubAll(
        giveawayParts.length > 0
          ? `Фінальна підказка: ${giveawayParts.join('; ')}.${rawEasyGiveawayPlot ? ` Сюжет: ${rawEasyGiveawayPlot.slice(0, 220)}` : ''}`
          : `Фінальна підказка (${formatText}): ${rawEasyGiveawayPlot.slice(0, 260) || 'культова історія з яскравим головним героєм і впізнаваною розвʼязкою.'}`,
      );

      return {
        hard: [scrubAll(hard1), scrubAll(hard2)],
        medium: [scrubAll(med1), scrubAll(med2)],
        easy: [scrubAll(easy1), scrubAll(easy2)],
      };
    }

    if (lang === 'ru') {
      const hard1 = rawHard1
        ? `Интересный факт о мире этой истории: ${scrubNoMain(rawHard1)}`
        : studioText
          ? `Над созданием этого тайтла (${formatText}) работала студия ${studioText}.`
          : `Это аниме формата ${formatText} выделяется узнаваемыми правилами мира и скрытыми деталями лора.`;

      const hard2 = rawHard2
        ? `Деталь из фандома: ${scrubNoMain(rawHard2)}`
        : supportingChars.length > 0
          ? `Среди второстепенных персонажей истории фигурируют: ${supportingChars.join(', ')}.`
          : seasonYear
            ? `Премьера этого аниме (${formatText}) состоялась в ${seasonYear} году.`
            : `В центре событий лежит нестандартный конфликт с особыми правилами противостояния.`;

      const med1 = rawMed1
        ? `Завязка сюжета: ${scrubNoMain(rawMed1)}`
        : `Главный герой оказывается в центре кризиса, который заставляет его раскрыть необычные способности.`;

      const med2 = rawMed2
        ? `Развитие конфликта: ${scrubNoMain(rawMed2)}`
        : `Ключевая механика истории постепенно меняет расстановку сил между сторонами конфликта.`;

      const easy1 =
        mainCharDetails.length > 0
          ? `Ключевые герои этой истории: ${scrubAll(mainCharDetails.join(' | '))}`
          : mainChars.length > 0
            ? `Главными действующими лицами этой истории являются ${mainChars.join(', ')}.`
            : `Кульминационный поворот с главным героем стал одной из самых узнаваемых сцен этого аниме.`;

      const giveawayParts: string[] = [];
      if (seasonYear) giveawayParts.push(`год выхода — ${seasonYear}`);
      if (studioText) giveawayParts.push(`студия — ${studioText}`);
      if (mainChars.length > 0) {
        giveawayParts.push(`главные персонажи — ${mainChars.join(', ')}`);
      }
      const easy2 = scrubAll(
        giveawayParts.length > 0
          ? `Финальная подсказка: ${giveawayParts.join('; ')}.${rawEasyGiveawayPlot ? ` Сюжет: ${rawEasyGiveawayPlot.slice(0, 220)}` : ''}`
          : `Финальная подсказка (${formatText}): ${rawEasyGiveawayPlot.slice(0, 260) || 'культовая история с ярким протагонистом и запоминающейся развязкой.'}`,
      );

      return {
        hard: [scrubAll(hard1), scrubAll(hard2)],
        medium: [scrubAll(med1), scrubAll(med2)],
        easy: [scrubAll(easy1), scrubAll(easy2)],
      };
    }

    const hard1 = rawHard1
      ? `World & trivia detail: ${scrubNoMain(rawHard1)}`
      : studioText
        ? `This ${formatText} title was animated by ${studioText}.`
        : `This ${formatText} series features distinctive world rules and background lore details.`;

    const hard2 = rawHard2
      ? `Community trivia: ${scrubNoMain(rawHard2)}`
      : supportingChars.length > 0
        ? `Supporting characters in this world include ${supportingChars.join(', ')}.`
        : seasonYear
          ? `This ${formatText} anime originally premiered in ${seasonYear}.`
          : `Its story revolves around an unusual conflict with high-stakes rules.`;

    const med1 = rawMed1
      ? `Story premise: ${scrubNoMain(rawMed1)}`
      : `The protagonist is pulled into a sudden crisis that forces them to rely on an extraordinary power.`;

    const med2 = rawMed2
      ? `Central conflict: ${scrubNoMain(rawMed2)}`
      : `A signature mechanic drives the escalating struggle between rival factions.`;

    const easy1 =
      mainCharDetails.length > 0
        ? `Lead characters: ${scrubAll(mainCharDetails.join(' | '))}`
        : mainChars.length > 0
          ? `The main characters leading this story are ${mainChars.join(', ')}.`
          : `Its signature plot twist and iconic protagonist moments are immediately recognizable to fans.`;

    const enGiveawayParts: string[] = [];
    if (seasonYear) enGiveawayParts.push(`released in ${seasonYear}`);
    if (studioText) enGiveawayParts.push(`animated by ${studioText}`);
    if (mainChars.length > 0) {
      enGiveawayParts.push(`starring ${mainChars.join(', ')}`);
    }
    const easy2 = scrubAll(
      enGiveawayParts.length > 0
        ? `Final giveaway: ${enGiveawayParts.join(', ')}.${rawEasyGiveawayPlot ? ` Premise: ${rawEasyGiveawayPlot.slice(0, 220)}` : ''}`
        : `Final giveaway (${formatText}): ${rawEasyGiveawayPlot.slice(0, 260) || 'An iconic series defined by its unforgettable lead and premise.'}`,
    );

    return {
      hard: [scrubAll(hard1), scrubAll(hard2)],
      medium: [scrubAll(med1), scrubAll(med2)],
      easy: [scrubAll(easy1), scrubAll(easy2)],
    };
  }
}
