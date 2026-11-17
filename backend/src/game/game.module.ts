import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { GameController } from './game.controller';
import { GameService } from './game.service';

@Module({
  imports: [UsersModule],
  controllers: [GameController],
  providers: [GameService],
  exports: [GameService],
})
export class GameModule {}
