import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Flame,
  Globe,
  Image,
  LogIn,
  LogOut,
  MailCheck,
  Sparkles,
  Trophy,
  User,
  UserPlus,
} from 'lucide-react';
import {
  AnimeAutocompleteInput,
  AnimeSearchResultItem,
} from './components/AnimeAutocompleteInput';
import { AuthModal, AuthTab } from './components/AuthModal';
import { useAuth } from './context/AuthContext';
import { AppLanguage, useLanguage } from './context/LanguageContext';

type GameMode = 'CLUES' | 'SCREENSHOT' | 'ENDLESS';

const LANGUAGE_OPTIONS: Array<{ code: AppLanguage; label: string }> = [
  { code: 'uk', label: 'UA' },
  { code: 'en', label: 'EN' },
  { code: 'ru', label: 'RU' },
];

export function App() {
  const { user, isLoading, authError, logout } = useAuth();
  const { lang, setLang, t } = useLanguage();
  const [mode, setMode] = useState<GameMode>('CLUES');
  const [selectedAnime, setSelectedAnime] =
    useState<AnimeSearchResultItem | null>(null);
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

  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="brand">
          <Sparkles size={22} />
          <span>{t.brandTitle}</span>
        </div>
        <div className="nav-stats">
          <div
            className="lang-switcher"
            role="group"
            aria-label="Interface and AI Clue Language"
          >
            <Globe size={14} className="lang-switcher-icon" />
            {LANGUAGE_OPTIONS.map((opt) => (
              <button
                key={opt.code}
                type="button"
                className={`lang-btn ${lang === opt.code ? 'active' : ''}`}
                onClick={() => setLang(opt.code)}
                aria-pressed={lang === opt.code}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <span className="pill">
            <Flame size={16} /> {t.streakLabel}: {user ? user.currentStreak : 0}
          </span>
          <span className="pill">
            <Trophy size={16} /> {user ? user.rating : 1000} MMR
          </span>

          {isLoading ? (
            <span className="pill">{t.loading}</span>
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
                {t.signOut}
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
                {t.signIn}
              </button>
              <button
                type="button"
                className="nav-auth-btn primary"
                onClick={() => openAuthModal('register')}
              >
                <UserPlus size={15} />
                {t.register}
              </button>
            </>
          )}
        </div>
      </header>

      {user && !user.isEmailVerified && (
        <div
          className="verify-email-banner"
          role="region"
          aria-label="Email verification notice"
        >
          <div className="verify-email-banner-text">
            <AlertTriangle size={18} />
            <span>
              {t.verifyBannerPrefix}
              <strong>{user.email}</strong>
              {t.verifyBannerSuffix}
            </span>
          </div>
          <button
            type="button"
            className="verify-email-banner-btn"
            onClick={() => openAuthModal('verify-email', user.email)}
          >
            <MailCheck size={15} />
            {t.verifyEmailBtn}
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
            <Sparkles size={16} /> {t.modeAiClues}
          </button>
          <button
            type="button"
            className={mode === 'SCREENSHOT' ? 'active' : ''}
            onClick={() => setMode('SCREENSHOT')}
          >
            <Image size={16} /> {t.modeFrameGuess}
          </button>
          <button
            type="button"
            className={mode === 'ENDLESS' ? 'active' : ''}
            onClick={() => setMode('ENDLESS')}
          >
            <Flame size={16} /> {t.modeEndlessStreak}
          </button>
        </section>

        <section className="deduction-grid">
          <div className="clue-panel">
            <h2>
              {t.progressiveCluesTitle} ({mode})
            </h2>
            <p className="clue-item">{t.cluePlaceholderStep1}</p>
          </div>

          <div className="search-panel">
            <label htmlFor="anime-search" className="search-label">
              {t.searchLabel}
            </label>
            <AnimeAutocompleteInput
              onSelect={(anime) => setSelectedAnime(anime)}
            />
            {selectedAnime && (
              <div className="selected-anime-preview">
                <img
                  src={selectedAnime.coverUrl}
                  alt={selectedAnime.titleEn ?? selectedAnime.titleRomaji}
                  className="selected-anime-cover"
                />
                <div className="selected-anime-info">
                  <span className="selected-anime-caption">
                    {t.selectedAnimeLabel}
                  </span>
                  <strong>
                    {(lang === 'uk' && selectedAnime.titleUk) ||
                      (lang === 'ru' && selectedAnime.titleRu) ||
                      selectedAnime.titleEn ||
                      selectedAnime.titleRomaji}
                  </strong>
                  <span className="selected-anime-sub">
                    {selectedAnime.titleRomaji}
                  </span>
                </div>
              </div>
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
