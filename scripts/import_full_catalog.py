#!/usr/bin/env python3
"""
Full Anime Catalog Importer (anime-offline-database + Wikidata SPARQL -> PostgreSQL).

Pipeline steps:
1. Downloads the latest `anime-offline-database-minified.json` release from manami-project.
2. Filters valid anime formats (`TV`, `MOVIE`, `OVA`, `ONA`, `SPECIAL`), excluding adult tags
   (`hentai`, `erotica`) and music videos (`MUSIC`), extracting Romaji titles, synonyms,
   cover URLs, format types, release years, tags, and AniList/MyAnimeList IDs from `sources`.
3. Queries Wikidata SPARQL in batches via `wdt:P4086` (MyAnimeList ID) and `wdt:P8729`
   (AniList ID) to populate Ukrainian (`uk`), Russian (`ru`), and English (`en`) labels.
4. Bulk-upserts all ~15,000+ records directly into PostgreSQL via a staging table using
   `psycopg2.extras.execute_values` while preserving existing enriched dossiers.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import sys
import time
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import psycopg2
import psycopg2.extras
import requests

ROOT_DIR = pathlib.Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
DEFAULT_CACHE_FILE = DATA_DIR / "anime-offline-database-minified.json"

AODB_DOWNLOAD_URL = (
    "https://github.com/manami-project/anime-offline-database/"
    "releases/latest/download/anime-offline-database-minified.json"
)
ANILIST_GRAPHQL_URL = "https://graphql.anilist.co"
WIKIDATA_SPARQL_URL = "https://query.wikidata.org/sparql"
USER_AGENT = (
    "AnimeGuesserCatalogImporter/1.0 "
    "(https://github.com/anime-guesser; contact@animeguesser.local)"
)

ALLOWED_TYPES = {"TV", "MOVIE", "OVA", "ONA", "SPECIAL"}
EXCLUDED_TAGS = {"hentai", "erotica"}

ANILIST_RE = re.compile(r"https?://(?:www\.)?anilist\.co/anime/(\d+)")
MAL_RE = re.compile(r"https?://(?:www\.)?myanimelist\.net/anime/(\d+)")


def load_env_files() -> None:
    """Loads environment variables from `.env` and `backend/.env` without external dependencies."""
    try:
        from dotenv import load_dotenv  # type: ignore

        load_dotenv(ROOT_DIR / ".env")
        load_dotenv(ROOT_DIR / "backend" / ".env")
        return
    except ImportError:
        pass

    for env_path in (ROOT_DIR / ".env", ROOT_DIR / "backend" / ".env"):
        if not env_path.exists():
            continue
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val


def sanitize_psycopg2_dsn(database_url: str) -> str:
    """Removes Prisma-specific URI parameters (such as `?schema=public`) unsupported by psycopg2."""
    parsed = urlparse(database_url)
    if not parsed.query:
        return database_url
    filtered_params = [
        (k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True) if k != "schema"
    ]
    return urlunparse(parsed._replace(query=urlencode(filtered_params)))


def download_offline_database(
    session: requests.Session,
    cache_path: pathlib.Path,
    use_cached: bool = False,
) -> dict[str, Any]:
    """Downloads or reads the cached `anime-offline-database-minified.json` catalog."""
    if use_cached and cache_path.exists():
        print(f"[Catalog] Reading cached offline database from {cache_path}...")
        return json.loads(cache_path.read_text(encoding="utf-8"))

    print(f"[Catalog] Downloading latest catalog from {AODB_DOWNLOAD_URL}...")
    resp = session.get(AODB_DOWNLOAD_URL, timeout=120)
    resp.raise_for_status()

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_bytes(resp.content)
    print(f"[Catalog] Downloaded {len(resp.content) / (1024 * 1024):.2f} MB -> {cache_path}")
    return resp.json()


def parse_source_ids(sources: list[str]) -> tuple[int | None, int | None]:
    """Extracts AniList ID and MyAnimeList ID from anime-offline-database `sources` URLs."""
    anilist_id: int | None = None
    mal_id: int | None = None
    for src in sources:
        if not isinstance(src, str):
            continue
        if anilist_id is None:
            m = ANILIST_RE.search(src)
            if m:
                anilist_id = int(m.group(1))
        if mal_id is None:
            m = MAL_RE.search(src)
            if m:
                mal_id = int(m.group(1))
        if anilist_id is not None and mal_id is not None:
            break
    return anilist_id, mal_id


def clean_string_list(values: Any) -> list[str]:
    """Normalizes and deduplicates a list of strings while preserving order."""
    if not isinstance(values, list):
        return []
    seen: set[str] = set()
    cleaned: list[str] = []
    for raw in values:
        if not isinstance(raw, str):
            continue
        item = raw.strip()
        if not item:
            continue
        lower = item.lower()
        if lower not in seen:
            seen.add(lower)
            cleaned.append(item)
    return cleaned


def filter_and_extract_records(raw_data: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Filters valid anime formats excluding adult/music entries and deduplicates records
    by `anilistId` and `malId` to satisfy PostgreSQL unique constraints.
    """
    entries = raw_data.get("data") or []
    print(f"[Catalog] Total raw entries in anime-offline-database: {len(entries)}")

    extracted: list[dict[str, Any]] = []
    seen_anilist: set[int] = set()
    seen_mal: set[int] = set()
    skipped_type = 0
    skipped_adult = 0
    skipped_no_id = 0
    skipped_dup = 0

    for entry in entries:
        if not isinstance(entry, dict):
            continue

        anime_type = str(entry.get("type") or "").strip().upper()
        if anime_type not in ALLOWED_TYPES:
            skipped_type += 1
            continue

        tags = clean_string_list(entry.get("tags"))
        tag_set = {t.lower() for t in tags}
        if tag_set & EXCLUDED_TAGS:
            skipped_adult += 1
            continue

        title_romaji = str(entry.get("title") or "").strip()
        if not title_romaji:
            continue

        anilist_id, mal_id = parse_source_ids(entry.get("sources") or [])
        if anilist_id is None and mal_id is None:
            skipped_no_id += 1
            continue

        # Ensure strict uniqueness within the batch for both anilistId and malId
        if anilist_id is not None and anilist_id in seen_anilist:
            skipped_dup += 1
            continue
        if mal_id is not None and mal_id in seen_mal:
            if anilist_id is None:
                skipped_dup += 1
                continue
            # Preserve the unique anilistId entry while avoiding a duplicate malId collision
            mal_id = None

        if anilist_id is not None:
            seen_anilist.add(anilist_id)
        if mal_id is not None:
            seen_mal.add(mal_id)

        picture = str(entry.get("picture") or "").strip() or None
        if picture and "no_pic" in picture.lower():
            picture = None

        season = entry.get("animeSeason") or {}
        raw_year = season.get("year") if isinstance(season, dict) else None
        year = int(raw_year) if isinstance(raw_year, int) and 1900 <= raw_year <= 2100 else None

        synonyms = clean_string_list(entry.get("synonyms"))

        extracted.append(
            {
                "anilistId": anilist_id,
                "malId": mal_id,
                "titleRomaji": title_romaji,
                "titleEn": None,
                "titleJa": None,
                "titleUk": None,
                "titleRu": None,
                "synonyms": synonyms,
                "coverUrl": picture,
                "type": anime_type,
                "year": year,
                "tags": tags,
                "popularity": 0,
            }
        )

    print(
        f"[Catalog] Filtered valid records: {len(extracted)} "
        f"(skipped: format={skipped_type}, adult={skipped_adult}, "
        f"no_id={skipped_no_id}, dup={skipped_dup})"
    )
    return extracted


