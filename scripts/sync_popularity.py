#!/usr/bin/env python3
"""
Fast AniList Top-1500 Popularity Sync Script.

Queries the public AniList GraphQL API (`Page(page: 1..30, perPage: 50)` sorted by
`POPULARITY_DESC`) with a polite 0.7s delay between pages (~20 seconds total) and
bulk-updates `popularity` in PostgreSQL `"Anime"` matching by `anilistId` (with a
case-insensitive `titleRomaji` / `titleEn` fallback for rows where `anilistId` is NULL).
"""

from __future__ import annotations

import argparse
import os
import pathlib
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
    "AnimeGuesserPopularitySync/1.0 "
    "(https://github.com/anime-guesser; contact@animeguesser.local)"
)

ANILIST_POPULARITY_PAGE_QUERY = """
query ($page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo {
      hasNextPage
      currentPage
    }
    media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
      id
      popularity
      title {
        english
        romaji
      }
    }
  }
}
"""


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


def fetch_top_popular_anime(
    session: requests.Session,
    pages: int = 30,
    per_page: int = 50,
    delay_seconds: float = 0.7,
) -> list[dict[str, Any]]:
    """
    Fetches the top `pages * per_page` (default 1,500) most popular anime from AniList
    using paginated `POPULARITY_DESC` GraphQL queries with polite rate limiting.
    """
    collected: list[dict[str, Any]] = []
    seen_ids: set[int] = set()
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
    }

    print(
        f"[PopularitySync] Fetching top {pages * per_page} anime from AniList "
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
                        "query": ANILIST_POPULARITY_PAGE_QUERY,
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
            collected.append(
                {
                    "anilistId": aid,
                    "popularity": max(0, int(item.get("popularity") or 0)),
                    "titleEn": (title.get("english") or "").strip() or None,
                    "titleRomaji": (title.get("romaji") or "").strip() or None,
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

    return collected


def apply_popularity_updates(
    database_url: str,
    entries: list[dict[str, Any]],
) -> tuple[int, int]:
    """
    Updates `"Anime"."popularity"` in PostgreSQL via a temporary staging table:
      1) Primary match by `"anilistId"`.
      2) Fallback case-insensitive match by `"titleRomaji"` / `"titleEn"` when `"anilistId"` is NULL.
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
            e["titleEn"],
            e["titleRomaji"],
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
                        "anilistId"   INTEGER,
                        "popularity"  INTEGER NOT NULL,
                        "titleEn"     TEXT,
                        "titleRomaji" TEXT
                    ) ON COMMIT DROP;
                    """
                )

                psycopg2.extras.execute_values(
                    cur,
                    """
                    INSERT INTO popularity_sync_stage (
                        "anilistId", "popularity", "titleEn", "titleRomaji"
                    ) VALUES %s
                    """,
                    rows,
                    page_size=500,
                )

                # 1. Match directly by anilistId
                cur.execute(
                    """
                    UPDATE "Anime" AS a
                    SET
                        "popularity" = s."popularity",
                        "titleEn" = COALESCE(NULLIF(a."titleEn", ''), s."titleEn")
                    FROM popularity_sync_stage AS s
                    WHERE a."anilistId" IS NOT NULL
                      AND a."anilistId" = s."anilistId";
                    """
                )
                matched_by_id = cur.rowcount

                # 2. Fallback case-insensitive title match for rows missing anilistId
                cur.execute(
                    """
                    UPDATE "Anime" AS a
                    SET
                        "popularity" = GREATEST(a."popularity", s."popularity"),
                        "titleEn" = COALESCE(NULLIF(a."titleEn", ''), s."titleEn")
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

                cur.execute('SELECT COUNT(*) FROM "Anime" WHERE "popularity" > 0;')
                total_with_pop = cur.fetchone()[0]

        elapsed = time.monotonic() - started
        print(
            f"[PopularitySync] PostgreSQL updated in {elapsed:.2f}s -> "
            f"matched_by_anilistId={matched_by_id}, matched_by_title={matched_by_title}, "
            f"total_ranked_in_db={total_with_pop}"
        )
        return matched_by_id, matched_by_title
    finally:
        conn.close()


def sync_top_popularity(
    database_url: str,
    pages: int = 30,
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
        description="Sync top 1,500 AniList popularity scores into PostgreSQL Anime table"
    )
    parser.add_argument(
        "--pages",
        type=int,
        default=30,
        help="Number of AniList pages to fetch (default: 30 -> 1,500 anime)",
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
