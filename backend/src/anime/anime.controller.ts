import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { AnimeSearchResult, AnimeService } from './anime.service';
import { SearchAnimeDto } from './dto/search-anime.dto';

@Controller('anime')
export class AnimeController {
  constructor(private readonly animeService: AnimeService) {}

  @Get('search')
  async search(@Query() dto: SearchAnimeDto): Promise<AnimeSearchResult[]> {
    return this.animeService.searchMultilingual(dto);
  }

  @Get(':id')
  async getById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AnimeSearchResult> {
    return this.animeService.findPublicById(id);
  }
}