def execute_wikidata_sparql(
    session: requests.Session,
    sparql: str,
    max_retries: int = 3,
) -> list[dict[str, Any]]:
    """Executes a Wikidata SPARQL query via HTTP POST with backoff on rate limits."""
    for attempt in range(1, max_retries + 1):
        try:
            resp = session.post(
                WIKIDATA_SPARQL_URL,
                data={"query": sparql},
                headers={
                    "Accept": "application/sparql-results+json",
                    "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
                    "User-Agent": USER_AGENT,
                },
                timeout=45,
            )
            if resp.status_code == 429 or resp.status_code >= 500:
                retry_after = int(resp.headers.get("Retry-After", str(3 * attempt)))
                wait_s = min(max(retry_after, 2), 20)
                print(
                    f"[Wikidata] HTTP {resp.status_code} (attempt {attempt}/{max_retries}). "
                    f"Sleeping {wait_s}s..."
                )
                time.sleep(wait_s)
                continue
            resp.raise_for_status()
            return resp.json().get("results", {}).get("bindings", [])
        except requests.RequestException as exc:
            if attempt == max_retries:
                print(f"[Wikidata] Batch failed after {max_retries} attempts: {exc}")
                return []
            time.sleep(2 * attempt)
    return []


def enrich_labels_from_wikidata(
    session: requests.Session,
    records: list[dict[str, Any]],
    batch_size: int = 250,
    delay_seconds: float = 0.6,
) -> None:
    """
    Queries Wikidata SPARQL in batches by MyAnimeList ID (`wdt:P4086`) and AniList ID
    (`wdt:P8729`) to populate Ukrainian (`uk`), Russian (`ru`), and English (`en`) labels.
    """
    by_mal: dict[int, dict[str, Any]] = {}
    by_anilist: dict[int, dict[str, Any]] = {}
    for rec in records:
        if rec["malId"] is not None:
            by_mal[rec["malId"]] = rec
        if rec["anilistId"] is not None:
            by_anilist[rec["anilistId"]] = rec

    # Query batches by MAL ID (wdt:P4086) first since Wikidata coverage for P4086 is broadest
    mal_ids = list(by_mal.keys())
    total_mal_batches = (len(mal_ids) + batch_size - 1) // batch_size
    print(
        f"[Wikidata] Querying labels for {len(mal_ids)} MAL IDs "
        f"across {total_mal_batches} batches (batch_size={batch_size})..."
    )

    for idx in range(0, len(mal_ids), batch_size):
        batch = mal_ids[idx : idx + batch_size]
        values_clause = " ".join(f'"{mid}"' for mid in batch)
        sparql = f"""
        SELECT ?malId ?lang ?label WHERE {{
          VALUES ?malId {{ {values_clause} }}
          ?item wdt:P4086 ?malId ;
                rdfs:label ?label .
          BIND(LANG(?label) AS ?lang)
          FILTER(?lang IN ("uk", "ru", "en"))
        }}
        """
        bindings = execute_wikidata_sparql(session, sparql)
        for row in bindings:
            raw_mid = row.get("malId", {}).get("value", "")
            lang = row.get("lang", {}).get("value", "")
            label = row.get("label", {}).get("value", "").strip()
            if not raw_mid.isdigit() or not label:
                continue
            rec = by_mal.get(int(raw_mid))
            if not rec:
                continue
            if lang == "uk" and not rec["titleUk"]:
                rec["titleUk"] = label
            elif lang == "ru" and not rec["titleRu"]:
                rec["titleRu"] = label
            elif lang == "en" and not rec["titleEn"]:
                rec["titleEn"] = label

        batch_num = idx // batch_size + 1
        if batch_num % 10 == 0 or batch_num == total_mal_batches:
            print(f"[Wikidata] MAL batches completed: {batch_num}/{total_mal_batches}")
        time.sleep(delay_seconds)

    # Query remaining records that have an AniList ID (wdt:P8729) and still lack uk/ru/en labels
    pending_anilist_ids = [
        aid
        for aid, rec in by_anilist.items()
        if not (rec["titleUk"] and rec["titleRu"] and rec["titleEn"])
    ]
    total_al_batches = (len(pending_anilist_ids) + batch_size - 1) // batch_size
    print(
        f"[Wikidata] Querying labels for {len(pending_anilist_ids)} AniList IDs "
        f"across {total_al_batches} batches..."
    )

    for idx in range(0, len(pending_anilist_ids), batch_size):
        batch = pending_anilist_ids[idx : idx + batch_size]
        values_clause = " ".join(f'"{aid}"' for aid in batch)
        sparql = f"""
        SELECT ?anilistId ?lang ?label WHERE {{
          VALUES ?anilistId {{ {values_clause} }}
          ?item wdt:P8729 ?anilistId ;
                rdfs:label ?label .
          BIND(LANG(?label) AS ?lang)
          FILTER(?lang IN ("uk", "ru", "en"))
        }}
        """
        bindings = execute_wikidata_sparql(session, sparql)
        for row in bindings:
            raw_aid = row.get("anilistId", {}).get("value", "")
            lang = row.get("lang", {}).get("value", "")
            label = row.get("label", {}).get("value", "").strip()
            if not raw_aid.isdigit() or not label:
                continue
            rec = by_anilist.get(int(raw_aid))
            if not rec:
                continue
            if lang == "uk" and not rec["titleUk"]:
                rec["titleUk"] = label
            elif lang == "ru" and not rec["titleRu"]:
                rec["titleRu"] = label
            elif lang == "en" and not rec["titleEn"]:
                rec["titleEn"] = label

        batch_num = idx // batch_size + 1
        if batch_num % 10 == 0 or batch_num == total_al_batches:
            print(f"[Wikidata] AniList batches completed: {batch_num}/{total_al_batches}")
        time.sleep(delay_seconds)

    uk_count = sum(1 for r in records if r["titleUk"])
    ru_count = sum(1 for r in records if r["titleRu"])
    en_count = sum(1 for r in records if r["titleEn"])
    print(
        f"[Wikidata] Labels populated -> UK: {uk_count}, RU: {ru_count}, EN: {en_count}"
    )


