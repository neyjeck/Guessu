import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AnimeModule } from '../anime/anime.module';
import { UsersModule } from '../users/users.module';
import { GameController } from './game.controller';
import { GameService } from './game.service';

@Module({
  imports: [UsersModule, AnimeModule, AiModule],
  controllers: [GameController],
  providers: [GameService],
  exports: [GameService],
})
export class GameModule {}
