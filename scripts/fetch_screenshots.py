#!/usr/bin/env python3
"""
Offline screenshot/frame collector for Anime Guesser.
Attaches curated episode frame URLs Ordered from cryptic background shots to recognizable shots.
"""

from __future__ import annotations

import json
import pathlib
from typing import Any

DATA_DIR = pathlib.Path(__file__).resolve().parent.parent / "data"


def attach_placeholder_screenshots(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for entry in entries:
        if not entry.get("screenshots"):
            aid = entry.get("anilistId", 0)
            entry["screenshots"] = [
                f"https://cdn.animeguesser.local/frames/{aid}/step-1.webp",
                f"https://cdn.animeguesser.local/frames/{aid}/step-2.webp",
                f"https://cdn.animeguesser.local/frames/{aid}/step-3.webp",
                f"https://cdn.animeguesser.local/frames/{aid}/step-4.webp",
            ]
    return entries


def main() -> None:
    source_path = DATA_DIR / "raw_anilist_dump.json"
    if not source_path.exists():
        print(f"[fetch_screenshots] No dump found at {source_path}. Run fetch_anime.py first.")
        return

    entries = json.loads(source_path.read_text(encoding="utf-8"))
    enriched = attach_placeholder_screenshots(entries)
    source_path.write_text(json.dumps(enriched, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[fetch_screenshots] Updated {len(enriched)} entries with screenshot slots.")


if __name__ == "__main__":
    main()
