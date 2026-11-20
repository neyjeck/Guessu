import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const ALLOWED_THEMES = [
  'midnight',
  'obsidian',
  'sakura-dusk',
  'warm-parchment',
] as const;

export type AppTheme = (typeof ALLOWED_THEMES)[number];

export class FavoriteAnimeItemDto {
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  id!: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : String(value ?? ''),
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : String(value ?? ''),
  )
  @IsString()
  @MaxLength(1000)
  coverUrl!: string;
}

export class FavoriteCharacterItemDto {
  @Transform(({ value }) => Number.parseInt(String(value), 10))
  @IsInt()
  @Min(1)
  id!: number;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : String(value ?? ''),
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : String(value ?? ''),
  )
  @IsString()
  @MaxLength(1000)
  imageUrl!: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : undefined,
  )
  @IsString()
  @MaxLength(200)
  animeTitle?: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3, { message: 'Nickname must be between 3 and 24 characters.' })
  @MaxLength(24, { message: 'Nickname must be between 3 and 24 characters.' })
  nickname?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3, { message: 'Nickname must be between 3 and 24 characters.' })
  @MaxLength(24, { message: 'Nickname must be between 3 and 24 characters.' })
  username?: string;

  @IsOptional()
  @ValidateIf((_obj, value) => value !== null)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(250, { message: 'Bio cannot exceed 250 characters.' })
  bio?: string | null;

  @IsOptional()
  @ValidateIf((_obj, value) => value !== null)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(1000)
  avatarUrl?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5, { message: 'You can select up to 5 favorite anime.' })
  @ValidateNested({ each: true })
  @Type(() => FavoriteAnimeItemDto)
  favoriteAnime?: FavoriteAnimeItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5, { message: 'You can select up to 5 favorite characters.' })
  @ValidateNested({ each: true })
  @Type(() => FavoriteCharacterItemDto)
  favoriteCharacters?: FavoriteCharacterItemDto[];

  @IsOptional()
  @IsString()
  @IsIn(ALLOWED_THEMES, {
    message:
      'Theme must be one of: midnight, obsidian, sakura-dusk, warm-parchment.',
  })
  theme?: AppTheme;

  @IsOptional()
  @IsString()
  @IsIn(['uk', 'en', 'ru'])
  lang?: 'uk' | 'en' | 'ru';

  @IsOptional()
  @IsBoolean()
  isPublicProfile?: boolean;

  @IsOptional()
  @IsBoolean()
  showStats?: boolean;

  @IsOptional()
  @IsBoolean()
  showFavorites?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  profileTheme?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  badgeTitle?: string;
}
