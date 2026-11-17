import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class SearchAnimeDto {
  @IsString()
  @MinLength(1)
  q!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number = 8;
}
