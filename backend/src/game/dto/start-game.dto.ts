import { GameMode } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { SupportedLanguage } from '../../ai/ai-clue.service';

export class StartGameDto {
  @IsEnum(GameMode)
  mode!: GameMode;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsIn(['uk', 'en', 'ru'])
  lang?: SupportedLanguage = 'en';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludeIds?: string[];
}
