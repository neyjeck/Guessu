import { IsInt, Min } from 'class-validator';

export class SubmitGuessDto {
  @IsInt()
  @Min(1)
  guessedAnimeId!: number;
}
