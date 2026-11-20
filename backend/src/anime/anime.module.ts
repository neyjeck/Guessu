import { Module } from '@nestjs/common';
import { AnimeController } from './anime.controller';
import { AnimeEnrichmentService } from './anime-enrichment.service';
import { AnimeService } from './anime.service';

@Module({
  controllers: [AnimeController],
  providers: [AnimeService, AnimeEnrichmentService],
  exports: [AnimeService, AnimeEnrichmentService],
})
export class AnimeModule {}