def build_aliased_anilist_popularity_query(anilist_ids: list[int]) -> str:
    """Builds an aliased GraphQL query fetching `id` and `popularity` for up to 50 AniList IDs."""
    aliases = [
        f"a{idx}: Media(id: {aid}, type: ANIME) {{ id popularity }}"
        for idx, aid in enumerate(anilist_ids)
    ]
    return "query {\n  " + "\n  ".join(aliases) + "\n}"


def fetch_anilist_popularity_batch(
    session: requests.Session,
    anilist_ids: list[int],
    max_retries: int = 4,
) -> tuple[dict[int, int], float]:
    """
    Fetches AniList popularity scores for up to 50 AniList IDs in a single aliased
    GraphQL request, returning `(id -> popularity, recommended_sleep_seconds)`.
    """
    query = build_aliased_anilist_popularity_query(anilist_ids)
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
    }

    for attempt in range(1, max_retries + 1):
        try:
            resp = session.post(
                ANILIST_GRAPHQL_URL,
                json={"query": query},
                headers=headers,
                timeout=30,
            )
            if resp.status_code == 429 or resp.status_code >= 500:
                retry_after = int(resp.headers.get("Retry-After", str(10 * attempt)))
                wait_s = min(max(retry_after, 3), 65)
                print(
                    f"[AniList] HTTP {resp.status_code} (attempt {attempt}/{max_retries}). "
                    f"Sleeping {wait_s}s..."
                )
                time.sleep(wait_s)
                continue

            payload = resp.json() if resp.content else {}
            data = payload.get("data")

            remaining_hdr = resp.headers.get("X-RateLimit-Remaining")
            sleep_s = 0.75
            if remaining_hdr and remaining_hdr.isdigit() and int(remaining_hdr) <= 3:
                sleep_s = 3.0

            if isinstance(data, dict):
                scores: dict[int, int] = {}
                for item in data.values():
                    if isinstance(item, dict) and item.get("id") is not None:
                        aid = int(item["id"])
                        pop = int(item.get("popularity") or 0)
                        scores[aid] = max(0, pop)
                return scores, sleep_s

            # Fallback to Page(id_in: [...]) if aliased Media returned no data object
            fallback_resp = session.post(
                ANILIST_GRAPHQL_URL,
                json={
                    "query": """
                    query ($ids: [Int], $perPage: Int) {
                      Page(page: 1, perPage: $perPage) {
                        media(id_in: $ids, type: ANIME) {
                          id
                          popularity
                        }
                      }
                    }
                    """,
                    "variables": {"ids": anilist_ids, "perPage": len(anilist_ids)},
                },
                headers=headers,
                timeout=30,
            )
            if fallback_resp.ok:
                media_list = (
                    fallback_resp.json()
                    .get("data", {})
                    .get("Page", {})
                    .get("media", [])
                )
                scores = {
                    int(m["id"]): max(0, int(m.get("popularity") or 0))
                    for m in media_list
                    if isinstance(m, dict) and m.get("id") is not None
                }
                return scores, sleep_s
        except requests.RequestException as exc:
            if attempt == max_retries:
                print(f"[AniList] Batch failed after {max_retries} attempts: {exc}")
                return {}, 1.0
            time.sleep(2 * attempt)

    return {}, 1.0


