import { Injectable, NotFoundException } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }
    return user;
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { username } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
  }

  async findByLogin(login: string): Promise<User | null> {
    const trimmed = login.trim();
    const lowered = trimmed.toLowerCase();
    return this.prisma.user.findFirst({
      where: {
        OR: [{ username: trimmed }, { email: lowered }],
      },
    });
  }

  async updateCustomization(
    id: string,
    dto: UpdateProfileDto,
  ): Promise<User> {
    await this.findById(id);
    return this.prisma.user.update({
      where: { id },
      data: {
        avatarUrl: dto.avatarUrl,
        profileTheme: dto.profileTheme,
        badgeTitle: dto.badgeTitle,
      },
    });
  }

  async recordGameOutcome(
    id: string,
    won: boolean,
    ratingDelta: number,
  ): Promise<User> {
    const user = await this.findById(id);
    const nextStreak = won ? user.currentStreak + 1 : 0;
    const nextMaxStreak = Math.max(user.maxStreak, nextStreak);
    const nextRating = Math.max(100, user.rating + ratingDelta);

    return this.prisma.user.update({
      where: { id },
      data: {
        rating: nextRating,
        currentStreak: nextStreak,
        maxStreak: nextMaxStreak,
      },
    });
  }
}
