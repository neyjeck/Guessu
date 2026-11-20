import React, { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { apiClient } from '../api/client';
import { AppLanguage, useLanguage } from '../context/LanguageContext';

export interface AnimeSearchResultItem {
  id: number;
  anilistId: number | null;
  titleEn: string | null;
  titleRomaji: string | null;
  titleJa: string | null;
  titleUk: string | null;
  titleRu: string | null;
  synonyms?: string[];
  coverUrl: string | null;
  type?: string | null;
  year?: number | null;
}

interface AnimeAutocompleteInputProps {
  onSelect?: (anime: AnimeSearchResultItem) => void;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Splits `text` around case-insensitive occurrences of `highlight` and wraps
 * matched substrings in `<mark className="autocomplete-highlight">`.
 */
function renderHighlightedText(text: string, highlight: string): React.ReactNode {
  const trimmed = highlight.trim();
  if (!trimmed || trimmed.length < 2) {
    return text;
  }

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);

  if (parts.length === 1) {
    return text;
  }

  const lowerNeedle = trimmed.toLowerCase();
  return parts.map((part, idx) =>
    part.toLowerCase() === lowerNeedle ? (
      <mark key={idx} className="autocomplete-highlight">
        {part}
      </mark>
    ) : (
      <React.Fragment key={idx}>{part}</React.Fragment>
    ),
  );
}

/**
 * Selects the primary display title and up to two localized subtitle lines
 * based on the active UI language and which field matched the user's query.
 */
function resolveDisplayTitles(
  item: AnimeSearchResultItem,
  lang: AppLanguage,
  query: string,
): { primary: string; subtitles: string[] } {
  const qLower = query.trim().toLowerCase();

  const preferredByLang: Record<AppLanguage, Array<string | null | undefined>> = {
    uk: [item.titleUk, item.titleEn, item.titleRomaji, item.titleRu, item.titleJa],
    en: [item.titleEn, item.titleRomaji, item.titleUk, item.titleRu, item.titleJa],
    ru: [item.titleRu, item.titleEn, item.titleRomaji, item.titleUk, item.titleJa],
  };

  const orderedCandidates = preferredByLang[lang]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());

  const primary = orderedCandidates[0] ?? item.titleRomaji ?? item.titleEn ?? 'Unknown';

  const allDistinct = Array.from(
    new Set([
      ...orderedCandidates,
      ...(item.synonyms ?? []).filter((s) => s.trim().length > 0),
    ]),
  ).filter((t) => t.toLowerCase() !== primary.toLowerCase());

  // Prioritize subtitles that directly contain the typed query substring
  const matchingSubtitles = allDistinct.filter((t) =>
    t.toLowerCase().includes(qLower),
  );
  const otherSubtitles = allDistinct.filter(
    (t) => !t.toLowerCase().includes(qLower),
  );

  const subtitles = [...matchingSubtitles, ...otherSubtitles].slice(0, 2);
  return { primary, subtitles };
}

export function AnimeAutocompleteInput({
  onSelect,
  placeholder,
  disabled = false,
}: AnimeAutocompleteInputProps) {
  const { lang, t } = useLanguage();
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AnimeSearchResultItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced (200ms) search calling GET /api/anime/search?q=...
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setIsLoading(false);
      setIsOpen(false);
      setActiveIndex(-1);
      return;
    }

    const abortController = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      try {
        const response = await apiClient.get<AnimeSearchResultItem[]>(
          '/anime/search',
          {
            params: { q: trimmed, limit: 15 },
            signal: abortController.signal,
          },
        );
        setResults(response.data);
        setIsOpen(true);
        setActiveIndex(response.data.length > 0 ? 0 : -1);
      } catch {
        if (!abortController.signal.aborted) {
          setResults([]);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, 200);

    return () => {
      window.clearTimeout(timer);
      abortController.abort();
    };
  }, [query]);

  const handleSelect = (item: AnimeSearchResultItem) => {
    const { primary } = resolveDisplayTitles(item, lang, query);
    setQuery(primary);
    setIsOpen(false);
    setActiveIndex(-1);
    onSelect?.(item);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen && results.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      setIsOpen(true);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (results.length === 0) return;
      setActiveIndex((prev) => (prev + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length === 0) return;
      setActiveIndex((prev) => (prev <= 0 ? results.length - 1 : prev - 1));
    } else if (event.key === 'Enter') {
      if (isOpen && results.length > 0) {
        event.preventDefault();
        const target = results[activeIndex >= 0 ? activeIndex : 0];
        if (target) {
          handleSelect(target);
        }
      }
    } else if (event.key === 'Escape') {
      if (isOpen) {
        event.preventDefault();
        setIsOpen(false);
        setActiveIndex(-1);
      }
    }
  };

  const clearInput = () => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  return (
    <div className="autocomplete-container" ref={containerRef}>
      <div className="search-box">
        {isLoading ? (
          <Loader2 size={18} className="spin-icon" />
        ) : (
          <Search size={18} />
        )}
        <input
          ref={inputRef}
          id="anime-search"
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            isOpen && activeIndex >= 0
              ? `${listboxId}-option-${activeIndex}`
              : undefined
          }
          disabled={disabled}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (query.trim().length >= 2 && results.length > 0) {
              setIsOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? t.searchPlaceholder}
          autoComplete="off"
        />
        {query.length > 0 && (
          <button
            type="button"
            className="autocomplete-clear-btn"
            onClick={clearInput}
            aria-label="Clear search query"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {isOpen && query.trim().length >= 2 && (
        <div className="autocomplete-dropdown">
          {results.length > 0 ? (
            <>
              <ul
                id={listboxId}
                role="listbox"
                className="autocomplete-list"
              >
                {results.map((item, idx) => {
                  const { primary, subtitles } = resolveDisplayTitles(
                    item,
                    lang,
                    query,
                  );
                  const isActive = idx === activeIndex;

                  return (
                    <li
                      key={item.id}
                      id={`${listboxId}-option-${idx}`}
                      role="option"
                      aria-selected={isActive}
                      className={`autocomplete-option ${isActive ? 'active' : ''}`}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelect(item);
                      }}
                    >
                      {item.coverUrl && (
                        <img
                          src={item.coverUrl}
                          alt={primary}
                          className="autocomplete-cover"
                          loading="lazy"
                        />
                      )}
                      <div className="autocomplete-titles">
                        <div className="autocomplete-primary-title">
                          {renderHighlightedText(primary, query)}
                        </div>
                        {subtitles.length > 0 && (
                          <div className="autocomplete-subtitles">
                            {subtitles.map((sub, subIdx) => (
                              <span key={subIdx} className="autocomplete-subtitle-chip">
                                {renderHighlightedText(sub, query)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="autocomplete-footer">{t.keyboardHint}</div>
            </>
          ) : (
            !isLoading && (
              <div className="autocomplete-empty">{t.noResults}</div>
            )
          )}
        </div>
      )}
    </div>
  );
}
