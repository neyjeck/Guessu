import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { StartGameDto } from './dto/start-game.dto';
import { SubmitGuessDto } from './dto/submit-guess.dto';
import { GameService, SafeGameSessionView } from './game.service';

@Controller('game')
export class GameController {
  constructor(private readonly gameService: GameService) {}

  @Post('start')
  async startSession(@Body() dto: StartGameDto): Promise<SafeGameSessionView> {
    return this.gameService.startSession(dto);
  }

  @Get(':sessionId')
  async getSession(
    @Param('sessionId') sessionId: string,
  ): Promise<SafeGameSessionView> {
    return this.gameService.getSession(sessionId);
  }

  @Post(':sessionId/guess')
  async submitGuess(
    @Param('sessionId') sessionId: string,
    @Body() dto: SubmitGuessDto,
  ): Promise<SafeGameSessionView> {
    return this.gameService.submitGuess(sessionId, dto);
  }
}
