import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface LeaderboardEntry {
  id: string;
  username: string;
  avatarUrl: string | null;
  profileTheme: string;
  badgeTitle: string;
  rating: number;
  currentStreak: number;
  maxStreak: number;
}

@Injectable()
export class LeaderboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getTopByRating(limit = 50): Promise<LeaderboardEntry[]> {
    return this.prisma.user.findMany({
      orderBy: [{ rating: 'desc' }, { maxStreak: 'desc' }],
      take: limit,
      select: {
        id: true,
        username: true,
        avatarUrl: true,
        profileTheme: true,
        badgeTitle: true,
        rating: true,
        currentStreak: true,
        maxStreak: true,
      },
    });
  }

  async getTopByStreak(limit = 50): Promise<LeaderboardEntry[]> {
    return this.prisma.user.findMany({
      orderBy: [{ maxStreak: 'desc' }, { rating: 'desc' }],
      take: limit,
      select: {
        id: true,
        username: true,
        avatarUrl: true,
        profileTheme: true,
        badgeTitle: true,
        rating: true,
        currentStreak: true,
        maxStreak: true,
      },
    });
  }
}
