import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Flame,
  Image,
  LogIn,
  LogOut,
  MailCheck,
  Search,
  Sparkles,
  Trophy,
  User,
  UserPlus,
} from 'lucide-react';
import { apiClient } from './api/client';
import { AuthModal, AuthTab } from './components/AuthModal';
import { useAuth } from './context/AuthContext';

type GameMode = 'CLUES' | 'SCREENSHOT' | 'ENDLESS';

interface AnimeSuggestion {
  id: number;
  titleEn: string | null;
  titleRomaji: string;
  titleUk: string | null;
}

export function App() {
  const { user, isLoading, authError, logout } = useAuth();
  const [mode, setMode] = useState<GameMode>('CLUES');
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<AnimeSuggestion[]>([]);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState<AuthTab>('login');
  const [authModalEmail, setAuthModalEmail] = useState<string>('');

  useEffect(() => {
    if (authError) {
      setAuthModalTab('login');
      setAuthModalOpen(true);
    }
  }, [authError]);

  const openAuthModal = (tab: AuthTab, targetEmail = '') => {
    setAuthModalTab(tab);
    setAuthModalEmail(targetEmail);
    setAuthModalOpen(true);
  };

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
            <Flame size={16} /> Streak: {user ? user.currentStreak : 0}
          </span>
          <span className="pill">
            <Trophy size={16} /> {user ? user.rating : 1000} MMR
          </span>

          {isLoading ? (
            <span className="pill">Loading...</span>
          ) : user ? (
            <>
              <span className="pill user-pill" title={user.badgeTitle}>
                <User size={16} />
                <strong>{user.username}</strong>
              </span>
              <button
                type="button"
                className="nav-auth-btn secondary"
                onClick={() => void logout()}
              >
                <LogOut size={15} />
                Sign Out
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="nav-auth-btn secondary"
                onClick={() => openAuthModal('login')}
              >
                <LogIn size={15} />
                Sign In
              </button>
              <button
                type="button"
                className="nav-auth-btn primary"
                onClick={() => openAuthModal('register')}
              >
                <UserPlus size={15} />
                Register
              </button>
            </>
          )}
        </div>
      </header>

      {user && !user.isEmailVerified && (
        <div className="verify-email-banner" role="region" aria-label="Email verification notice">
          <div className="verify-email-banner-text">
            <AlertTriangle size={18} />
            <span>
              Your email address (<strong>{user.email}</strong>) is not verified
              yet. Verify your email to secure your account and unlock full
              recovery features.
            </span>
          </div>
          <button
            type="button"
            className="verify-email-banner-btn"
            onClick={() => openAuthModal('verify-email', user.email)}
          >
            <MailCheck size={15} />
            Verify Email
          </button>
        </div>
      )}

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

      <AuthModal
        isOpen={authModalOpen}
        initialTab={authModalTab}
        initialEmail={authModalEmail}
        onClose={() => setAuthModalOpen(false)}
      />
    </div>
  );
}

export default App;
