import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Anime, GameMode, GameSession, GameStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { StartGameDto } from './dto/start-game.dto';
import { SubmitGuessDto } from './dto/submit-guess.dto';

export interface SafeGameSessionView {
  sessionId: string;
  mode: GameMode;
  status: GameStatus;
  currentStep: number;
  maxSteps: number;
  attempts: number;
  unlockedClues: string[];
  unlockedScreenshots: string[];
  revealedAnime: {
    id: number;
    titleEn: string | null;
    titleRomaji: string;
    titleUk: string | null;
    coverUrl: string;
  } | null;
}

@Injectable()
export class GameService {
  private static readonly MAX_STEPS = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  async startSession(dto: StartGameDto): Promise<SafeGameSessionView> {
    const totalCount = await this.prisma.anime.count();
    if (totalCount === 0) {
      throw new BadRequestException(
        'No anime entries available in database. Seed the database first.',
      );
    }

    const randomOffset = Math.floor(Math.random() * totalCount);
    const [randomAnime] = await this.prisma.anime.findMany({
      skip: randomOffset,
      take: 1,
    });

    const session = await this.prisma.gameSession.create({
      data: {
        userId: dto.userId,
        mode: dto.mode,
        targetAnimeId: randomAnime.id,
        currentStep: 0,
        status: GameStatus.IN_PROGRESS,
        attempts: 0,
      },
      include: {
        targetAnime: true,
      },
    });

    return this.toSafeClientView(session, session.targetAnime);
  }

  async getSession(sessionId: string): Promise<SafeGameSessionView> {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      include: { targetAnime: true },
    });

    if (!session) {
      throw new NotFoundException(`GameSession "${sessionId}" not found`);
    }

    return this.toSafeClientView(session, session.targetAnime);
  }

  async submitGuess(
    sessionId: string,
    dto: SubmitGuessDto,
  ): Promise<SafeGameSessionView> {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      include: { targetAnime: true },
    });

    if (!session) {
      throw new NotFoundException(`GameSession "${sessionId}" not found`);
    }

    if (session.status !== GameStatus.IN_PROGRESS) {
      throw new BadRequestException('Game session has already concluded');
    }

    const isCorrect = dto.guessedAnimeId === session.targetAnimeId;
    const nextAttempts = session.attempts + 1;
    const nextStep = isCorrect ? session.currentStep : session.currentStep + 1;

    let nextStatus: GameStatus = GameStatus.IN_PROGRESS;
    if (isCorrect) {
      nextStatus = GameStatus.WON;
    } else if (
      session.mode === GameMode.ENDLESS ||
      nextStep >= GameService.MAX_STEPS
    ) {
      nextStatus = GameStatus.LOST;
    }

    const updated = await this.prisma.gameSession.update({
      where: { id: sessionId },
      data: {
        attempts: nextAttempts,
        currentStep: Math.min(nextStep, GameService.MAX_STEPS - 1),
        status: nextStatus,
      },
      include: { targetAnime: true },
    });

    if (updated.userId && nextStatus !== GameStatus.IN_PROGRESS) {
      const won = nextStatus === GameStatus.WON;
      const ratingDelta = won
        ? Math.max(10, 30 - session.currentStep * 5)
        : -15;
      await this.usersService.recordGameOutcome(
        updated.userId,
        won,
        ratingDelta,
      );
    }

    return this.toSafeClientView(updated, updated.targetAnime);
  }

  /**
   * Anti-cheat projection: strips targetAnimeId and full metadata while IN_PROGRESS,
   * exposing only the clues/screenshots unlocked up to currentStep.
   */
  private toSafeClientView(
    session: GameSession,
    targetAnime: Anime,
  ): SafeGameSessionView {
    const rawClues = Array.isArray(targetAnime.clues)
      ? (targetAnime.clues as string[])
      : [];
    const sliceEnd = session.currentStep + 1;

    const unlockedClues =
      session.mode === GameMode.SCREENSHOT
        ? []
        : rawClues.slice(0, sliceEnd);

    const unlockedScreenshots =
      session.mode === GameMode.CLUES
        ? []
        : targetAnime.screenshots.slice(0, sliceEnd);

    const isFinished = session.status !== GameStatus.IN_PROGRESS;

    return {
      sessionId: session.id,
      mode: session.mode,
      status: session.status,
      currentStep: session.currentStep,
      maxSteps: GameService.MAX_STEPS,
      attempts: session.attempts,
      unlockedClues,
      unlockedScreenshots,
      revealedAnime: isFinished
        ? {
            id: targetAnime.id,
            titleEn: targetAnime.titleEn,
            titleRomaji: targetAnime.titleRomaji,
            titleUk: targetAnime.titleUk,
            coverUrl: targetAnime.coverUrl,
          }
        : null,
    };
  }
}
