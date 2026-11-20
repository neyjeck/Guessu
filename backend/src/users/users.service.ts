import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
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

  async findPublicProfileById(id: string, requesterId?: string): Promise<User> {
    const user = await this.findById(id);
    if (requesterId && requesterId === user.id) {
      return user;
    }

    if (!user.isPublicProfile) {
      throw new ForbiddenException('This user profile is private.');
    }

    return {
      ...user,
      rating: user.showStats ? user.rating : 0,
      currentStreak: user.showStats ? user.currentStreak : 0,
      maxStreak: user.showStats ? user.maxStreak : 0,
      gamesPlayed: user.showStats ? user.gamesPlayed : 0,
      gamesWon: user.showStats ? user.gamesWon : 0,
      favoriteAnime: user.showFavorites ? user.favoriteAnime : [],
      favoriteCharacters: user.showFavorites ? user.favoriteCharacters : [],
    };
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

  async updateMyProfile(id: string, dto: UpdateProfileDto): Promise<User> {
    const currentUser = await this.findById(id);
    const data: Prisma.UserUpdateInput = {};

    const nextNickname = (dto.nickname ?? dto.username)?.trim();
    if (nextNickname !== undefined) {
      if (nextNickname.length < 3 || nextNickname.length > 24) {
        throw new BadRequestException(
          'Nickname must be between 3 and 24 characters.',
        );
      }

      if (nextNickname !== currentUser.username) {
        const existing = await this.prisma.user.findFirst({
          where: {
            username: { equals: nextNickname, mode: 'insensitive' },
            NOT: { id },
          },
        });
        if (existing) {
          throw new ConflictException('This nickname is already taken.');
        }
        data.username = nextNickname;
      }
    }

    if (dto.bio !== undefined) {
      const cleanedBio = dto.bio === null ? null : dto.bio.trim();
      if (cleanedBio && cleanedBio.length > 250) {
        throw new BadRequestException('Bio cannot exceed 250 characters.');
      }
      data.bio = cleanedBio || null;
    }

    if (dto.avatarUrl !== undefined) {
      const cleanedAvatar =
        dto.avatarUrl === null ? null : dto.avatarUrl.trim();
      if (cleanedAvatar) {
        const isLocalUpload = cleanedAvatar.startsWith('/uploads/avatars/');
        const isHttpUrl = /^https?:\/\/.+/i.test(cleanedAvatar);
        if (!isLocalUpload && !isHttpUrl) {
          throw new BadRequestException(
            'Avatar URL must be a valid HTTP/HTTPS URL or an uploaded image path.',
          );
        }
        data.avatarUrl = cleanedAvatar;
      } else {
        data.avatarUrl = null;
      }
    }

    if (dto.favoriteAnime !== undefined) {
      if (dto.favoriteAnime.length > 5) {
        throw new BadRequestException(
          'You can select at most 5 favorite anime.',
        );
      }
      const dedupedAnime = dto.favoriteAnime
        .filter(
          (item, index, arr) =>
            arr.findIndex((other) => other.id === item.id) === index,
        )
        .slice(0, 5)
        .map((item) => ({
          id: String(item.id),
          title: item.title.trim(),
          coverUrl: item.coverUrl.trim(),
        }));
      data.favoriteAnime = dedupedAnime as unknown as Prisma.InputJsonValue;
    }

    if (dto.favoriteCharacters !== undefined) {
      if (dto.favoriteCharacters.length > 5) {
        throw new BadRequestException(
          'You can select at most 5 favorite characters.',
        );
      }
      const dedupedChars = dto.favoriteCharacters
        .filter(
          (item, index, arr) =>
            arr.findIndex((other) => other.id === item.id) === index,
        )
        .slice(0, 5)
        .map((item) => ({
          id: Number(item.id),
          name: item.name.trim(),
          imageUrl: item.imageUrl.trim(),
          ...(item.animeTitle ? { animeTitle: item.animeTitle.trim() } : {}),
        }));
      data.favoriteCharacters =
        dedupedChars as unknown as Prisma.InputJsonValue;
    }

    if (dto.theme !== undefined) {
      data.theme = dto.theme;
    }

    if (dto.isPublicProfile !== undefined) {
      data.isPublicProfile = dto.isPublicProfile;
    }

    if (dto.showStats !== undefined) {
      data.showStats = dto.showStats;
    }

    if (dto.showFavorites !== undefined) {
      data.showFavorites = dto.showFavorites;
    }

    if (dto.profileTheme !== undefined) {
      data.profileTheme = dto.profileTheme;
    }

    if (dto.badgeTitle !== undefined) {
      data.badgeTitle = dto.badgeTitle;
    }

    return this.prisma.user.update({
      where: { id },
      data,
    });
  }

  async updateAvatarUrl(id: string, avatarUrl: string): Promise<User> {
    await this.findById(id);
    return this.prisma.user.update({
      where: { id },
      data: { avatarUrl },
    });
  }

  async updateCustomization(
    id: string,
    dto: UpdateProfileDto,
  ): Promise<User> {
    return this.updateMyProfile(id, dto);
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
        gamesPlayed: { increment: 1 },
        ...(won ? { gamesWon: { increment: 1 } } : {}),
      },
    });
  }
}
