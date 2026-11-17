import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsUrl()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  profileTheme?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  badgeTitle?: string;
}
