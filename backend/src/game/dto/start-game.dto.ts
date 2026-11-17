import { GameMode } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class StartGameDto {
  @IsEnum(GameMode)
  mode!: GameMode;

  @IsOptional()
  @IsUUID()
  userId?: string;
}
