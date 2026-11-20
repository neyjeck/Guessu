import { Prisma, Role, User } from '@prisma/client';
import { Exclude } from 'class-transformer';

export interface FavoriteAnimeItem {
  id: string;
  title: string;
  coverUrl: string;
}

export interface FavoriteCharacterItem {
  id: number;
  name: string;
  imageUrl: string;
  animeTitle?: string;
}

export class UserResponseEntity implements User {
  id!: string;
  username!: string;
  nickname!: string;
  email!: string;

  @Exclude()
  passwordHash!: string | null;

  @Exclude()
  googleId!: string | null;

  isEmailVerified!: boolean;
  role!: Role;
  avatarUrl!: string | null;
  bio!: string | null;
  favoriteAnime!: Prisma.JsonValue | null;
  favoriteCharacters!: Prisma.JsonValue | null;
  theme!: string;
  profileTheme!: string;
  badgeTitle!: string;
  isPublicProfile!: boolean;
  showStats!: boolean;
  showFavorites!: boolean;
  gamesPlayed!: number;
  gamesWon!: number;
  rating!: number;
  currentStreak!: number;
  maxStreak!: number;
  createdAt!: Date;
  updatedAt!: Date;

  constructor(partial: Partial<UserResponseEntity>) {
    Object.assign(this, partial);
    this.nickname = partial.username ?? this.username;
    this.bio = partial.bio ?? null;
    this.theme = partial.theme || 'midnight';
    this.isPublicProfile = partial.isPublicProfile ?? true;
    this.showStats = partial.showStats ?? true;
    this.showFavorites = partial.showFavorites ?? true;
    this.gamesPlayed = partial.gamesPlayed ?? 0;
    this.gamesWon = partial.gamesWon ?? 0;
    this.favoriteAnime = Array.isArray(partial.favoriteAnime)
      ? partial.favoriteAnime
      : [];
    this.favoriteCharacters = Array.isArray(partial.favoriteCharacters)
      ? partial.favoriteCharacters
      : [];
  }
}