def enrich_popularity_from_anilist(
    session: requests.Session,
    records: list[dict[str, Any]],
    batch_size: int = 50,
) -> None:
    """
    Bulk-fetches AniList popularity scores using aliased GraphQL queries (50 AniList IDs
    per request) and attaches `popularity` to each matching catalog record.
    """
    by_anilist: dict[int, dict[str, Any]] = {
        rec["anilistId"]: rec
        for rec in records
        if rec["anilistId"] is not None
    }
    anilist_ids = list(by_anilist.keys())
    if not anilist_ids:
        print("[AniList] No AniList IDs to query for popularity.")
        return

    batch_size = max(1, min(batch_size, 50))
    total_batches = (len(anilist_ids) + batch_size - 1) // batch_size
    print(
        f"[AniList] Fetching popularity scores for {len(anilist_ids)} anime "
        f"across {total_batches} aliased GraphQL batches (batch_size={batch_size})..."
    )

    populated = 0
    for idx in range(0, len(anilist_ids), batch_size):
        batch = anilist_ids[idx : idx + batch_size]
        scores, sleep_s = fetch_anilist_popularity_batch(session, batch)
        for aid, pop in scores.items():
            rec = by_anilist.get(aid)
            if rec is not None:
                rec["popularity"] = pop
                if pop > 0:
                    populated += 1

        batch_num = idx // batch_size + 1
        if batch_num % 20 == 0 or batch_num == total_batches:
            print(
                f"[AniList] Popularity batches completed: {batch_num}/{total_batches} "
                f"(scored={populated})"
            )
        time.sleep(sleep_s)

    print(f"[AniList] Popularity scores populated for {populated}/{len(anilist_ids)} anime.")


