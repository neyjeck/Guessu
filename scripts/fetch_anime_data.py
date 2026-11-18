#!/usr/bin/env python3
"""
3-Source Offline Anime Scraper & Dossier Builder (AniList + Wikidata/Wikipedia + Fandom Wiki).

Builds rich dossiers for top 300+ popular anime from the AniList GraphQL API plus any
custom titles/IDs listed in `scripts/custom_titles.txt`:
  1. AniList GraphQL API: fetches anilistId, malId, localized titles (EN/Romaji/JA),
     synonyms, coverImage.large, genres, tags, popularity, description, and main characters.
  2. Wikidata SPARQL (P8729 AniList ID / P4086 MAL ID) + MediaWiki langlinks fallback:
     fetches Ukrainian (uk) and Russian (ru) titles and localized aliases.
  3. Wikipedia REST/MediaWiki API & Fandom MediaWiki API (`api.php?action=parse`):
     fetches plot summary from Wikipedia and extracts Trivia, memes, and character quirks
     from Fandom Wiki pages.
  4. Saves incrementally to `data/anime_dossiers.json` so progress is preserved if interrupted.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import pathlib
import re
import time
from typing import Any

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

ROOT_DIR = pathlib.Path(__file__).resolve().parent.parent
SCRIPTS_DIR = pathlib.Path(__file__).resolve().parent
DATA_DIR = ROOT_DIR / "data"
OUTPUT_FILE = DATA_DIR / "anime_dossiers.json"
CUSTOM_TITLES_FILE = SCRIPTS_DIR / "custom_titles.txt"

load_dotenv(ROOT_DIR / ".env")
load_dotenv(ROOT_DIR / "backend" / ".env")

ANILIST_URL = "https://graphql.anilist.co"
WIKIDATA_SPARQL_URL = "https://query.wikidata.org/sparql"
EN_WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"

USER_AGENT = "AnimeGuesserDataPipeline/2.0 (https://github.com/anime-guesser; contact@animeguesser.local)"

ANILIST_PAGE_QUERY = """
query ($page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo {
      hasNextPage
      currentPage
    }
    media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
      id
      idMal
      popularity
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
      genres
      tags {
        name
        rank
        isMediaSpoiler
      }
      description(asHtml: false)
      characters(sort: [ROLE, RELEVANCE, ID], perPage: 8) {
        edges {
          role
          node {
            name {
              full
            }
            description(asHtml: false)
          }
        }
      }
    }
  }
}
"""

ANILIST_SINGLE_QUERY = """
query ($id: Int, $search: String) {
  Media(id: $id, search: $search, type: ANIME, isAdult: false) {
    id
    idMal
    popularity
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
    genres
    tags {
      name
      rank
      isMediaSpoiler
    }
    description(asHtml: false)
    characters(sort: [ROLE, RELEVANCE, ID], perPage: 8) {
      edges {
        role
        node {
          name {
            full
          }
          description(asHtml: false)
        }
      }
    }
  }
}
"""


def clean_markup(text: str | None, max_len: int = 1200) -> str:
    """Strips AniList/HTML/Markdown spoiler tags and normalizes whitespace."""
    if not text:
        return ""
    cleaned = html.unescape(text)
    cleaned = re.sub(r"~!.+?!~", "", cleaned, flags=re.DOTALL)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = re.sub(r"__(.+?)__", r"\1", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:max_len]


def post_anilist(session: requests.Session, query: str, variables: dict[str, Any]) -> dict[str, Any]:
    """Executes an AniList GraphQL query with rate-limit backoff handling."""
    for attempt in range(4):
        resp = session.post(
            ANILIST_URL,
            json={"query": query, "variables": variables},
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            timeout=30,
        )
        if resp.status_code == 429:
            retry_after = int(resp.headers.get("Retry-After", "15"))
            print(f"[AniList] Rate limited (429). Sleeping {retry_after}s...")
            time.sleep(retry_after + 1)
            continue
        resp.raise_for_status()
        return resp.json()
    raise RuntimeError("Exceeded AniList retry attempts")


def fetch_top_anilist_media(session: requests.Session, target_count: int = 300) -> list[dict[str, Any]]:
    """Fetches top popular anime pages from AniList up to target_count."""
    per_page = 50
    pages = (target_count + per_page - 1) // per_page
    collected: list[dict[str, Any]] = []
    seen_ids: set[int] = set()

    for page in range(1, pages + 1):
        print(f"[AniList] Fetching popular anime page {page}/{pages}...")
        data = post_anilist(session, ANILIST_PAGE_QUERY, {"page": page, "perPage": per_page})
        media_list = data.get("data", {}).get("Page", {}).get("media", [])
        for item in media_list:
            aid = item.get("id")
            if aid and aid not in seen_ids:
                seen_ids.add(aid)
                collected.append(item)
        time.sleep(0.85)
        if len(collected) >= target_count:
            break

    return collected[:target_count]


def load_custom_titles(path: pathlib.Path) -> list[str]:
    """Reads non-empty, non-comment lines from custom_titles.txt."""
    if not path.exists():
        return []
    entries: list[str] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        entries.append(line)
    return entries


def fetch_custom_anilist_media(
    session: requests.Session,
    custom_entries: list[str],
    existing_ids: set[int],
) -> list[dict[str, Any]]:
    """Fetches custom anime entries by AniList ID or search string if not already fetched."""
    custom_media: list[dict[str, Any]] = []
    for entry in custom_entries:
        variables: dict[str, Any] = {}
        if entry.isdigit():
            aid = int(entry)
            if aid in existing_ids:
                continue
            variables["id"] = aid
        else:
            variables["search"] = entry

        try:
            data = post_anilist(session, ANILIST_SINGLE_QUERY, variables)
            media = data.get("data", {}).get("Media")
            if media and media.get("id") not in existing_ids:
                existing_ids.add(media["id"])
                custom_media.append(media)
                print(f"[AniList] Added custom title: {media.get('title', {}).get('romaji')} (ID {media['id']})")
        except Exception as exc:
            print(f"[AniList] Warning: could not resolve custom entry '{entry}': {exc}")
        time.sleep(0.8)
    return custom_media


def fetch_wikidata_batch(
    session: requests.Session,
    media_batch: list[dict[str, Any]],
) -> dict[int, dict[str, Any]]:
    """
    Queries Wikidata SPARQL for Ukrainian (uk) and Russian (ru) labels, aliases,
    and English Wikipedia sitelinks using P8729 (AniList ID) and P4086 (MAL ID).
    """
    anilist_ids = [str(m["id"]) for m in media_batch if m.get("id")]
    mal_ids = [str(m["idMal"]) for m in media_batch if m.get("idMal")]
    if not anilist_ids and not mal_ids:
        return {}

    anilist_values = " ".join(f'"{aid}"' for aid in anilist_ids)
    mal_values = " ".join(f'"{mid}"' for mid in mal_ids)

    sparql = f"""
    SELECT ?item ?anilistId ?malId ?labelUk ?labelRu ?enWikiTitle WHERE {{
      {{
        VALUES ?anilistId {{ {anilist_values} }}
        ?item wdt:P8729 ?anilistId .
      }}
      UNION
      {{
        VALUES ?malId {{ {mal_values} }}
        ?item wdt:P4086 ?malId .
      }}
      OPTIONAL {{ ?item wdt:P8729 ?anilistId . }}
      OPTIONAL {{ ?item wdt:P4086 ?malId . }}
      OPTIONAL {{ ?item rdfs:label ?labelUk FILTER(LANG(?labelUk) = "uk") }}
      OPTIONAL {{ ?item rdfs:label ?labelRu FILTER(LANG(?labelRu) = "ru") }}
      OPTIONAL {{
        ?article schema:about ?item ;
                 schema:isPartOf <https://en.wikipedia.org/> ;
                 schema:name ?enWikiTitle .
      }}
    }}
    """

    result_map: dict[int, dict[str, Any]] = {}
    mal_to_anilist = {int(m["idMal"]): int(m["id"]) for m in media_batch if m.get("idMal") and m.get("id")}

    try:
        resp = session.get(
            WIKIDATA_SPARQL_URL,
            params={"query": sparql, "format": "json"},
            headers={"Accept": "application/sparql-results+json"},
            timeout=30,
        )
        if resp.ok:
            bindings = resp.json().get("results", {}).get("bindings", [])
            for row in bindings:
                aid: int | None = None
                if "anilistId" in row and row["anilistId"]["value"].isdigit():
                    aid = int(row["anilistId"]["value"])
                elif "malId" in row and row["malId"]["value"].isdigit():
                    aid = mal_to_anilist.get(int(row["malId"]["value"]))

                if not aid:
                    continue

                entry = result_map.setdefault(aid, {"titleUk": None, "titleRu": None, "enWikiTitle": None})
                if "labelUk" in row and not entry["titleUk"]:
                    entry["titleUk"] = row["labelUk"]["value"]
                if "labelRu" in row and not entry["titleRu"]:
                    entry["titleRu"] = row["labelRu"]["value"]
                if "enWikiTitle" in row and not entry["enWikiTitle"]:
                    entry["enWikiTitle"] = row["enWikiTitle"]["value"]
    except Exception as exc:
        print(f"[Wikidata] SPARQL batch warning: {exc}")

    return result_map


def fetch_wikipedia_plot_and_langlinks(
    session: requests.Session,
    search_title: str,
    en_wiki_title: str | None = None,
) -> dict[str, Any]:
    """
    Fetches the Wikipedia plot/extract summary and fallback uk/ru interlanguage links.
    """
    resolved_title = en_wiki_title
    if not resolved_title:
        try:
            search_resp = session.get(
                EN_WIKIPEDIA_API,
                params={
                    "action": "query",
                    "list": "search",
                    "srsearch": f"{search_title} anime",
                    "srlimit": 1,
                    "format": "json",
                },
                timeout=15,
            )
            if search_resp.ok:
                hits = search_resp.json().get("query", {}).get("search", [])
                if hits:
                    resolved_title = hits[0]["title"]
        except Exception:
            pass

    if not resolved_title:
        return {"wikipediaPlot": "", "titleUk": None, "titleRu": None}

    try:
        resp = session.get(
            EN_WIKIPEDIA_API,
            params={
                "action": "query",
                "titles": resolved_title,
                "prop": "extracts|langlinks",
                "explaintext": 1,
                "exsectionformat": "plain",
                "lllimit": 500,
                "redirects": 1,
                "format": "json",
            },
            timeout=15,
        )
        if not resp.ok:
            return {"wikipediaPlot": "", "titleUk": None, "titleRu": None}

        pages = resp.json().get("query", {}).get("pages", {})
        for page in pages.values():
            extract = page.get("extract") or ""
            langlinks = page.get("langlinks") or []
            uk_title = None
            ru_title = None
            for ll in langlinks:
                if ll.get("lang") == "uk":
                    uk_title = re.sub(r"\s*\(.*?\)\s*$", "", ll.get("*", "")).strip()
                elif ll.get("lang") == "ru":
                    ru_title = re.sub(r"\s*\(.*?\)\s*$", "", ll.get("*", "")).strip()

            return {
                "wikipediaPlot": clean_markup(extract, max_len=1400),
                "titleUk": uk_title,
                "titleRu": ru_title,
            }
    except Exception:
        pass

    return {"wikipediaPlot": "", "titleUk": None, "titleRu": None}


def slugify_fandom_domain(title_en: str, title_romaji: str) -> list[str]:
    """Generates candidate Fandom subdomain slugs for an anime title."""
    candidates: list[str] = []
    for raw in (title_en, title_romaji):
        if not raw:
            continue
        base = raw.lower().split(":")[0].strip()
        slug = re.sub(r"[^a-z0-9]", "", base)
        if len(slug) >= 3 and slug not in candidates:
            candidates.append(slug)
        dashed = re.sub(r"[^a-z0-9]+", "-", base).strip("-")
        if len(dashed) >= 3 and dashed not in candidates:
            candidates.append(dashed)
    return candidates[:3]


def fetch_fandom_trivia(
    session: requests.Session,
    title_en: str | None,
    title_romaji: str,
    main_character_name: str | None,
) -> tuple[list[str], str | None]:
    """
    Queries the anime's Fandom MediaWiki API (`api.php?action=parse`) to extract
    Trivia bullets, memes, and character quirks using BeautifulSoup.
    """
    slugs = slugify_fandom_domain(title_en or "", title_romaji)
    for slug in slugs:
        api_url = f"https://{slug}.fandom.com/api.php"
        target_page = main_character_name or title_en or title_romaji
        try:
            search_resp = session.get(
                api_url,
                params={
                    "action": "query",
                    "list": "search",
                    "srsearch": target_page,
                    "srlimit": 1,
                    "format": "json",
                },
                timeout=10,
            )
            if not search_resp.ok:
                continue
            search_hits = search_resp.json().get("query", {}).get("search", [])
            page_title = search_hits[0]["title"] if search_hits else target_page

            parse_resp = session.get(
                api_url,
                params={
                    "action": "parse",
                    "page": page_title,
                    "prop": "text",
                    "redirects": 1,
                    "format": "json",
                },
                timeout=12,
            )
            if not parse_resp.ok:
                continue

            html_text = parse_resp.json().get("parse", {}).get("text", {}).get("*", "")
            if not html_text:
                continue

            soup = BeautifulSoup(html_text, "html.parser")
            trivia_items: list[str] = []

            for heading in soup.find_all(["h2", "h3"]):
                heading_text = heading.get_text(" ", strip=True).lower()
                if any(k in heading_text for k in ("trivia", "quotes", "personality", "abilities")):
                    ul = heading.find_next("ul")
                    if ul:
                        for li in ul.find_all("li", recursive=False):
                            item_text = clean_markup(li.get_text(" ", strip=True), max_len=280)
                            if len(item_text) >= 25:
                                trivia_items.append(item_text)
                            if len(trivia_items) >= 8:
                                break
                if len(trivia_items) >= 8:
                    break

            if trivia_items:
                return trivia_items[:8], f"https://{slug}.fandom.com/wiki/{page_title.replace(' ', '_')}"
        except Exception:
            continue

    return [], None


def build_anime_record(
    raw: dict[str, Any],
    wikidata_info: dict[str, Any],
    wiki_info: dict[str, Any],
    fandom_trivia: list[str],
    fandom_url: str | None,
) -> dict[str, Any]:
    """Combines AniList, Wikidata/Wikipedia, and Fandom data into a single dossier record."""
    title_obj = raw.get("title") or {}
    romaji = title_obj.get("romaji") or title_obj.get("english") or "Unknown"
    english = title_obj.get("english") or romaji
    native = title_obj.get("native")

    title_uk = wikidata_info.get("titleUk") or wiki_info.get("titleUk")
    title_ru = wikidata_info.get("titleRu") or wiki_info.get("titleRu")

    cover_obj = raw.get("coverImage") or {}
    cover_url = cover_obj.get("large") or cover_obj.get("extraLarge") or ""

    raw_synonyms = raw.get("synonyms") or []
    synonyms = list(dict.fromkeys([s.strip() for s in raw_synonyms if isinstance(s, str) and s.strip()]))

    tags = [
        t["name"]
        for t in (raw.get("tags") or [])
        if isinstance(t, dict) and t.get("name") and not t.get("isMediaSpoiler") and (t.get("rank") or 0) >= 55
    ][:15]

    characters: list[dict[str, str]] = []
    for edge in (raw.get("characters") or {}).get("edges") or []:
        node = (edge or {}).get("node") or {}
        name_full = (node.get("name") or {}).get("full")
        if not name_full:
            continue
        characters.append(
            {
                "name": name_full,
                "role": edge.get("role") or "MAIN",
                "description": clean_markup(node.get("description"), max_len=350),
            }
        )

    dossier = {
        "popularity": raw.get("popularity") or 0,
        "genres": raw.get("genres") or [],
        "tags": tags,
        "anilistDescription": clean_markup(raw.get("description"), max_len=1000),
        "wikipediaPlot": wiki_info.get("wikipediaPlot") or "",
        "characters": characters,
        "fandomTrivia": fandom_trivia,
        "fandomUrl": fandom_url,
    }

    return {
        "anilistId": int(raw["id"]),
        "malId": int(raw["idMal"]) if raw.get("idMal") else None,
        "titleEn": english,
        "titleRomaji": romaji,
        "titleJa": native,
        "titleUk": title_uk,
        "titleRu": title_ru,
        "synonyms": synonyms,
        "coverUrl": cover_url,
        "screenshots": [],
        "dossier": dossier,
    }


def load_existing_dossiers(path: pathlib.Path) -> dict[int, dict[str, Any]]:
    """Loads existing `data/anime_dossiers.json` keyed by anilistId for incremental resume."""
    if not path.exists():
        return {}
    try:
        items = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(items, list):
            return {int(item["anilistId"]): item for item in items if "anilistId" in item}
    except Exception as exc:
        print(f"[Scraper] Could not read existing {path}: {exc}")
    return {}


def save_dossiers(path: pathlib.Path, records_by_id: dict[int, dict[str, Any]]) -> None:
    """Atomically writes all collected dossiers to `data/anime_dossiers.json`."""
    path.parent.mkdir(parents=True, exist_ok=True)
    ordered = sorted(
        records_by_id.values(),
        key=lambda r: -(r.get("dossier", {}).get("popularity") or 0),
    )
    tmp_path = path.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(ordered, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_path.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="3-Source Anime Dossier Scraper (AniList + Wikipedia + Fandom)")
    parser.add_argument("--target-count", type=int, default=300, help="Number of top popular anime to fetch (default: 300)")
    parser.add_argument("--force-refresh", action="store_true", help="Re-scrape entries already present in anime_dossiers.json")
    args = parser.parse_args()

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    records_by_id = load_existing_dossiers(OUTPUT_FILE)
    print(f"[Scraper] Loaded {len(records_by_id)} existing records from {OUTPUT_FILE}")

    media_items = fetch_top_anilist_media(session, target_count=args.target_count)
    seen_ids = {int(m["id"]) for m in media_items if m.get("id")}

    custom_entries = load_custom_titles(CUSTOM_TITLES_FILE)
    if custom_entries:
        print(f"[Scraper] Resolving {len(custom_entries)} custom entries from {CUSTOM_TITLES_FILE}...")
        custom_media = fetch_custom_anilist_media(session, custom_entries, seen_ids)
        media_items.extend(custom_media)

    to_process = [
        m for m in media_items if args.force_refresh or int(m["id"]) not in records_by_id
    ]
    print(f"[Scraper] {len(to_process)} anime entries queued for enrichment (total target: {len(media_items)})")

    batch_size = 25
    for start in range(0, len(to_process), batch_size):
        batch = to_process[start : start + batch_size]
        wikidata_map = fetch_wikidata_batch(session, batch)

        for raw in batch:
            aid = int(raw["id"])
            title_obj = raw.get("title") or {}
            romaji = title_obj.get("romaji") or "Unknown"
            english = title_obj.get("english") or romaji

            wd_info = wikidata_map.get(aid, {})
            wiki_info = fetch_wikipedia_plot_and_langlinks(
                session,
                english,
                en_wiki_title=wd_info.get("enWikiTitle"),
            )

            edges = (raw.get("characters") or {}).get("edges") or []
            main_char = (
                ((edges[0] or {}).get("node") or {}).get("name", {}).get("full")
                if edges
                else None
            )
            fandom_trivia, fandom_url = fetch_fandom_trivia(
                session,
                english,
                romaji,
                main_char,
            )

            record = build_anime_record(raw, wd_info, wiki_info, fandom_trivia, fandom_url)
            records_by_id[aid] = record
            save_dossiers(OUTPUT_FILE, records_by_id)
            print(
                f"[Scraper] Saved {romaji} (ID={aid}, UK={record['titleUk']}, RU={record['titleRu']}, trivia={len(fandom_trivia)})"
            )
            time.sleep(0.35)

    print(f"[Scraper] Done! Total dossiers in {OUTPUT_FILE}: {len(records_by_id)}")


if __name__ == "__main__":
    main()
