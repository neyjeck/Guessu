import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Anime } from '@prisma/client';
import { cleanScrapedText } from '../anime/anime-enrichment.service';
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
const SCRAPER_ARTIFACT_RE =
  /(?:\[\*{3}\]|\(\s*Source\s*:|\(\s*Japanese\s*:|Hepburn\s*:)/i;

@Injectable()
export class AiClueService implements OnModuleInit {
  private readonly logger = new Logger(AiClueService.name);
  private static readonly REDIS_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
  private static readonly REQUEST_TIMEOUT_MS = 18_000;
  private static readonly MAX_COMPLETION_TOKENS = 1400;
  private static readonly GEMINI_503_RETRY_DELAY_MS = 1_000;
  private static readonly GROQ_FALLBACK_MODELS = [
    'openai/gpt-oss-120b',
    'qwen/qwen3.8-27b',
    'openai/gpt-oss-20b',
    'llama-3.3-70b-versatile',
  ];
  private static readonly GEMINI_FALLBACK_MODELS = [
    'gemini-3.8-flash',
    'gemini-2.5-flash',
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
      'openai/gpt-oss-120b';
    const geminiModel =
      this.configService.get<string>('GEMINI_MODEL')?.trim() ||
      'gemini-3.8-flash';

    this.logger.log(
      `Groq API key loaded: ${groqLoaded} (configured model=${groqModel})`,
    );
    this.logger.log(
      `Gemini API key loaded: ${geminiLoaded} (configured model=${geminiModel})`,
    );

    if (!groqLoaded && !geminiLoaded) {
      const msg =
        'Neither GROQ_API_KEY nor GEMINI_API_KEY is configured in backend/.env! ' +
        'Clue generation will fall back to offline synthesis (isFallback=true) until a valid key is set.';
      this.logger.error(msg);
      console.error(`[AiClueService] ${msg}`);
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
   *  3. Emergency Redis cache (`ai_clues:<animeId>:<lang>`, bypassing/purging any stale fallback entries)
   *  4. Offline deterministic dossier synthesis (`isFallback: true`, zero `[***]` or scraper artifacts)
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

    // 1. Primary: Groq (automatically fails over across live Groq models on 404/429/malformed JSON)
    try {
      const sanitized = await this.callGroq(
        systemPrompt,
        userPrompt,
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
      const errLine = `[Groq FAILED] animeId=${anime.id} (${anime.titleRomaji ?? anime.titleEn ?? 'Unknown'}, lang=${normalizedLang}): ${groqErrMsg}`;
      this.logger.error(errLine);
      console.error(errLine);
    }

    // 2. Fallback: Google Gemini (with 1s retry on transient HTTP 503 UNAVAILABLE)
    try {
      const sanitized = await this.callGemini(
        systemPrompt,
        userPrompt,
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
      const errLine = `[Gemini FAILED] animeId=${anime.id} (${anime.titleRomaji ?? anime.titleEn ?? 'Unknown'}, lang=${normalizedLang}): ${geminiErrMsg}`;
      this.logger.error(errLine);
      console.error(errLine);
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
    const fallbackNotice =
      `[AI FALLBACK ACTIVE] Both Groq and Gemini failed for animeId=${anime.id} (${normalizedLang}). ` +
      `GroqError="${groqErrMsg}" | GeminiError="${geminiErrMsg}"`;
    this.logger.error(fallbackNotice);
    console.error(fallbackNotice);

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
    forbiddenTitles: string[],
    lang: SupportedLanguage,
  ): Promise<GeneratedClueSet> {
    const apiKey = this.configService.get<string>('GROQ_API_KEY')?.trim();
    if (!apiKey || apiKey.startsWith('gsk_your_')) {
      throw new Error(
        'GROQ_API_KEY is missing or still set to placeholder in backend/.env',
      );
    }

    const configuredModel =
      this.configService.get<string>('GROQ_MODEL')?.trim() ||
      'openai/gpt-oss-120b';
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
        const bodyPayload: Record<string, unknown> = {
          model,
          temperature: 0.85,
          max_completion_tokens: AiClueService.MAX_COMPLETION_TOKENS,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        };

        if (model.startsWith('openai/gpt-oss')) {
          bodyPayload.reasoning_effort = 'low';
        }

        const response = await fetch(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(bodyPayload),
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          const errBody = await response.text().catch(() => '');
          lastError = new Error(
            `Groq API HTTP ${response.status} (model=${model}): ${errBody.slice(0, 500)}`,
          );

          // Automatically fail over to the next Groq model on 404/429/503
          if (
            response.status === 404 ||
            response.status === 429 ||
            response.status === 503 ||
            errBody.includes('model_not_found') ||
            errBody.includes('model_decommissioned') ||
            errBody.includes('rate_limit_exceeded')
          ) {
            this.logger.warn(
              `Groq model "${model}" unavailable/rate-limited (HTTP ${response.status}); trying next Groq model...`,
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
          lastError = new Error(
            `Groq returned empty message content (model=${model})`,
          );
          this.logger.warn(`${lastError.message}; trying next Groq model...`);
          continue;
        }

        try {
          const parsed = this.parseJsonObject(rawContent, `Groq(${model})`);
          const validated = this.validateAndSanitizeClueSet(
            parsed,
            forbiddenTitles,
            lang,
          );
          if (model !== configuredModel) {
            this.logger.log(
              `Groq clue generation succeeded using fallback model="${model}"`,
            );
          }
          return validated;
        } catch (validationErr) {
          const msg =
            validationErr instanceof Error
              ? validationErr.message
              : String(validationErr);
          lastError = new Error(`Groq(${model}): ${msg}`);
          this.logger.warn(
            `Groq model "${model}" returned invalid clue structure (${msg}); trying next Groq model...`,
          );
          continue;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError;
  }

  private async callGemini(
    systemPrompt: string,
    userPrompt: string,
    forbiddenTitles: string[],
    lang: SupportedLanguage,
  ): Promise<GeneratedClueSet> {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY')?.trim();
    if (!apiKey || apiKey.startsWith('your_')) {
      throw new Error(
        'GEMINI_API_KEY is missing or still set to placeholder in backend/.env',
      );
    }

    const configuredModel =
      this.configService.get<string>('GEMINI_MODEL')?.trim() ||
      'gemini-3.8-flash';
    const candidateModels = Array.from(
      new Set([configuredModel, ...AiClueService.GEMINI_FALLBACK_MODELS]),
    );

    let lastError = new Error('Gemini call failed');

    for (const model of candidateModels) {
      for (let attempt = 1; attempt <= 2; attempt++) {
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
                temperature: 0.85,
                maxOutputTokens: AiClueService.MAX_COMPLETION_TOKENS,
                responseMimeType: 'application/json',
              },
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            const errBody = await response.text().catch(() => '');
            lastError = new Error(
              `Gemini API HTTP ${response.status} (model=${model}): ${errBody.slice(0, 500)}`,
            );

            if (response.status === 503 && attempt === 1) {
              this.logger.warn(
                `Gemini model "${model}" returned transient HTTP 503; retrying in ${AiClueService.GEMINI_503_RETRY_DELAY_MS}ms...`,
              );
              await this.delay(AiClueService.GEMINI_503_RETRY_DELAY_MS);
              continue;
            }

            if (
              response.status === 404 ||
              response.status === 429 ||
              response.status === 503
            ) {
              this.logger.warn(
                `Gemini model "${model}" unavailable/rate-limited (HTTP ${response.status}); trying next Gemini model...`,
              );
              break;
            }

            throw lastError;
          }

          const data = (await response.json()) as {
            candidates?: Array<{
              content?: { parts?: Array<{ text?: string }> };
            }>;
          };
          const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!rawText) {
            lastError = new Error(
              `Gemini returned empty candidate content (model=${model})`,
            );
            break;
          }

          const parsed = this.parseJsonObject(rawText, `Gemini(${model})`);
          const validated = this.validateAndSanitizeClueSet(
            parsed,
            forbiddenTitles,
            lang,
          );
          if (model !== configuredModel) {
            this.logger.log(
              `Gemini clue generation succeeded using fallback model="${model}"`,
            );
          }
          return validated;
        } finally {
          clearTimeout(timeout);
        }
      }
    }

    throw lastError;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Strips markdown code fences (` ```json ... ``` `) and extracts the JSON object cleanly
   * before calling `JSON.parse()`.
   */
  private parseJsonObject(rawText: string, providerLabel: string): unknown {
    let cleaned = rawText.trim();

    // Strip fenced markdown code blocks anywhere in the response
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch && fenceMatch[1]) {
      cleaned = fenceMatch[1].trim();
    } else {
      cleaned = cleaned
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
    }

    // Extract outermost JSON object if surrounded by explanatory text
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }

    try {
      return JSON.parse(cleaned);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `${providerLabel} returned invalid JSON (${msg}): ${cleaned.slice(0, 240)}`,
      );
    }
  }

  private buildSystemPrompt(
    lang: SupportedLanguage,
    forbiddenTitles: string[],
    mainCharacterNames: string[],
  ): string {
    const targetLanguageNames: Record<SupportedLanguage, string> = {
      uk: 'Ukrainian',
      en: 'English',
      ru: 'Russian',
    };

    return [
      `Anime trivia master. Return STRICT JSON ONLY: {"hard":["c1","c2"],"medium":["c3","c4"],"easy":["c5","c6"]}.`,
      `LANGUAGE: Source dossier is English, but translate and write ALL 6 clues natively in idiomatic ${targetLanguageNames[lang]} (targetLang="${lang}"). NEVER copy English sentences when targetLang is uk/ru.`,
      `BANNED: Never list genre/tag names (e.g. "у жанрах: Action..."), never write "[***]", "(Source:...)", "(Japanese:...)", or the anime title (${forbiddenTitles.slice(0, 6).join(' / ') || 'N/A'}).`,
      `TIERS (6 completely distinct facts, zero repetition, 1-2 short sentences each):`,
      `- hard[0..1]: Obscure trivia, world rules, or minor side-character quirks. NO main character names.`,
      `- medium[0..1]: Core plot premise, central conflict, or unique story mechanics. NO main character names.`,
      `- easy[0]: Iconic turning points, famous scenes/memes, or main character names and roles.`,
      `- easy[1]: Crystal-clear final giveaway combining release year, studio, iconic protagonist ability/premise, and main character names (without naming the anime).`,
      mainCharacterNames.length > 0
        ? `Main chars (forbidden in hard/medium, use in easy): ${mainCharacterNames.join(', ')}.`
        : `Keep main protagonist names out of hard/medium; use them in easy.`,
    ].join('\n');
  }

  private buildUserPrompt(
    anime: Anime,
    dossier: AnimeDossier,
    lang: SupportedLanguage,
    mainCharacterNames: string[],
  ): string {
    const cleanedDescription = cleanScrapedText(
      dossier.anilistDescription ?? dossier.description ?? '',
      650,
    );
    const wikiMaxLen = cleanedDescription.length >= 420 ? 320 : 600;
    const cleanedWikiPlot = cleanScrapedText(
      dossier.wikipediaPlot ?? '',
      wikiMaxLen,
    );
    const seasonYear = dossier.seasonYear ?? anime.year ?? null;
    const studios = (dossier.studios ?? []).filter(Boolean).slice(0, 3);

    const charactersText = (dossier.characters ?? [])
      .slice(0, 6)
      .map(
        (c) =>
          `${c.name}${c.role ? `[${c.role}]` : ''}: ${cleanScrapedText(c.description ?? '', 90)}`,
      )
      .join('\n');

    const triviaText = (dossier.fandomTrivia ?? [])
      .slice(0, 4)
      .map((t) => `- ${cleanScrapedText(t, 150)}`)
      .join('\n');

    const lines = [
      `targetLang=${lang}`,
      `Forbidden titles: ${[anime.titleRomaji, anime.titleEn, anime.titleUk, anime.titleRu].filter(Boolean).join(' | ')}`,
      `Year: ${seasonYear ?? '?'} | Studio: ${studios.join(', ') || '?'} | Format: ${anime.type ?? 'TV'}`,
      `Main chars: ${mainCharacterNames.join(', ') || 'see below'}`,
    ];

    if (cleanedDescription) lines.push(`Plot: ${cleanedDescription}`);
    if (cleanedWikiPlot) lines.push(`Wiki: ${cleanedWikiPlot}`);
    if (charactersText) lines.push(`Chars:\n${charactersText}`);
    if (triviaText) lines.push(`Trivia:\n${triviaText}`);

    return lines.join('\n');
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
    ).sort((a, b) => b.length - a.length);
  }

  private extractClueString(entry: unknown): string {
    if (typeof entry === 'string') return entry.trim();
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const rec = entry as Record<string, unknown>;
      const candidate = rec.text ?? rec.clue ?? rec.content ?? rec.value;
      if (typeof candidate === 'string') return candidate.trim();
    }
    return '';
  }

  private extractTierValues(
    obj: Record<string, unknown>,
    tierName: 'hard' | 'medium' | 'easy',
  ): unknown[] | null {
    const matchedKey = Object.keys(obj).find(
      (k) => k.toLowerCase() === tierName,
    );
    if (!matchedKey) return null;
    const val = obj[matchedKey];
    if (Array.isArray(val)) return val;
    if (val && typeof val === 'object') {
      return Object.values(val as Record<string, unknown>);
    }
    return null;
  }

  private validateAndSanitizeClueSet(
    raw: unknown,
    forbiddenTitles: string[],
    lang: SupportedLanguage,
  ): GeneratedClueSet {
    if (!raw || typeof raw !== 'object') {
      throw new Error('AI response is not a JSON object');
    }

    let rawHard: unknown[] | null = null;
    let rawMedium: unknown[] | null = null;
    let rawEasy: unknown[] | null = null;

    if (Array.isArray(raw) && raw.length >= 6) {
      rawHard = raw.slice(0, 2);
      rawMedium = raw.slice(2, 4);
      rawEasy = raw.slice(4, 6);
    } else {
      const obj = raw as Record<string, unknown>;
      rawHard = this.extractTierValues(obj, 'hard');
      rawMedium = this.extractTierValues(obj, 'medium');
      rawEasy = this.extractTierValues(obj, 'easy');

      // Fallback: flat 6-item list under `clues` or across object values
      if (
        !rawHard ||
        rawHard.length < 2 ||
        !rawMedium ||
        rawMedium.length < 2 ||
        !rawEasy ||
        rawEasy.length < 2
      ) {
        const flatList: string[] = [];
        const cluesField = obj.clues;
        if (Array.isArray(cluesField)) {
          for (const item of cluesField) {
            const s = this.extractClueString(item);
            if (s) flatList.push(s);
          }
        } else {
          for (const val of Object.values(obj)) {
            if (Array.isArray(val)) {
              for (const item of val) {
                const s = this.extractClueString(item);
                if (s) flatList.push(s);
              }
            } else {
              const s = this.extractClueString(val);
              if (s) flatList.push(s);
            }
          }
        }
        if (flatList.length >= 6) {
          rawHard = flatList.slice(0, 2);
          rawMedium = flatList.slice(2, 4);
          rawEasy = flatList.slice(4, 6);
        }
      }
    }

    const hard = this.normalizePair(rawHard, 'hard', forbiddenTitles, lang);
    const medium = this.normalizePair(
      rawMedium,
      'medium',
      forbiddenTitles,
      lang,
    );
    const easy = this.normalizePair(rawEasy, 'easy', forbiddenTitles, lang);

    const allClues = [...hard, ...medium, ...easy];

    // Reject duplicate clues across tiers
    const normalizedSet = new Set(allClues.map((c) => c.toLowerCase()));
    if (normalizedSet.size < 6) {
      throw new Error('AI response contained duplicate clues across tiers');
    }

    // Reject banned generic genre-list templates or leaked scraper artifacts
    if (allClues.some((c) => BANNED_GENRE_TEMPLATE_RE.test(c))) {
      throw new Error(
        'AI response contained forbidden generic genre-list template wording',
      );
    }
    if (allClues.some((c) => SCRAPER_ARTIFACT_RE.test(c))) {
      throw new Error(
        'AI response contained forbidden placeholder or raw scraper citation artifact',
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

    const first = this.replaceForbiddenTitlesNaturally(
      cleanScrapedText(this.extractClueString(value[0]), 500),
      forbiddenTitles,
      lang,
    );
    const second = this.replaceForbiddenTitlesNaturally(
      cleanScrapedText(this.extractClueString(value[1]), 500),
      forbiddenTitles,
      lang,
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

  /**
   * Replaces accidental anime title leaks with natural language in the target locale
   * rather than injecting ugly `[***]` placeholders.
   */
  private replaceForbiddenTitlesNaturally(
    text: string,
    forbiddenTitles: string[],
    lang: SupportedLanguage,
  ): string {
    const replacementByLang: Record<SupportedLanguage, string> = {
      uk: 'це аніме',
      ru: 'это аниме',
      en: 'this anime',
    };
    const replacement = replacementByLang[lang];

    let sanitized = text.replace(/\[\*{3}\]/g, replacement);
    for (const title of forbiddenTitles) {
      if (title.length < 4) continue;
      const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'gi');
      sanitized = sanitized.replace(regex, replacement);
    }
    return sanitized.replace(/\s+/g, ' ').trim();
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

  private splitCleanPlotSentences(
    text: string,
    forbiddenTitles: string[],
  ): string[] {
    if (!text) return [];
    const cleaned = cleanScrapedText(text, 1600);
    return cleaned
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => {
        if (s.length < 30) return false;
        // Skip Wikipedia boilerplate definition sentences ("X is a 2011 Japanese anime television series...")
        if (
          /\bis a(?:n)?\s+(?:\d{4}\s+)?Japanese\s+(?:anime|manga|light novel|original|animated)/i.test(
            s,
          )
        ) {
          return false;
        }
        // Skip sentences that still contain raw title strings so we don't need awkward redactions
        const lower = s.toLowerCase();
        if (
          forbiddenTitles.some(
            (t) => t.length >= 4 && lower.includes(t.toLowerCase()),
          )
        ) {
          return false;
        }
        return true;
      });
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
    if (clueSet.isFallback) {
      return;
    }
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
            isFallback: false,
            provider: clueSet.provider ?? 'groq',
          }),
          'EX',
          AiClueService.REDIS_CACHE_TTL_SECONDS,
        );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to write Redis backup clues: ${msg}`);
    }
  }

  /**
   * Reads a cached LLM backup from Redis while automatically clearing and bypassing
   * any stale fallback entries, genre-template entries, or `[***]` / scraper artifacts.
   */
  private async getCachedBackupClues(
    animeId: number,
    lang: SupportedLanguage,
  ): Promise<GeneratedClueSet | null> {
    const key = this.buildRedisCacheKey(animeId, lang);
    try {
      const raw = await this.redisService.getClient().get(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as GeneratedClueSet;
      if (
        parsed.isFallback === true ||
        parsed.provider === 'fallback' ||
        !Array.isArray(parsed.hard) ||
        parsed.hard.length !== 2 ||
        !Array.isArray(parsed.medium) ||
        parsed.medium.length !== 2 ||
        !Array.isArray(parsed.easy) ||
        parsed.easy.length !== 2
      ) {
        await this.redisService.getClient().del(key);
        return null;
      }

      const all = [...parsed.hard, ...parsed.medium, ...parsed.easy];
      if (
        all.some(
          (c) =>
            BANNED_GENRE_TEMPLATE_RE.test(c) || SCRAPER_ARTIFACT_RE.test(c),
        )
      ) {
        await this.redisService.getClient().del(key);
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Offline fallback when both Groq and Gemini are unavailable and no LLM backup exists in Redis.
   * Uses strictly sanitized sentences from `description`, `characters`, `seasonYear`, and `studios`
   * with ZERO `[***]` tokens, ZERO `(Japanese: ...)` headers, and ZERO `(Source: ...)` citations.
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
        const descSentences = this.splitCleanPlotSentences(
          c.description ?? '',
          forbiddenTitles,
        );
        return descSentences[0] ? `${c.name} — ${descSentences[0]}` : c.name;
      });

    const plotSentences = Array.from(
      new Set([
        ...this.splitCleanPlotSentences(
          dossier.anilistDescription ?? dossier.description ?? '',
          forbiddenTitles,
        ),
        ...this.splitCleanPlotSentences(
          dossier.wikipediaPlot ?? '',
          forbiddenTitles,
        ),
      ]),
    );

    const triviaItems = (dossier.fandomTrivia ?? [])
      .map((t) => cleanScrapedText(t, 260))
      .filter(
        (t) =>
          t.length >= 25 &&
          !forbiddenTitles.some(
            (title) =>
              title.length >= 4 &&
              t.toLowerCase().includes(title.toLowerCase()),
          ),
      );

    const seasonYear = dossier.seasonYear ?? anime.year ?? null;
    const studios = (dossier.studios ?? []).filter(Boolean);
    const studioText = studios.join(', ');
    const formatText = anime.type ?? 'TV';

    const sanitize = (s: string) =>
      this.replaceForbiddenTitlesNaturally(
        cleanScrapedText(s, 360),
        forbiddenTitles,
        lang,
      );
    const sanitizeNoMain = (s: string) =>
      sanitize(this.scrubMainNames(s, mainChars));

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
        ? `Деталь світу: ${sanitizeNoMain(rawHard1)}`
        : studioText
          ? `Над виробництвом цього тайтлу (${formatText}) працювала студія ${studioText}.`
          : `Цей тайтл формату ${formatText} вирізняється незвичними правилами свого всесвіту та впізнаваною атмосферою.`;

      const hard2 = rawHard2
        ? `Факт зі світу історії: ${sanitizeNoMain(rawHard2)}`
        : supportingChars.length > 0
          ? `Серед другорядних персонажів історії з'являються: ${supportingChars.join(', ')}.`
          : seasonYear
            ? `Прем'єра цього серіалу (${formatText}) відбулася у ${seasonYear} році.`
            : `У центрі подій стоїть незвичний конфлікт із нестандартними правилами протистояння.`;

      const med1 = rawMed1
        ? `Сюжетна зав'язка: ${sanitizeNoMain(rawMed1)}`
        : `Головний герой опиняється у центрі кризи, яка змушує його по-новому розкрити власні можливості.`;

      const med2 = rawMed2
        ? `Розвиток подій: ${sanitizeNoMain(rawMed2)}`
        : `Ключова механіка історії поступово змінює баланс сил між ворогуючими сторонами.`;

      const easy1 =
        mainCharDetails.length > 0
          ? `Ключові герої цієї історії: ${sanitize(mainCharDetails.join(' | '))}`
          : mainChars.length > 0
            ? `Головними дійовими особами цієї історії є ${mainChars.join(', ')}.`
            : `Сюжетний поворот із головним героєм став однією з найвідоміших сцен цього аніме.`;

      const giveawayParts: string[] = [];
      if (seasonYear) giveawayParts.push(`рік виходу — ${seasonYear}`);
      if (studioText) giveawayParts.push(`студія — ${studioText}`);
      if (mainChars.length > 0) {
        giveawayParts.push(`головні персонажі — ${mainChars.join(', ')}`);
      }
      const easy2 = sanitize(
        giveawayParts.length > 0
          ? `Фінальна підказка: ${giveawayParts.join('; ')}.${rawEasyGiveawayPlot ? ` Сюжет: ${rawEasyGiveawayPlot.slice(0, 220)}` : ''}`
          : `Фінальна підказка (${formatText}): ${rawEasyGiveawayPlot.slice(0, 260) || 'відома історія з яскравим головним героєм і впізнаваною розвʼязкою.'}`,
      );

      return {
        hard: [sanitize(hard1), sanitize(hard2)],
        medium: [sanitize(med1), sanitize(med2)],
        easy: [sanitize(easy1), sanitize(easy2)],
      };
    }

    if (lang === 'ru') {
      const hard1 = rawHard1
        ? `Деталь мира: ${sanitizeNoMain(rawHard1)}`
        : studioText
          ? `Над созданием этого тайтла (${formatText}) работала студия ${studioText}.`
          : `Этот тайтл формата ${formatText} выделяется необычными правилами своей вселенной и узнаваемой атмосферой.`;

      const hard2 = rawHard2
        ? `Факт из мира истории: ${sanitizeNoMain(rawHard2)}`
        : supportingChars.length > 0
          ? `Среди второстепенных персонажей истории фигурируют: ${supportingChars.join(', ')}.`
          : seasonYear
            ? `Премьера этого аниме (${formatText}) состоялась в ${seasonYear} году.`
            : `В центре событий лежит нестандартный конфликт с особыми правилами противостояния.`;

      const med1 = rawMed1
        ? `Завязка сюжета: ${sanitizeNoMain(rawMed1)}`
        : `Главный герой оказывается в центре кризиса, который заставляет его раскрыть необычные способности.`;

      const med2 = rawMed2
        ? `Развитие событий: ${sanitizeNoMain(rawMed2)}`
        : `Ключевая механика истории постепенно меняет расстановку сил между сторонами конфликта.`;

      const easy1 =
        mainCharDetails.length > 0
          ? `Ключевые герои этой истории: ${sanitize(mainCharDetails.join(' | '))}`
          : mainChars.length > 0
            ? `Главными действующими лицами этой истории являются ${mainChars.join(', ')}.`
            : `Кульминационный поворот с главным героем стал одной из самых узнаваемых сцен этого аниме.`;

      const giveawayParts: string[] = [];
      if (seasonYear) giveawayParts.push(`год выхода — ${seasonYear}`);
      if (studioText) giveawayParts.push(`студия — ${studioText}`);
      if (mainChars.length > 0) {
        giveawayParts.push(`главные персонажи — ${mainChars.join(', ')}`);
      }
      const easy2 = sanitize(
        giveawayParts.length > 0
          ? `Финальная подсказка: ${giveawayParts.join('; ')}.${rawEasyGiveawayPlot ? ` Сюжет: ${rawEasyGiveawayPlot.slice(0, 220)}` : ''}`
          : `Финальная подсказка (${formatText}): ${rawEasyGiveawayPlot.slice(0, 260) || 'известная история с ярким протагонистом и запоминающейся развязкой.'}`,
      );

      return {
        hard: [sanitize(hard1), sanitize(hard2)],
        medium: [sanitize(med1), sanitize(med2)],
        easy: [sanitize(easy1), sanitize(easy2)],
      };
    }

    const hard1 = rawHard1
      ? `World detail: ${sanitizeNoMain(rawHard1)}`
      : studioText
        ? `This ${formatText} title was animated by ${studioText}.`
        : `This ${formatText} series features distinctive world rules and background lore details.`;

    const hard2 = rawHard2
      ? `Community trivia: ${sanitizeNoMain(rawHard2)}`
      : supportingChars.length > 0
        ? `Supporting characters in this world include ${supportingChars.join(', ')}.`
        : seasonYear
          ? `This ${formatText} anime originally premiered in ${seasonYear}.`
          : `Its story revolves around an unusual conflict with high-stakes rules.`;

    const med1 = rawMed1
      ? `Story premise: ${sanitizeNoMain(rawMed1)}`
      : `The protagonist is pulled into a sudden crisis that forces them to rely on an extraordinary power.`;

    const med2 = rawMed2
      ? `Central conflict: ${sanitizeNoMain(rawMed2)}`
      : `A signature mechanic drives the escalating struggle between rival factions.`;

    const easy1 =
      mainCharDetails.length > 0
        ? `Lead characters: ${sanitize(mainCharDetails.join(' | '))}`
        : mainChars.length > 0
          ? `The main characters leading this story are ${mainChars.join(', ')}.`
          : `Its signature plot twist and iconic protagonist moments are immediately recognizable to fans.`;

    const enGiveawayParts: string[] = [];
    if (seasonYear) enGiveawayParts.push(`released in ${seasonYear}`);
    if (studioText) enGiveawayParts.push(`animated by ${studioText}`);
    if (mainChars.length > 0) {
      enGiveawayParts.push(`starring ${mainChars.join(', ')}`);
    }
    const easy2 = sanitize(
      enGiveawayParts.length > 0
        ? `Final giveaway: ${enGiveawayParts.join(', ')}.${rawEasyGiveawayPlot ? ` Premise: ${rawEasyGiveawayPlot.slice(0, 220)}` : ''}`
        : `Final giveaway (${formatText}): ${rawEasyGiveawayPlot.slice(0, 260) || 'An iconic series defined by its unforgettable lead and premise.'}`,
    );

    return {
      hard: [sanitize(hard1), sanitize(hard2)],
      medium: [sanitize(med1), sanitize(med2)],
      easy: [sanitize(easy1), sanitize(easy2)],
    };
  }
}
