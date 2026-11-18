import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class SubmitGuessDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value !== undefined && value !== null && String(value).trim() !== ''
      ? String(value).trim()
      : undefined,
  )
  @IsString()
  animeId?: string;

  @IsOptional()
  @IsBoolean()
  skip?: boolean;
}
