import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Award,
  Flame,
  Globe,
  LogIn,
  LogOut,
  MailCheck,
  Sparkles,
  Trophy,
  User,
  UserPlus,
} from 'lucide-react';
import { AuthModal, AuthTab } from './components/AuthModal';
import { useAuth } from './context/AuthContext';
import { AppLanguage, useLanguage } from './context/LanguageContext';
import { SoloGameTest, UserGameStats } from './pages/SoloGameTest';

const LANGUAGE_OPTIONS: Array<{ code: AppLanguage; label: string }> = [
  { code: 'uk', label: 'UA' },
  { code: 'en', label: 'EN' },
  { code: 'ru', label: 'RU' },
];

export function App() {
  const { user, isLoading, authError, logout } = useAuth();
  const { lang, setLang, t } = useLanguage();
  const [liveStats, setLiveStats] = useState<UserGameStats | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState<AuthTab>('login');
  const [authModalEmail, setAuthModalEmail] = useState<string>('');

  useEffect(() => {
    if (user) {
      setLiveStats({
        currentStreak: user.currentStreak,
        maxStreak: user.maxStreak,
        rating: user.rating,
      });
    } else {
      setLiveStats(null);
    }
  }, [user]);

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

  const displayStreak = liveStats?.currentStreak ?? user?.currentStreak ?? 0;
  const displayMaxStreak = liveStats?.maxStreak ?? user?.maxStreak ?? 0;
  const displayRating = liveStats?.rating ?? user?.rating ?? 1000;

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
            <Flame size={16} /> {t.streakLabel}: <strong>{displayStreak}</strong>
          </span>
          <span className="pill">
            <Award size={16} /> {t.bestStreakLabel}:{' '}
            <strong>{displayMaxStreak}</strong>
          </span>
          <span className="pill">
            <Trophy size={16} /> {t.ratingLabel}:{' '}
            <strong>{displayRating}</strong>
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
        {user ? (
          <SoloGameTest onStatsUpdate={(stats) => setLiveStats(stats)} />
        ) : (
          <div className="guest-auth-card">
            <Sparkles size={32} className="guest-auth-icon" />
            <h2>{t.authPromptTitle}</h2>
            <p>{t.authPromptDesc}</p>
            <div className="guest-auth-actions">
              <button
                type="button"
                className="nav-auth-btn primary"
                onClick={() => openAuthModal('login')}
              >
                <LogIn size={16} />
                {t.signIn}
              </button>
              <button
                type="button"
                className="nav-auth-btn secondary"
                onClick={() => openAuthModal('register')}
              >
                <UserPlus size={16} />
                {t.register}
              </button>
            </div>
          </div>
        )}
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
