import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Anime } from '@prisma/client';
import {
  AiClueService,
  GeneratedClueSet,
  SupportedLanguage,
} from '../ai/ai-clue.service';
import { AnimeService } from '../anime/anime.service';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';
import { StartGameDto } from './dto/start-game.dto';
import { SubmitGuessDto } from './dto/submit-guess.dto';

export type ClueDifficulty = 'HARD' | 'MEDIUM' | 'EASY';
export type RoundStatus = 'IN_PROGRESS' | 'WON' | 'LOST';

export interface GameClueItem {
  step: number;
  difficulty: ClueDifficulty;
  text: string;
}

export interface GameGuessEntry {
  animeId: string;
  title: string;
  isCorrect: boolean;
}

export interface UserGameStats {
  currentStreak: number;
  maxStreak: number;
  rating: number;
}

export interface RevealedAnimeAnswer {
  id: string;
  anilistId: number;
  titleEn: string | null;
  titleRomaji: string;
  titleJa: string | null;
  titleUk: string | null;
  titleRu: string | null;
  synonyms: string[];
  coverUrl: string;
}

export interface RedisSoloGameState {
  targetAnimeId: string;
  lang: SupportedLanguage;
  clues: GameClueItem[];
  unlockedStep: number;
  guesses: GameGuessEntry[];
  recentAnimeIds: string[];
  status: RoundStatus;
  startedAt: string;
}

export interface SoloGameResponse {
  status: RoundStatus;
  unlockedStep: number;
  maxSteps: number;
  unlockedClues: GameClueItem[];
  allClues?: GameClueItem[];
  guesses: GameGuessEntry[];
  earnedPoints?: number;
  userStats: UserGameStats;
  answer: RevealedAnimeAnswer | null;
}

interface BufferedRoundPayload {
  targetAnimeId: string;
  lang: SupportedLanguage;
  clues: GameClueItem[];
}

@Injectable()
export class GameService {
  private readonly logger = new Logger(GameService.name);
  private static readonly MAX_STEPS = 6;
  private static readonly SOLO_SESSION_TTL_SECONDS = 2 * 60 * 60; // 2 hours
  private static readonly RECENT_HISTORY_LIMIT = 15;

