#!/usr/bin/env python3
"""
AniList Top-2,000 Metadata, Popularity & Sequel/Franchise Root Backfill Script.

Queries the public AniList GraphQL API (`Page(page: 1..40, perPage: 50)` sorted by
`POPULARITY_DESC`, ~28s with polite 0.7s pacing) and bulk-updates PostgreSQL `"Anime"`
rows to eliminate NULL metadata gaps and flag sequels/seasons across the catalog:
  - `popularity`, `titleEn`, `titleJa`, `year` (`seasonYear`), `type` (`format`)
  - merged `synonyms`
  - `isSequel` & `rootAnilistId` (via AniList `PREQUEL` relation chains walked up to Season 1
    + title-pattern detection for Season 2+, Part 2+, Cour 2+, Final Season, II/III/IV)
  - initial `dossier` JSONB (cleaned `description`, `genres`, `studios`, `seasonYear`, `popularity`)
"""

from __future__ import annotations

import argparse
import html
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
ANILIST_GRAPHQL_URL = "https://graphql.anilist.co"
USER_AGENT = (
    "AnimeGuesserPopularitySync/3.0 "
    "(https://github.com/anime-guesser; contact@animeguesser.local)"
)

ANILIST_TOP_METADATA_QUERY = """
query ($page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo {
      hasNextPage
      currentPage
    }
    media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
      id
      popularity
      seasonYear
      format
      title {
        english
        romaji
        native
      }
      synonyms
      genres
      studios(isMain: true) {
        nodes {
          name
        }
      }
      description(asHtml: false)
      relations {
        edges {
          relationType
          node {
            id
            type
            format
          }
        }
      }
    }
  }
}
"""

FORMAT_NORMALIZATION = {
    "TV": "TV",
    "TV_SHORT": "TV",
    "MOVIE": "MOVIE",
    "OVA": "OVA",
    "ONA": "ONA",
    "SPECIAL": "SPECIAL",
}

PREQUEL_ELIGIBLE_FORMATS = {"TV", "TV_SHORT", "MOVIE"}

# Matches obvious sequel/season/part title markers while avoiding "Season 1" / "Part 1" false positives
SEQUEL_TITLE_PATTERNS = [
    re.compile(r"\bSeason\s+(?:[2-9]|\d{2,})\b", re.IGNORECASE),
    re.compile(r"\b(?:2nd|3rd|[4-9]th|\d{2,}th)\s+Season\b", re.IGNORECASE),
    re.compile(r"\bPart\s+(?:[2-9]|\d{2,})\b", re.IGNORECASE),
    re.compile(r"\bCour\s+(?:[2-9]|\d{2,})\b", re.IGNORECASE),
    re.compile(r"\bFinal\s+Season\b", re.IGNORECASE),
    re.compile(r"\b(?:2nd|3rd|[4-9]th)\s+Stage\b", re.IGNORECASE),
    re.compile(r"(?:\s|:)(?:II|III|IV)(?:\s*$|\s*[:\-–])"),
]


def load_env_files() -> None:
    """Loads environment variables from `.env` and `backend/.env`."""
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
    """Strips Prisma-specific `?schema=public` URI query parameters unsupported by psycopg2."""
    parsed = urlparse(database_url)
    if not parsed.query:
        return database_url
    filtered_params = [
        (k, v)
        for k, v in parse_qsl(parsed.query, keep_blank_values=True)
        if k != "schema"
    ]
    return urlunparse(parsed._replace(query=urlencode(filtered_params)))


