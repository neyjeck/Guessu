#!/usr/bin/env python3
"""
Offline Gemini AI progressive clue generator for Anime Guesser.
Generates 5 escalating, non-cliche clues per anime without leaking character names or studio names early.
"""

from __future__ import annotations

import os
import pathlib

DATA_DIR = pathlib.Path(__file__).resolve().parent.parent / "data"

SYSTEM_PROMPT = """You are designing progressive deduction clues for the game "Anime Guesser".
Given an anime title and metadata, return a JSON array of 5 strings ordered from hardest (Step 1) to easiest (Step 5):
1. Step 1 (Cryptic): Describe a subtle world-building rule, recurring object, or thematic paradox without naming characters or places.
2. Step 2 (Atmospheric): Describe the inciting tension or societal structure from an unconventional angle.
3. Step 3 (Narrative Pattern): Mention a specific structural mechanic, profession, or conflict dynamic unique to this work.
4. Step 4 (Iconic Element): Reference a well-known faction, era, or secondary motif alongside release decade/format context.
5. Step 5 (Direct Hint): Provide a clear, unmistakable synthesis of the premise while still avoiding the literal title words.
"""


def build_prompt_for_anime(title_en: str, title_romaji: str) -> str:
    return (
        f"{SYSTEM_PROMPT}\n\n"
        f"Target Anime: {title_en} ({title_romaji})\n"
        "Respond strictly with a JSON array of 5 strings."
    )


def main() -> None:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("[generate_clues] GEMINI_API_KEY is not set. Skipping live Gemini API call.")
        return
    print("[generate_clues] Ready to generate progressive clues into data/seed_anime.json.")


if __name__ == "__main__":
    main()
