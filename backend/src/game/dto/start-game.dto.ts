import { IsIn, IsOptional } from 'class-validator';
import { SupportedLanguage } from '../../ai/ai-clue.service';

export class StartGameDto {
  @IsOptional()
  @IsIn(['uk', 'en', 'ru'])
  lang?: SupportedLanguage = 'en';
}