def clean_scraped_text(text: str | None, max_len: int = 1500) -> str:
    """
    Sanitizes AniList/Wikipedia/Fandom scraped text:
      - strips HTML tags and decodes HTML entities
      - strips AniList spoilers (`~!...!~`) and markdown formatting
      - removes `(Source: ...)` and `[Written by MAL Rewrite]` citations
      - removes Wikipedia `(Japanese: ..., Hepburn: ...)` opening romanization headers
    """
    if not text:
        return ""
    cleaned = html.unescape(text)
    cleaned = re.sub(r"~!.*?!(?:~)", "", cleaned, flags=re.DOTALL)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = re.sub(r"__(.+?)__", r"\1", cleaned)
    cleaned = re.sub(r"\(\s*Source\s*:[^)]*\)", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\[\s*Written by[^\]]*\]", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*Source\s*:\s*[^.\n]+$", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(
        r"\s*\((?:[^()]|\([^()]*\))*(?:Japanese:|Hepburn:|Romaji:)(?:[^()]|\([^()]*\))*\)",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\[\d+\]", "", cleaned)
    cleaned = re.sub(r"\s+([,.;:!?])", r"\1", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:max_len]


def normalize_format(raw_format: str | None) -> str | None:
    """Normalizes AniList format enums to catalog `Anime.type` values."""
    if not raw_format:
        return None
    return FORMAT_NORMALIZATION.get(raw_format.strip().upper())


def matches_sequel_title(title_en: str | None, title_romaji: str | None) -> bool:
    """Returns True if either title matches obvious sequel/season/part naming patterns."""
    for candidate in (title_en, title_romaji):
        if not candidate:
            continue
        for pattern in SEQUEL_TITLE_PATTERNS:
            if pattern.search(candidate):
                return True
    return False


def extract_direct_prequel_id(relations: dict[str, Any] | None) -> int | None:
    """
    Returns the AniList ID of a `PREQUEL` relation pointing to an `ANIME` of format
    `TV` / `TV_SHORT` / `MOVIE`, preferring `TV` over `MOVIE` when multiple exist.
    """
    edges = (relations or {}).get("edges") or []
    tv_prequel: int | None = None
    movie_prequel: int | None = None

    for edge in edges:
        if not isinstance(edge, dict):
            continue
        if str(edge.get("relationType") or "").upper() != "PREQUEL":
            continue
        node = edge.get("node") or {}
        if not isinstance(node, dict):
            continue
        if str(node.get("type") or "").upper() != "ANIME":
            continue
        fmt = str(node.get("format") or "").upper()
        node_id = node.get("id")
        if fmt not in PREQUEL_ELIGIBLE_FORMATS or not isinstance(node_id, int):
            continue
        if fmt in ("TV", "TV_SHORT") and tv_prequel is None:
            tv_prequel = node_id
        elif fmt == "MOVIE" and movie_prequel is None:
            movie_prequel = node_id

    return tv_prequel if tv_prequel is not None else movie_prequel


def resolve_franchise_roots(entries: list[dict[str, Any]]) -> None:
    """
    Walks each sequel's `PREQUEL` chain upwards to find the original Season 1
    `rootAnilistId` (with cycle detection) and sets `isSequel` accordingly.
    """
    prequel_map: dict[int, int] = {
        e["anilistId"]: e["directPrequelId"]
        for e in entries
        if e.get("directPrequelId") is not None
    }

    sequel_count = 0
    for entry in entries:
        aid = entry["anilistId"]
        direct_prequel = entry.get("directPrequelId")
        root_id: int | None = None

        if direct_prequel is not None:
            cur = direct_prequel
            visited = {aid}
            while cur in prequel_map and cur not in visited:
                visited.add(cur)
                nxt = prequel_map[cur]
                if nxt in visited:
                    break
                cur = nxt
            root_id = cur

        is_sequel = (direct_prequel is not None) or matches_sequel_title(
            entry.get("titleEn"), entry.get("titleRomaji")
        )

        entry["isSequel"] = is_sequel
        entry["rootAnilistId"] = root_id if is_sequel else None
        if is_sequel:
            sequel_count += 1

    print(
        f"[PopularitySync] Franchise resolution complete -> "
        f"{sequel_count} sequels flagged, {len(entries) - sequel_count} root entries"
    )


def fetch_top_popular_anime(
    session: requests.Session,
    pages: int = 40,
    per_page: int = 50,
    delay_seconds: float = 0.7,
) -> list[dict[str, Any]]:
    """
    Fetches the top `pages * per_page` (default 2,000) most popular anime from AniList
    with full base metadata (`title`, `seasonYear`, `format`, `synonyms`, `genres`,
    `studios`, `description`, `popularity`, and `relations`).
    """
    collected: list[dict[str, Any]] = []
    seen_ids: set[int] = set()
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
    }

    print(
        f"[PopularitySync] Fetching top {pages * per_page} anime metadata & relations from AniList "
        f"({pages} pages x {per_page}, delay={delay_seconds}s)..."
    )

    for page in range(1, pages + 1):
        media_list: list[dict[str, Any]] = []
        has_next = True

        for attempt in range(1, 5):
            try:
                resp = session.post(
                    ANILIST_GRAPHQL_URL,
                    json={
                        "query": ANILIST_TOP_METADATA_QUERY,
                        "variables": {"page": page, "perPage": per_page},
                    },
                    headers=headers,
                    timeout=20,
                )
                if resp.status_code == 429 or resp.status_code >= 500:
                    retry_after = int(resp.headers.get("Retry-After", str(5 * attempt)))
                    wait_s = min(max(retry_after, 3), 65)
                    print(
                        f"[PopularitySync] Page {page}: HTTP {resp.status_code} "
                        f"(attempt {attempt}/4). Sleeping {wait_s}s..."
                    )
                    time.sleep(wait_s)
                    continue

                resp.raise_for_status()
                page_obj = resp.json().get("data", {}).get("Page", {})
                media_list = page_obj.get("media") or []
                has_next = bool(page_obj.get("pageInfo", {}).get("hasNextPage", True))
                break
            except requests.RequestException as exc:
                if attempt == 4:
                    print(f"[PopularitySync] Page {page} failed after 4 attempts: {exc}")
                else:
                    time.sleep(2 * attempt)

        for item in media_list:
            if not isinstance(item, dict) or item.get("id") is None:
                continue
            aid = int(item["id"])
            if aid in seen_ids:
                continue
            seen_ids.add(aid)

            title = item.get("title") or {}
            studios_nodes = (item.get("studios") or {}).get("nodes") or []
            studios = list(
                dict.fromkeys(
                    s["name"].strip()
                    for s in studios_nodes
                    if isinstance(s, dict) and isinstance(s.get("name"), str) and s["name"].strip()
                )
            )
            genres = [
                g.strip()
                for g in (item.get("genres") or [])
                if isinstance(g, str) and g.strip()
            ]
            synonyms = list(
                dict.fromkeys(
                    s.strip()
                    for s in (item.get("synonyms") or [])
                    if isinstance(s, str) and s.strip()
                )
            )
            cleaned_desc = clean_scraped_text(item.get("description"), max_len=1500)
            season_year = item.get("seasonYear")
            year = (
                int(season_year)
                if isinstance(season_year, int) and 1900 <= season_year <= 2100
                else None
            )
            popularity = max(0, int(item.get("popularity") or 0))
            direct_prequel_id = extract_direct_prequel_id(item.get("relations"))

            initial_dossier: dict[str, Any] = {
                "popularity": popularity,
                "seasonYear": year,
                "studios": studios,
                "genres": genres,
                "description": cleaned_desc,
                "anilistDescription": cleaned_desc,
            }

            collected.append(
                {
                    "anilistId": aid,
                    "popularity": popularity,
                    "year": year,
                    "type": normalize_format(item.get("format")),
                    "titleEn": (title.get("english") or "").strip() or None,
                    "titleRomaji": (title.get("romaji") or "").strip() or None,
                    "titleJa": (title.get("native") or "").strip() or None,
                    "synonyms": synonyms,
                    "directPrequelId": direct_prequel_id,
                    "isSequel": False,
                    "rootAnilistId": None,
                    "initialDossier": json.dumps(initial_dossier, ensure_ascii=False),
                }
            )

        if page % 5 == 0 or page == pages:
            print(
                f"[PopularitySync] Progress: page {page}/{pages} "
                f"({len(collected)} titles fetched)"
            )

        if not has_next:
            break
        if page < pages:
            time.sleep(delay_seconds)

    resolve_franchise_roots(collected)
    return collected


