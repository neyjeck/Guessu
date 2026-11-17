import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnimeModule } from './anime/anime.module';
import { AuthModule } from './auth/auth.module';
import { GameModule } from './game/game.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    AnimeModule,
    GameModule,
    LeaderboardModule,
  ],
})
export class AppModule {}
