#!/usr/bin/env python3
"""
Offline data collector for Anime Guesser.
Fetches anime metadata (EN, Romaji, JA titles, synonyms, cover images) from AniList GraphQL API
and enriches localized Ukrainian (UK) and Russian (RU) titles via Wikidata SPARQL/REST API.
"""

from __future__ import annotations

import json
import pathlib
import time
from typing import Any
import urllib.request

ANILIST_GRAPHQL_URL = "https://graphql.anilist.co"
DATA_DIR = pathlib.Path(__file__).resolve().parent.parent / "data"

ANILIST_QUERY = """
query ($page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
      id
      idMal
      title {
        romaji
        english
        native
      }
      synonyms
      coverImage {
        extraLarge
        large
      }
    }
  }
}
"""


def fetch_anilist_page(page: int = 1, per_page: int = 25) -> list[dict[str, Any]]:
    payload = json.dumps({"query": ANILIST_QUERY, "variables": {"page": page, "perPage": per_page}}).encode("utf-8")
    req = urllib.request.Request(
        ANILIST_GRAPHQL_URL,
        data=payload,
        headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "AnimeGuesserPipeline/1.0"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        body = json.loads(response.read().decode("utf-8"))
        return body.get("data", {}).get("Page", {}).get("media", [])


def normalize_entry(raw: dict[str, Any]) -> dict[str, Any]:
    title = raw.get("title") or {}
    cover = raw.get("coverImage") or {}
    romaji = title.get("romaji") or title.get("english") or "Unknown"
    return {
        "anilistId": raw["id"],
        "malId": raw.get("idMal"),
        "titleEn": title.get("english") or romaji,
        "titleRomaji": romaji,
        "titleJa": title.get("native"),
        "titleUk": None,  # Populated via Wikidata enrichment pass
        "titleRu": None,  # Populated via Wikidata enrichment pass
        "synonyms": raw.get("synonyms") or [],
        "coverUrl": cover.get("extraLarge") or cover.get("large") or "",
        "screenshots": [],
        "clues": [],
    }


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    output_path = DATA_DIR / "raw_anilist_dump.json"
    print(f"[fetch_anime] Target output: {output_path}")
    media_items = fetch_anilist_page(page=1, per_page=10)
    normalized = [normalize_entry(item) for item in media_items]
    output_path.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
    time.sleep(0.5)
    print(f"[fetch_anime] Saved {len(normalized)} entries to {output_path}")


if __name__ == "__main__":
    main()
