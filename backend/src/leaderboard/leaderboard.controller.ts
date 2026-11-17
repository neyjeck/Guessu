import { Controller, Get, Query } from '@nestjs/common';
import { LeaderboardEntry, LeaderboardService } from './leaderboard.service';

@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get('rating')
  async getTopByRating(
    @Query('limit') limit?: string,
  ): Promise<LeaderboardEntry[]> {
    const parsedLimit = limit ? Math.min(100, Math.max(1, Number(limit))) : 50;
    return this.leaderboardService.getTopByRating(parsedLimit);
  }

  @Get('streaks')
  async getTopByStreak(
    @Query('limit') limit?: string,
  ): Promise<LeaderboardEntry[]> {
    const parsedLimit = limit ? Math.min(100, Math.max(1, Number(limit))) : 50;
    return this.leaderboardService.getTopByStreak(parsedLimit);
  }
}