  constructor(
    private readonly usersService: UsersService,
    private readonly animeService: AnimeService,
    private readonly aiClueService: AiClueService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Starts a new solo anime-guessing round for the authenticated user.
   * Stores active state in Redis (`game:solo:<userId>`, TTL 2 hours) and returns
   * ONLY Clue #1, userStats, and round metadata (zero answer leakage).
   */
  async startSoloRound(
    userId: string,
    dto: StartGameDto,
  ): Promise<SoloGameResponse> {
    const lang: SupportedLanguage =
      dto.lang === 'uk' || dto.lang === 'ru' || dto.lang === 'en'
        ? dto.lang
        : 'en';

    const user = await this.usersService.findById(userId);
    const existingState = await this.getSoloStateFromRedis(userId);
    const prevRecentIds = existingState?.recentAnimeIds ?? [];

    let targetAnimeId: string;
    let clues: GameClueItem[];

    const buffered = await this.popBufferedRound(userId, lang, prevRecentIds);
    if (buffered) {
      targetAnimeId = buffered.targetAnimeId;
      clues = buffered.clues;
    } else {
      const randomAnime = await this.animeService.getRandomAnime(prevRecentIds);
      const generated = await this.aiClueService.generateClues(
        randomAnime,
        lang,
      );
      targetAnimeId = String(randomAnime.id);
      clues = this.formatClueItems(generated);
    }

    const updatedRecentIds = [
      ...prevRecentIds.filter((id) => id !== targetAnimeId),
      targetAnimeId,
    ].slice(-GameService.RECENT_HISTORY_LIMIT);

    const newState: RedisSoloGameState = {
      targetAnimeId,
      lang,
      clues,
      unlockedStep: 1,
      guesses: [],
      recentAnimeIds: updatedRecentIds,
      status: 'IN_PROGRESS',
      startedAt: new Date().toISOString(),
    };

    await this.saveSoloStateToRedis(userId, newState);

    // Pre-warm the next round in the background so subsequent "Next Anime" clicks are near-instant
    void this.prewarmNextRound(userId, lang, updatedRecentIds);

    return {
      status: 'IN_PROGRESS',
      unlockedStep: 1,
      maxSteps: GameService.MAX_STEPS,
      unlockedClues: newState.clues.slice(0, 1),
      guesses: [],
      userStats: {
        currentStreak: user.currentStreak,
        maxStreak: user.maxStreak,
        rating: user.rating,
      },
      answer: null,
    };
  }

  /**
   * Processes a player's guess or clue skip against their active Redis session.
   */
  async submitSoloGuess(
    userId: string,
    dto: SubmitGuessDto,
  ): Promise<SoloGameResponse> {
    const state = await this.getSoloStateFromRedis(userId);
    if (!state) {
      throw new NotFoundException(
        'No active solo game session found. Please start a new round.',
      );
    }

    if (state.status !== 'IN_PROGRESS') {
      throw new BadRequestException(
        'This round has already ended. Start a new round to continue playing.',
      );
    }

    const isSkip = dto.skip === true;
    const guessedId = dto.animeId?.trim();

    if (!isSkip && !guessedId) {
      throw new BadRequestException(
        'Provide either an animeId to guess or set skip: true.',
      );
    }

    // Prevent duplicate guesses of the exact same anime in the same round
    if (
      !isSkip &&
      guessedId &&
      state.guesses.some((g) => g.animeId === guessedId)
    ) {
      throw new BadRequestException(
        'You have already guessed this anime in the current round.',
      );
    }

    const isCorrect = !isSkip && guessedId === state.targetAnimeId;

    if (!isSkip && guessedId) {
      const guessedTitle = await this.resolveAnimeDisplayTitle(
        guessedId,
        state.lang,
      );
      state.guesses.push({
        animeId: guessedId,
        title: guessedTitle,
        isCorrect,
      });
    }

    // Case 1: Correct Guess -> WON
    if (isCorrect) {
      state.status = 'WON';
      const earnedPoints = this.calculatePointsForStep(state.unlockedStep);
      const updatedUser = await this.usersService.recordGameOutcome(
        userId,
        true,
        earnedPoints,
      );
      await this.saveSoloStateToRedis(userId, state);
      const answer = await this.buildRevealedAnswer(state.targetAnimeId);

      return {
        status: 'WON',
        unlockedStep: state.unlockedStep,
        maxSteps: GameService.MAX_STEPS,
        unlockedClues: state.clues.slice(0, state.unlockedStep),
        allClues: state.clues,
        guesses: state.guesses,
        earnedPoints,
        userStats: {
          currentStreak: updatedUser.currentStreak,
          maxStreak: updatedUser.maxStreak,
          rating: updatedUser.rating,
        },
        answer,
      };
    }

    // Case 2: Wrong guess or Skip while unlockedStep < 6 -> unlock next clue, keep streak intact
    if (state.unlockedStep < GameService.MAX_STEPS) {
      state.unlockedStep += 1;
      await this.saveSoloStateToRedis(userId, state);
      const user = await this.usersService.findById(userId);

      return {
        status: 'IN_PROGRESS',
        unlockedStep: state.unlockedStep,
        maxSteps: GameService.MAX_STEPS,
        unlockedClues: state.clues.slice(0, state.unlockedStep),
        guesses: state.guesses,
        userStats: {
          currentStreak: user.currentStreak,
          maxStreak: user.maxStreak,
          rating: user.rating,
        },
        answer: null,
      };
    }

    // Case 3: unlockedStep === 6 and 6th attempt was wrong/skipped -> LOST, reset streak to 0
    state.status = 'LOST';
    const updatedUser = await this.usersService.recordGameOutcome(
      userId,
      false,
      0,
    );
    await this.saveSoloStateToRedis(userId, state);
    const answer = await this.buildRevealedAnswer(state.targetAnimeId);

    return {
      status: 'LOST',
      unlockedStep: state.unlockedStep,
      maxSteps: GameService.MAX_STEPS,
      unlockedClues: state.clues,
      allClues: state.clues,
      guesses: state.guesses,
      earnedPoints: 0,
      userStats: {
        currentStreak: updatedUser.currentStreak,
        maxStreak: updatedUser.maxStreak,
        rating: updatedUser.rating,
      },
      answer,
    };
  }

  /**
   * Immediately marks the active round as LOST, resets currentStreak to 0,
   * and reveals the target anime answer and all 6 clues.
   */
  async giveUpSoloRound(userId: string): Promise<SoloGameResponse> {
    const state = await this.getSoloStateFromRedis(userId);
    if (!state) {
      throw new NotFoundException(
        'No active solo game session found. Please start a new round.',
      );
    }

    if (state.status !== 'IN_PROGRESS') {
      throw new BadRequestException('This round has already concluded.');
    }

    state.status = 'LOST';
    const updatedUser = await this.usersService.recordGameOutcome(
      userId,
      false,
      0,
    );
    await this.saveSoloStateToRedis(userId, state);
    const answer = await this.buildRevealedAnswer(state.targetAnimeId);

    return {
      status: 'LOST',
      unlockedStep: state.unlockedStep,
      maxSteps: GameService.MAX_STEPS,
      unlockedClues: state.clues,
      allClues: state.clues,
      guesses: state.guesses,
      earnedPoints: 0,
      userStats: {
        currentStreak: updatedUser.currentStreak,
        maxStreak: updatedUser.maxStreak,
        rating: updatedUser.rating,
      },
      answer,
    };
  }

  private calculatePointsForStep(step: number): number {
    if (step <= 2) return 30;
    if (step <= 4) return 20;
    return 10;
  }

  private formatClueItems(generated: GeneratedClueSet): GameClueItem[] {
    return [
      { step: 1, difficulty: 'HARD', text: generated.hard[0] },
      { step: 2, difficulty: 'HARD', text: generated.hard[1] },
      { step: 3, difficulty: 'MEDIUM', text: generated.medium[0] },
      { step: 4, difficulty: 'MEDIUM', text: generated.medium[1] },
      { step: 5, difficulty: 'EASY', text: generated.easy[0] },
      { step: 6, difficulty: 'EASY', text: generated.easy[1] },
    ];
  }

  private buildSoloKey(userId: string): string {
    return `game:solo:${userId}`;
  }

  private buildBufferKey(userId: string, lang: SupportedLanguage): string {
    return `game:solo:next:${userId}:${lang}`;
  }

  private async getSoloStateFromRedis(
    userId: string,
  ): Promise<RedisSoloGameState | null> {
    try {
      const raw = await this.redisService
        .getClient()
        .get(this.buildSoloKey(userId));
      if (!raw) return null;
      return JSON.parse(raw) as RedisSoloGameState;
    } catch {
      return null;
    }
  }

  private async saveSoloStateToRedis(
    userId: string,
    state: RedisSoloGameState,
  ): Promise<void> {
    await this.redisService
      .getClient()
      .set(
        this.buildSoloKey(userId),
        JSON.stringify(state),
        'EX',
        GameService.SOLO_SESSION_TTL_SECONDS,
      );
  }

  private async popBufferedRound(
    userId: string,
    lang: SupportedLanguage,
    recentIds: string[],
  ): Promise<BufferedRoundPayload | null> {
    try {
      const key = this.buildBufferKey(userId, lang);
      const raw = await this.redisService.getClient().get(key);
      if (!raw) return null;
      await this.redisService.getClient().del(key);
      const parsed = JSON.parse(raw) as BufferedRoundPayload;
      if (
        parsed?.targetAnimeId &&
        Array.isArray(parsed.clues) &&
        parsed.clues.length === 6 &&
        !recentIds.includes(parsed.targetAnimeId)
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async prewarmNextRound(
    userId: string,
    lang: SupportedLanguage,
    recentIds: string[],
  ): Promise<void> {
    try {
      const nextAnime: Anime = await this.animeService.getRandomAnime(recentIds);
      const generated = await this.aiClueService.generateClues(nextAnime, lang);
      const payload: BufferedRoundPayload = {
        targetAnimeId: String(nextAnime.id),
        lang,
        clues: this.formatClueItems(generated),
      };
      await this.redisService
        .getClient()
        .set(
          this.buildBufferKey(userId, lang),
          JSON.stringify(payload),
          'EX',
          GameService.SOLO_SESSION_TTL_SECONDS,
        );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.debug(`Background round pre-warm skipped: ${msg}`);
    }
  }

  private async resolveAnimeDisplayTitle(
    animeId: string,
    lang: SupportedLanguage,
  ): Promise<string> {
    const numericId = Number.parseInt(animeId, 10);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return 'Unknown Anime';
    }
    try {
      const anime = await this.animeService.findPublicById(numericId);
      if (lang === 'uk' && anime.titleUk) return anime.titleUk;
      if (lang === 'ru' && anime.titleRu) return anime.titleRu;
      return anime.titleEn ?? anime.titleRomaji;
    } catch {
      return `Anime #${animeId}`;
    }
  }

  private async buildRevealedAnswer(
    targetAnimeId: string,
  ): Promise<RevealedAnimeAnswer> {
    const numericId = Number.parseInt(targetAnimeId, 10);
    const anime = await this.animeService.findPublicById(numericId);
    return {
      id: String(anime.id),
      anilistId: anime.anilistId,
      titleEn: anime.titleEn,
      titleRomaji: anime.titleRomaji,
      titleJa: anime.titleJa,
      titleUk: anime.titleUk,
      titleRu: anime.titleRu,
      synonyms: anime.synonyms ?? [],
      coverUrl: anime.coverUrl,
    };
  }
}
