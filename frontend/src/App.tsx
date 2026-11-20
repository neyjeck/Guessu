import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Award,
  Flame,
  Gamepad2,
  LogIn,
  LogOut,
  MailCheck,
  Settings,
  Sparkles,
  Trophy,
  User,
  UserPlus,
} from 'lucide-react';
import { AuthModal, AuthTab } from './components/AuthModal';
import { useAuth } from './context/AuthContext';
import { useLanguage } from './context/LanguageContext';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsPage } from './pages/SettingsPage';
import { SoloGameTest, UserGameStats } from './pages/SoloGameTest';

export type NavSection = 'play' | 'profile' | 'settings';

export function App() {
  const { user, isLoading, authError, logout } = useAuth();
  const { t } = useLanguage();
  const [activeSection, setActiveSection] = useState<NavSection>('play');
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
  const displayName = user?.nickname ?? user?.username ?? '';

  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="top-nav-left">
          <button
            type="button"
            className="brand-btn"
            onClick={() => setActiveSection('play')}
          >
            <Sparkles size={22} />
            <span>{t.brandTitle}</span>
          </button>

          <nav className="main-nav-tabs" aria-label="Main navigation">
            <button
              type="button"
              className={`nav-tab-btn ${activeSection === 'play' ? 'active' : ''}`}
              onClick={() => setActiveSection('play')}
            >
              <Gamepad2 size={16} />
              <span>{t.navPlay}</span>
            </button>
            <button
              type="button"
              className={`nav-tab-btn ${activeSection === 'profile' ? 'active' : ''}`}
              onClick={() => setActiveSection('profile')}
            >
              <User size={16} />
              <span>{t.navProfile}</span>
            </button>
            <button
              type="button"
              className={`nav-tab-btn ${activeSection === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveSection('settings')}
            >
              <Settings size={16} />
              <span>{t.navSettings}</span>
            </button>
          </nav>
        </div>

        <div className="nav-stats">
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
              <button
                type="button"
                className="pill user-pill clickable"
                title={user.badgeTitle}
                onClick={() => setActiveSection('profile')}
              >
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={displayName}
                    className="nav-user-avatar"
                  />
                ) : (
                  <User size={16} />
                )}
                <strong>{displayName}</strong>
              </button>
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
        {/* Settings is accessible to everyone */}
        {activeSection === 'settings' && <SettingsPage />}

        {/* Profile View */}
        {activeSection === 'profile' &&
          (user ? (
            <ProfilePage />
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
          ))}

        {/* Play View: kept mounted when logged in so switching tabs preserves the active round */}
        {user ? (
          <div
            style={{
              display: activeSection === 'play' ? 'block' : 'none',
            }}
          >
            <SoloGameTest onStatsUpdate={(stats) => setLiveStats(stats)} />
          </div>
        ) : (
          activeSection === 'play' && (
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
          )
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