def bulk_upsert_to_postgres(database_url: str, records: list[dict[str, Any]]) -> None:
    """
    Bulk-upserts all catalog records into PostgreSQL using a temporary staging table
    and `psycopg2.extras.execute_values` so 15,000+ rows commit in seconds with zero
    dual-unique-key (`anilistId` / `malId`) constraint collisions.
    """
    if not records:
        print("[Postgres] No records to upsert.")
        return

    dsn = sanitize_psycopg2_dsn(database_url)
    started_at = time.monotonic()

    rows = [
        (
            r["anilistId"],
            r["malId"],
            r["titleEn"],
            r["titleRomaji"],
            r["titleJa"],
            r["titleUk"],
            r["titleRu"],
            r["synonyms"],
            r["coverUrl"],
            r["type"],
            r["year"],
            r["tags"],
            int(r.get("popularity") or 0),
        )
        for r in records
    ]

    conn = psycopg2.connect(dsn)
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TEMP TABLE anime_import_stage (
                        "anilistId"   INTEGER,
                        "malId"       INTEGER,
                        "titleEn"     TEXT,
                        "titleRomaji" TEXT,
                        "titleJa"     TEXT,
                        "titleUk"     TEXT,
                        "titleRu"     TEXT,
                        "synonyms"    TEXT[],
                        "coverUrl"    TEXT,
                        "type"        TEXT,
                        "year"        INTEGER,
                        "tags"        TEXT[],
                        "popularity"  INTEGER
                    ) ON COMMIT DROP;
                    """
                )

                psycopg2.extras.execute_values(
                    cur,
                    """
                    INSERT INTO anime_import_stage (
                        "anilistId", "malId", "titleEn", "titleRomaji", "titleJa",
                        "titleUk", "titleRu", "synonyms", "coverUrl", "type", "year",
                        "tags", "popularity"
                    ) VALUES %s
                    """,
                    rows,
                    page_size=2000,
                )

                # 1. Update existing rows matched by anilistId
                cur.execute(
                    """
                    UPDATE "Anime" AS a
                    SET
                        "malId" = CASE
                            WHEN a."malId" IS NOT NULL THEN a."malId"
                            WHEN s."malId" IS NOT NULL AND NOT EXISTS (
                                SELECT 1 FROM "Anime" x WHERE x."malId" = s."malId"
                            ) THEN s."malId"
                            ELSE a."malId"
                        END,
                        "titleEn" = COALESCE(NULLIF(a."titleEn", ''), s."titleEn"),
                        "titleRomaji" = COALESCE(NULLIF(s."titleRomaji", ''), a."titleRomaji"),
                        "titleJa" = COALESCE(NULLIF(a."titleJa", ''), s."titleJa"),
                        "titleUk" = COALESCE(NULLIF(s."titleUk", ''), a."titleUk"),
                        "titleRu" = COALESCE(NULLIF(s."titleRu", ''), a."titleRu"),
                        "synonyms" = CASE
                            WHEN cardinality(s."synonyms") > 0 THEN ARRAY(
                                SELECT DISTINCT unnest(COALESCE(a."synonyms", ARRAY[]::TEXT[]) || s."synonyms")
                            )
                            ELSE a."synonyms"
                        END,
                        "coverUrl" = COALESCE(NULLIF(a."coverUrl", ''), s."coverUrl"),
                        "type" = COALESCE(s."type", a."type"),
                        "year" = COALESCE(s."year", a."year"),
                        "tags" = CASE
                            WHEN cardinality(s."tags") > 0 THEN s."tags"
                            ELSE a."tags"
                        END,
                        "popularity" = CASE
                            WHEN COALESCE(s."popularity", 0) > 0 THEN s."popularity"
                            ELSE a."popularity"
                        END
                    FROM anime_import_stage AS s
                    WHERE s."anilistId" IS NOT NULL
                      AND a."anilistId" = s."anilistId";
                    """
                )
                updated_by_anilist = cur.rowcount

                # 2. Update existing rows matched by malId where anilistId did not already match
                cur.execute(
                    """
                    UPDATE "Anime" AS a
                    SET
                        "anilistId" = CASE
                            WHEN a."anilistId" IS NOT NULL THEN a."anilistId"
                            WHEN s."anilistId" IS NOT NULL AND NOT EXISTS (
                                SELECT 1 FROM "Anime" x WHERE x."anilistId" = s."anilistId"
                            ) THEN s."anilistId"
                            ELSE a."anilistId"
                        END,
                        "titleEn" = COALESCE(NULLIF(a."titleEn", ''), s."titleEn"),
                        "titleRomaji" = COALESCE(NULLIF(s."titleRomaji", ''), a."titleRomaji"),
                        "titleJa" = COALESCE(NULLIF(a."titleJa", ''), s."titleJa"),
                        "titleUk" = COALESCE(NULLIF(s."titleUk", ''), a."titleUk"),
                        "titleRu" = COALESCE(NULLIF(s."titleRu", ''), a."titleRu"),
                        "synonyms" = CASE
                            WHEN cardinality(s."synonyms") > 0 THEN ARRAY(
                                SELECT DISTINCT unnest(COALESCE(a."synonyms", ARRAY[]::TEXT[]) || s."synonyms")
                            )
                            ELSE a."synonyms"
                        END,
                        "coverUrl" = COALESCE(NULLIF(a."coverUrl", ''), s."coverUrl"),
                        "type" = COALESCE(s."type", a."type"),
                        "year" = COALESCE(s."year", a."year"),
                        "tags" = CASE
                            WHEN cardinality(s."tags") > 0 THEN s."tags"
                            ELSE a."tags"
                        END,
                        "popularity" = CASE
                            WHEN COALESCE(s."popularity", 0) > 0 THEN s."popularity"
                            ELSE a."popularity"
                        END
                    FROM anime_import_stage AS s
                    WHERE s."malId" IS NOT NULL
                      AND a."malId" = s."malId"
                      AND (s."anilistId" IS NULL OR a."anilistId" IS DISTINCT FROM s."anilistId");
                    """
                )
                updated_by_mal = cur.rowcount

                # 3. Insert brand-new records that match neither existing anilistId nor malId
                cur.execute(
                    """
                    INSERT INTO "Anime" (
                        "anilistId", "malId", "titleEn", "titleRomaji", "titleJa",
                        "titleUk", "titleRu", "synonyms", "coverUrl", "type", "year",
                        "tags", "popularity", "screenshots", "dossier", "isEnriched"
                    )
                    SELECT
                        s."anilistId",
                        s."malId",
                        s."titleEn",
                        s."titleRomaji",
                        s."titleJa",
                        s."titleUk",
                        s."titleRu",
                        COALESCE(s."synonyms", ARRAY[]::TEXT[]),
                        s."coverUrl",
                        s."type",
                        s."year",
                        COALESCE(s."tags", ARRAY[]::TEXT[]),
                        COALESCE(s."popularity", 0),
                        ARRAY[]::TEXT[],
                        NULL,
                        FALSE
                    FROM anime_import_stage AS s
                    WHERE (
                        s."anilistId" IS NULL
                        OR NOT EXISTS (SELECT 1 FROM "Anime" a WHERE a."anilistId" = s."anilistId")
                    )
                    AND (
                        s."malId" IS NULL
                        OR NOT EXISTS (SELECT 1 FROM "Anime" a WHERE a."malId" = s."malId")
                    )
                    ON CONFLICT DO NOTHING;
                    """
                )
                inserted = cur.rowcount

                cur.execute('SELECT COUNT(*) FROM "Anime";')
                total_in_db = cur.fetchone()[0]

        elapsed = time.monotonic() - started_at
        print(
            f"[Postgres] Bulk upsert complete in {elapsed:.2f}s -> "
            f"updated(anilist)={updated_by_anilist}, updated(mal)={updated_by_mal}, "
            f"inserted={inserted}, total_catalog={total_in_db}"
        )
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import full anime-offline-database catalog + AniList popularity + Wikidata uk/ru/en labels into PostgreSQL"
    )
    parser.add_argument(
        "--use-cached",
        action="store_true",
        help="Read cached local data/anime-offline-database-minified.json instead of re-downloading",
    )
    parser.add_argument(
        "--skip-anilist",
        action="store_true",
        help="Skip AniList bulk popularity GraphQL queries",
    )
    parser.add_argument(
        "--anilist-batch-size",
        type=int,
        default=50,
        help="Number of AniList IDs per aliased GraphQL request (default: 50, max: 50)",
    )
    parser.add_argument(
        "--skip-wikidata",
        action="store_true",
        help="Skip Wikidata SPARQL batch label enrichment (useful for fast local testing)",
    )
    parser.add_argument(
        "--wikidata-batch-size",
        type=int,
        default=250,
        help="Number of IDs per Wikidata SPARQL batch (default: 250)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and filter catalog without writing to PostgreSQL",
    )
    args = parser.parse_args()

    load_env_files()
    database_url = os.environ.get("DATABASE_URL")
    if not database_url and not args.dry_run:
        print(
            "[Catalog] ERROR: DATABASE_URL is not set. Configure backend/.env or export DATABASE_URL.",
            file=sys.stderr,
        )
        sys.exit(1)

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    raw_data = download_offline_database(
        session,
        DEFAULT_CACHE_FILE,
        use_cached=args.use_cached,
    )
    records = filter_and_extract_records(raw_data)

    if not args.skip_anilist:
        enrich_popularity_from_anilist(
            session,
            records,
            batch_size=max(1, min(args.anilist_batch_size, 50)),
        )

    if not args.skip_wikidata:
        enrich_labels_from_wikidata(
            session,
            records,
            batch_size=max(50, min(args.wikidata_batch_size, 500)),
        )

    if args.dry_run:
        print(f"[Catalog] Dry-run finished with {len(records)} filtered records.")
        return

    bulk_upsert_to_postgres(database_url or "", records)

    # Always finish with a fast (~20s) top-1500 AniList popularity sync so early-round
    # mainstream pools are immediately populated even if `--skip-anilist` was used.
    try:
        from sync_popularity import sync_top_popularity

        print("[Catalog] Running fast top-1500 AniList popularity sync...")
        sync_top_popularity(database_url or "", session=session)
    except Exception as exc:
        print(f"[Catalog] Warning: top-1500 popularity sync failed: {exc}")


if __name__ == "__main__":
    main()
