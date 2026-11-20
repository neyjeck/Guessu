import * as fs from 'fs';
import * as path from 'path';
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface DossierRecord {
  anilistId: number;
  malId?: number | null;
  titleEn?: string | null;
  titleRomaji: string;
  titleJa?: string | null;
  titleUk?: string | null;
  titleRu?: string | null;
  synonyms?: string[];
  coverUrl: string;
  screenshots?: string[];
  dossier: Prisma.InputJsonValue;
}

async function main(): Promise<void> {
  const dossierPath = path.resolve(
    __dirname,
    '../../data/anime_dossiers.json',
  );

  if (!fs.existsSync(dossierPath)) {
    throw new Error(
      `Seed file not found at ${dossierPath}. Run scripts/fetch_anime_data.py first.`,
    );
  }

  const rawContent = fs.readFileSync(dossierPath, 'utf-8');
  const records = JSON.parse(rawContent) as DossierRecord[];

  console.log(
    `[Prisma Seed] Upserting ${records.length} anime dossiers from ${dossierPath}...`,
  );

  let upserted = 0;
  for (const item of records) {
    await prisma.anime.upsert({
      where: { anilistId: item.anilistId },
      update: {
        malId: item.malId ?? null,
        titleEn: item.titleEn ?? null,
        titleRomaji: item.titleRomaji,
        titleJa: item.titleJa ?? null,
        titleUk: item.titleUk ?? null,
        titleRu: item.titleRu ?? null,
        synonyms: item.synonyms ?? [],
        coverUrl: item.coverUrl ?? null,
        screenshots: item.screenshots ?? [],
        dossier: item.dossier,
        isEnriched: true,
      },
      create: {
        anilistId: item.anilistId,
        malId: item.malId ?? null,
        titleEn: item.titleEn ?? null,
        titleRomaji: item.titleRomaji,
        titleJa: item.titleJa ?? null,
        titleUk: item.titleUk ?? null,
        titleRu: item.titleRu ?? null,
        synonyms: item.synonyms ?? [],
        coverUrl: item.coverUrl ?? null,
        screenshots: item.screenshots ?? [],
        dossier: item.dossier,
        isEnriched: true,
      },
    });
    upserted += 1;
  }

  console.log(
    `[Prisma Seed] Successfully upserted ${upserted} anime records into PostgreSQL.`,
  );
}

main()
  .catch((err) => {
    console.error('[Prisma Seed] Error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
