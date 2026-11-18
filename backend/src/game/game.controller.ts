import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StartGameDto } from './dto/start-game.dto';
import { SubmitGuessDto } from './dto/submit-guess.dto';
import { GameService, SoloGameResponse } from './game.service';

interface AuthenticatedRequest extends Request {
  user: User;
}

@Controller('game')
@UseGuards(JwtAuthGuard)
export class GameController {
  constructor(private readonly gameService: GameService) {}

  @Post('start')
  @HttpCode(HttpStatus.OK)
  async startRound(
    @Req() req: AuthenticatedRequest,
    @Body() dto: StartGameDto,
  ): Promise<SoloGameResponse> {
    return this.gameService.startSoloRound(req.user.id, dto);
  }

  @Post('guess')
  @HttpCode(HttpStatus.OK)
  async submitGuess(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SubmitGuessDto,
  ): Promise<SoloGameResponse> {
    return this.gameService.submitSoloGuess(req.user.id, dto);
  }

  @Post('give-up')
  @HttpCode(HttpStatus.OK)
  async giveUp(@Req() req: AuthenticatedRequest): Promise<SoloGameResponse> {
    return this.gameService.giveUpSoloRound(req.user.id);
  }
}
