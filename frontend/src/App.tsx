import { useState } from 'react';
import { Flame, Image, Search, Sparkles, Trophy, User } from 'lucide-react';
import { apiClient } from './api/client';

type GameMode = 'CLUES' | 'SCREENSHOT' | 'ENDLESS';

interface AnimeSuggestion {
  id: number;
  titleEn: string | null;
  titleRomaji: string;
  titleUk: string | null;
}

export function App() {
  const [mode, setMode] = useState<GameMode>('CLUES');
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<AnimeSuggestion[]>([]);

  const handleSearchChange = async (value: string) => {
    setQuery(value);
    if (value.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    try {
      const response = await apiClient.get<AnimeSuggestion[]>('/anime/search', {
        params: { q: value, limit: 6 },
      });
      setSuggestions(response.data);
    } catch {
      setSuggestions([]);
    }
  };

  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="brand">
          <Sparkles size={22} />
          <span>Anime Guesser</span>
        </div>
        <div className="nav-stats">
          <span className="pill">
            <Flame size={16} /> Streak: 0
          </span>
          <span className="pill">
            <Trophy size={16} /> 1000 MMR
          </span>
          <span className="pill">
            <User size={16} /> Guest
          </span>
        </div>
      </header>

      <main className="arena">
        <section className="mode-selector">
          <button
            type="button"
            className={mode === 'CLUES' ? 'active' : ''}
            onClick={() => setMode('CLUES')}
          >
            <Sparkles size={16} /> AI Clues
          </button>
          <button
            type="button"
            className={mode === 'SCREENSHOT' ? 'active' : ''}
            onClick={() => setMode('SCREENSHOT')}
          >
            <Image size={16} /> Frame Guess
          </button>
          <button
            type="button"
            className={mode === 'ENDLESS' ? 'active' : ''}
            onClick={() => setMode('ENDLESS')}
          >
            <Flame size={16} /> Endless Streak
          </button>
        </section>

        <section className="deduction-grid">
          <div className="clue-panel">
            <h2>Progressive Clues ({mode})</h2>
            <p className="clue-item">
              Step 1: Non-cliche atmospheric AI clue appears directly beside your search input.
            </p>
          </div>

          <div className="search-panel">
            <label htmlFor="anime-search" className="search-label">
              Multilingual Search (EN / Romaji / JA / UK / RU)
            </label>
            <div className="search-box">
              <Search size={18} />
              <input
                id="anime-search"
                type="text"
                value={query}
                onChange={(e) => void handleSearchChange(e.target.value)}
                placeholder="Type anime title in any supported language..."
              />
            </div>
            {suggestions.length > 0 && (
              <ul className="suggestions-list">
                {suggestions.map((item) => (
                  <li key={item.id}>
                    <strong>{item.titleEn ?? item.titleRomaji}</strong>
                    <span>{item.titleUk ?? item.titleRomaji}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
