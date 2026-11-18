import { Module } from '@nestjs/common';
import { AiClueService } from './ai-clue.service';

@Module({
  providers: [AiClueService],
  exports: [AiClueService],
})
export class AiModule {}
