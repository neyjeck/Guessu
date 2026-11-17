import { Role, User } from '@prisma/client';
import { Exclude } from 'class-transformer';

export class UserResponseEntity implements User {
  id!: string;
  username!: string;
  email!: string;

  @Exclude()
  passwordHash!: string | null;

  @Exclude()
  googleId!: string | null;

  isEmailVerified!: boolean;
  role!: Role;
  avatarUrl!: string | null;
  profileTheme!: string;
  badgeTitle!: string;
  rating!: number;
  currentStreak!: number;
  maxStreak!: number;
  createdAt!: Date;
  updatedAt!: Date;

  constructor(partial: Partial<UserResponseEntity>) {
    Object.assign(this, partial);
  }
}