def apply_popularity_updates(
    database_url: str,
    entries: list[dict[str, Any]],
) -> tuple[int, int]:
    """
    Bulk-updates `"Anime"` in PostgreSQL via a temporary staging table so missing fields
    (`titleEn`, `titleJa`, `year`, `type`, `popularity`, `synonyms`, `isSequel`,
    `rootAnilistId`, and base `dossier`) are backfilled across the top 2,000 titles
    without wiping existing enriched data.
    """
    if not entries:
        print("[PopularitySync] No entries to update.")
        return 0, 0

    dsn = sanitize_psycopg2_dsn(database_url)
    started = time.monotonic()

    rows = [
        (
            e["anilistId"],
            e["popularity"],
            e["year"],
            e["type"],
            e["titleEn"],
            e["titleRomaji"],
            e["titleJa"],
            e["synonyms"],
            bool(e["isSequel"]),
            e["rootAnilistId"],
            e["initialDossier"],
        )
        for e in entries
    ]

    conn = psycopg2.connect(dsn)
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TEMP TABLE popularity_sync_stage (
                        "anilistId"      INTEGER,
                        "popularity"     INTEGER NOT NULL,
                        "year"           INTEGER,
                        "type"           TEXT,
                        "titleEn"        TEXT,
                        "titleRomaji"    TEXT,
                        "titleJa"        TEXT,
                        "synonyms"       TEXT[],
                        "isSequel"       BOOLEAN NOT NULL DEFAULT FALSE,
                        "rootAnilistId"  INTEGER,
                        "initialDossier" JSONB
                    ) ON COMMIT DROP;
                    """
                )

                psycopg2.extras.execute_values(
                    cur,
                    """
                    INSERT INTO popularity_sync_stage (
                        "anilistId", "popularity", "year", "type",
                        "titleEn", "titleRomaji", "titleJa", "synonyms",
                        "isSequel", "rootAnilistId", "initialDossier"
                    ) VALUES %s
                    """,
                    rows,
                    page_size=500,
                )

                # 1. Match directly by anilistId and backfill all missing metadata + sequel flags
                cur.execute(
                    """
                    UPDATE "Anime" AS a
                    SET
                        "popularity" = s."popularity",
                        "titleEn" = COALESCE(NULLIF(a."titleEn", ''), s."titleEn"),
                        "titleRomaji" = COALESCE(NULLIF(a."titleRomaji", ''), s."titleRomaji"),
                        "titleJa" = COALESCE(NULLIF(a."titleJa", ''), s."titleJa"),
                        "year" = COALESCE(a."year", s."year"),
                        "type" = COALESCE(NULLIF(a."type", ''), s."type"),
                        "isSequel" = s."isSequel",
                        "rootAnilistId" = s."rootAnilistId",
                        "synonyms" = CASE
                            WHEN cardinality(s."synonyms") > 0 THEN ARRAY(
                                SELECT DISTINCT unnest(
                                    COALESCE(a."synonyms", ARRAY[]::TEXT[]) || s."synonyms"
                                )
                            )
                            ELSE a."synonyms"
                        END,
                        "dossier" = CASE
                            WHEN a."dossier" IS NULL OR a."dossier"::text IN ('{}', 'null')
                                THEN s."initialDossier"
                            ELSE s."initialDossier" || a."dossier"
                        END
                    FROM popularity_sync_stage AS s
                    WHERE a."anilistId" IS NOT NULL
                      AND a."anilistId" = s."anilistId";
                    """
                )
                matched_by_id = cur.rowcount

                # 2. Fallback case-insensitive title match for rows where anilistId is NULL
                cur.execute(
                    """
                    UPDATE "Anime" AS a
                    SET
                        "popularity" = GREATEST(a."popularity", s."popularity"),
                        "titleEn" = COALESCE(NULLIF(a."titleEn", ''), s."titleEn"),
                        "titleJa" = COALESCE(NULLIF(a."titleJa", ''), s."titleJa"),
                        "year" = COALESCE(a."year", s."year"),
                        "type" = COALESCE(NULLIF(a."type", ''), s."type"),
                        "isSequel" = s."isSequel",
                        "rootAnilistId" = COALESCE(s."rootAnilistId", a."rootAnilistId"),
                        "synonyms" = CASE
                            WHEN cardinality(s."synonyms") > 0 THEN ARRAY(
                                SELECT DISTINCT unnest(
                                    COALESCE(a."synonyms", ARRAY[]::TEXT[]) || s."synonyms"
                                )
                            )
                            ELSE a."synonyms"
                        END,
                        "dossier" = CASE
                            WHEN a."dossier" IS NULL OR a."dossier"::text IN ('{}', 'null')
                                THEN s."initialDossier"
                            ELSE s."initialDossier" || a."dossier"
                        END
                    FROM popularity_sync_stage AS s
                    WHERE a."anilistId" IS NULL
                      AND (
                        (s."titleRomaji" IS NOT NULL AND LOWER(COALESCE(a."titleRomaji", '')) = LOWER(s."titleRomaji"))
                        OR (s."titleEn" IS NOT NULL AND LOWER(COALESCE(a."titleEn", '')) = LOWER(s."titleEn"))
                        OR (s."titleEn" IS NOT NULL AND LOWER(COALESCE(a."titleRomaji", '')) = LOWER(s."titleEn"))
                        OR (s."titleRomaji" IS NOT NULL AND LOWER(COALESCE(a."titleEn", '')) = LOWER(s."titleRomaji"))
                      );
                    """
                )
                matched_by_title = cur.rowcount

                # 3. Flag obvious sequel/season titles across the remainder of the 30k+ catalog
                cur.execute(
                    """
                    UPDATE "Anime"
                    SET "isSequel" = TRUE
                    WHERE "isSequel" = FALSE
                      AND (
                        COALESCE("titleRomaji", '') ~* '(\\mSeason\\s+([2-9]|[0-9]{2,})\\M|\\m(2nd|3rd|[4-9]th|[0-9]{2,}th)\\s+Season\\M|\\mPart\\s+([2-9]|[0-9]{2,})\\M|\\mCour\\s+([2-9]|[0-9]{2,})\\M|\\mFinal\\s+Season\\M|\\m(2nd|3rd|[4-9]th)\\s+Stage\\M)'
                        OR COALESCE("titleEn", '') ~* '(\\mSeason\\s+([2-9]|[0-9]{2,})\\M|\\m(2nd|3rd|[4-9]th|[0-9]{2,}th)\\s+Season\\M|\\mPart\\s+([2-9]|[0-9]{2,})\\M|\\mCour\\s+([2-9]|[0-9]{2,})\\M|\\mFinal\\s+Season\\M|\\m(2nd|3rd|[4-9]th)\\s+Stage\\M)'
                        OR COALESCE("titleRomaji", '') ~ '(\\s|:)(II|III|IV)(\\s*$|\\s*[:\\-])'
                        OR COALESCE("titleEn", '') ~ '(\\s|:)(II|III|IV)(\\s*$|\\s*[:\\-])'
                      );
                    """
                )
                regex_flagged = cur.rowcount

                cur.execute(
                    """
                    SELECT
                        COUNT(*) FILTER (WHERE "popularity" > 0),
                        COUNT(*) FILTER (WHERE "isSequel" = TRUE),
                        COUNT(*) FILTER (WHERE "popularity" > 0 AND "isSequel" = FALSE)
                    FROM "Anime";
                    """
                )
                total_with_pop, total_sequels, ranked_roots = cur.fetchone()

        elapsed = time.monotonic() - started
        print(
            f"[PopularitySync] PostgreSQL updated in {elapsed:.2f}s -> "
            f"matched_by_anilistId={matched_by_id}, matched_by_title={matched_by_title}, "
            f"catalog_regex_flagged={regex_flagged}, total_ranked={total_with_pop}, "
            f"ranked_roots={ranked_roots}, total_sequels={total_sequels}"
        )
        return matched_by_id, matched_by_title
    finally:
        conn.close()


def sync_top_popularity(
    database_url: str,
    pages: int = 40,
    per_page: int = 50,
    delay_seconds: float = 0.7,
    session: requests.Session | None = None,
) -> tuple[int, int]:
    """End-to-end helper callable both standalone and from `import_full_catalog.py`."""
    own_session = session is None
    active_session = session or requests.Session()
    if own_session:
        active_session.headers.update({"User-Agent": USER_AGENT})

    try:
        entries = fetch_top_popular_anime(
            active_session,
            pages=pages,
            per_page=per_page,
            delay_seconds=delay_seconds,
        )
        return apply_popularity_updates(database_url, entries)
    finally:
        if own_session:
            active_session.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Backfill top 2,000 AniList popularity scores, metadata, and sequel/root franchise flags into PostgreSQL"
    )
    parser.add_argument(
        "--pages",
        type=int,
        default=40,
        help="Number of AniList pages to fetch (default: 40 -> 2,000 anime)",
    )
    parser.add_argument(
        "--per-page",
        type=int,
        default=50,
        help="Items per AniList page (default: 50, max: 50)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.7,
        help="Delay in seconds between AniList page requests (default: 0.7)",
    )
    args = parser.parse_args()

    load_env_files()
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print(
            "[PopularitySync] ERROR: DATABASE_URL is not set. Configure backend/.env or export DATABASE_URL.",
            file=sys.stderr,
        )
        sys.exit(1)

    sync_top_popularity(
        database_url=database_url,
        pages=max(1, args.pages),
        per_page=max(1, min(args.per_page, 50)),
        delay_seconds=max(0.2, args.delay),
    )


if __name__ == "__main__":
    main()
