import { useEffect, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Eye,
  Globe,
  Palette,
  Shield,
} from 'lucide-react';
import { AppTheme, useAuth } from '../context/AuthContext';
import { AppLanguage, useLanguage } from '../context/LanguageContext';

const LANGUAGE_CHOICES: Array<{
  code: AppLanguage;
  badge: string;
  title: string;
  native: string;
}> = [
  {
    code: 'uk',
    badge: 'UA',
    title: 'Українська (UA)',
    native: 'Інтерфейс та ШІ-підказки українською',
  },
  {
    code: 'en',
    badge: 'EN',
    title: 'English (EN)',
    native: 'Interface & AI clues in English',
  },
  {
    code: 'ru',
    badge: 'RU',
    title: 'Русский (RU)',
    native: 'Интерфейс и ИИ-подсказки на русском',
  },
];

export function SettingsPage() {
  const { user, theme, setTheme, updateProfile } = useAuth();
  const { lang, setLang, t } = useLanguage();

  const [isPublicProfile, setIsPublicProfile] = useState(
    user?.isPublicProfile ?? true,
  );
  const [showStats, setShowStats] = useState(user?.showStats ?? true);
  const [showFavorites, setShowFavorites] = useState(
    user?.showFavorites ?? true,
  );
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (user) {
      setIsPublicProfile(user.isPublicProfile);
      setShowStats(user.showStats);
      setShowFavorites(user.showFavorites);
    }
  }, [user]);

  const triggerToast = (msg: string) => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToastMessage(msg);
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const handleLanguageSelect = (code: AppLanguage) => {
    setLang(code);
    if (user) {
      void updateProfile({ lang: code }).catch(() => undefined);
    }
    triggerToast(t.settingsSavedToast);
  };

  const handleThemeSelect = async (nextTheme: AppTheme) => {
    await setTheme(nextTheme, true);
    triggerToast(t.settingsSavedToast);
  };

  const handlePrivacyToggle = async (
    field: 'isPublicProfile' | 'showStats' | 'showFavorites',
    nextValue: boolean,
  ) => {
    if (field === 'isPublicProfile') setIsPublicProfile(nextValue);
    if (field === 'showStats') setShowStats(nextValue);
    if (field === 'showFavorites') setShowFavorites(nextValue);

    if (user) {
      try {
        await updateProfile({ [field]: nextValue });
        triggerToast(t.settingsSavedToast);
      } catch {
        // Revert local state on error
        if (field === 'isPublicProfile')
          setIsPublicProfile(user.isPublicProfile);
        if (field === 'showStats') setShowStats(user.showStats);
        if (field === 'showFavorites') setShowFavorites(user.showFavorites);
      }
    }
  };

  const themePresets: Array<{
    id: AppTheme;
    name: string;
    desc: string;
    bgPreview: string;
    surfacePreview: string;
    accentPreview: string;
    textPreview: string;
  }> = [
    {
      id: 'midnight',
      name: t.themeMidnightName,
      desc: t.themeMidnightDesc,
      bgPreview: '#0b0f19',
      surfacePreview: '#111827',
      accentPreview: '#a855f7',
      textPreview: '#f3f4f6',
    },
    {
      id: 'obsidian',
      name: t.themeObsidianName,
      desc: t.themeObsidianDesc,
      bgPreview: '#121316',
      surfacePreview: '#1a1c20',
      accentPreview: '#8b5cf6',
      textPreview: '#eceef2',
    },
    {
      id: 'sakura-dusk',
      name: t.themeSakuraName,
      desc: t.themeSakuraDesc,
      bgPreview: '#160f1d',
      surfacePreview: '#21172b',
      accentPreview: '#d946ef',
      textPreview: '#f5eefc',
    },
    {
      id: 'warm-parchment',
      name: t.themeParchmentName,
      desc: t.themeParchmentDesc,
      bgPreview: '#E6E1D6',
      surfacePreview: '#DDD7C9',
      accentPreview: '#6d28d9',
      textPreview: '#1f2421',
    },
  ];

  return (
    <div className="settings-page">
      {toastMessage && (
        <div
          className="toast-notification success"
          role="status"
          aria-live="polite"
        >
          <CheckCircle2 size={18} />
          <span>{toastMessage}</span>
        </div>
      )}

      <div className="settings-page-header">
        <h2>{t.settingsTitle}</h2>
        <p>{t.settingsSubtitle}</p>
      </div>

      {/* 1. Language Selector */}
      <section className="profile-section-card">
        <div className="profile-section-header">
          <div>
            <h3>
              <Globe size={19} /> {t.settingsLangSectionTitle}
            </h3>
            <p className="section-subcaption">{t.settingsLangSectionDesc}</p>
          </div>
        </div>

        <div className="settings-lang-grid">
          {LANGUAGE_CHOICES.map((option) => {
            const isSelected = lang === option.code;
            return (
              <button
                key={option.code}
                type="button"
                className={`settings-choice-card ${isSelected ? 'active' : ''}`}
                onClick={() => handleLanguageSelect(option.code)}
                aria-pressed={isSelected}
              >
                <div className="settings-choice-top">
                  <span className="lang-code-pill">{option.badge}</span>
                  {isSelected && (
                    <span className="choice-active-check">
                      <Check size={15} />
                    </span>
                  )}
                </div>
                <strong className="settings-choice-title">
                  {option.title}
                </strong>
                <span className="settings-choice-desc">{option.native}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 2. Appearance / Background Theme */}
      <section className="profile-section-card">
        <div className="profile-section-header">
          <div>
            <h3>
              <Palette size={19} /> {t.settingsThemeSectionTitle}
            </h3>
            <p className="section-subcaption">{t.settingsThemeSectionDesc}</p>
          </div>
        </div>

        <div className="settings-theme-grid">
          {themePresets.map((preset) => {
            const isSelected = theme === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                className={`theme-preset-card ${isSelected ? 'active' : ''}`}
                onClick={() => void handleThemeSelect(preset.id)}
                aria-pressed={isSelected}
              >
                <div
                  className="theme-swatch-preview"
                  style={{
                    background: preset.bgPreview,
                    borderColor: preset.accentPreview,
                  }}
                >
                  <div
                    className="theme-swatch-surface"
                    style={{
                      background: preset.surfacePreview,
                      color: preset.textPreview,
                    }}
                  >
                    <span
                      className="theme-swatch-dot"
                      style={{ background: preset.accentPreview }}
                    />
                    <span className="theme-swatch-lines">Aa</span>
                  </div>
                </div>
                <div className="theme-preset-info">
                  <div className="theme-preset-title-row">
                    <strong>{preset.name}</strong>
                    {isSelected && (
                      <span className="choice-active-check">
                        <Check size={14} />
                      </span>
                    )}
                  </div>
                  <p>{preset.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* 3. Privacy Controls */}
      <section className="profile-section-card">
        <div className="profile-section-header">
          <div>
            <h3>
              <Shield size={19} /> {t.settingsPrivacySectionTitle}
            </h3>
            <p className="section-subcaption">
              {t.settingsPrivacySectionDesc}
            </p>
          </div>
        </div>

        <div className="privacy-toggles-list">
          <label className="privacy-toggle-row">
            <div className="privacy-toggle-info">
              <div className="privacy-toggle-title">
                <Eye size={16} />
                <strong>{t.privacyPublicProfileLabel}</strong>
              </div>
              <p>{t.privacyPublicProfileDesc}</p>
            </div>
            <input
              type="checkbox"
              className="sr-only-checkbox"
              checked={isPublicProfile}
              disabled={!user}
              onChange={(e) =>
                void handlePrivacyToggle('isPublicProfile', e.target.checked)
              }
            />
            <span
              className={`toggle-switch ${isPublicProfile ? 'on' : 'off'}`}
              aria-hidden="true"
            >
              <span className="toggle-knob" />
            </span>
          </label>

          <label className="privacy-toggle-row">
            <div className="privacy-toggle-info">
              <div className="privacy-toggle-title">
                <strong>{t.privacyShowStatsLabel}</strong>
              </div>
              <p>{t.privacyShowStatsDesc}</p>
            </div>
            <input
              type="checkbox"
              className="sr-only-checkbox"
              checked={showStats}
              disabled={!user}
              onChange={(e) =>
                void handlePrivacyToggle('showStats', e.target.checked)
              }
            />
            <span
              className={`toggle-switch ${showStats ? 'on' : 'off'}`}
              aria-hidden="true"
            >
              <span className="toggle-knob" />
            </span>
          </label>

          <label className="privacy-toggle-row">
            <div className="privacy-toggle-info">
              <div className="privacy-toggle-title">
                <strong>{t.privacyShowFavoritesLabel}</strong>
              </div>
              <p>{t.privacyShowFavoritesDesc}</p>
            </div>
            <input
              type="checkbox"
              className="sr-only-checkbox"
              checked={showFavorites}
              disabled={!user}
              onChange={(e) =>
                void handlePrivacyToggle('showFavorites', e.target.checked)
              }
            />
            <span
              className={`toggle-switch ${showFavorites ? 'on' : 'off'}`}
              aria-hidden="true"
            >
              <span className="toggle-knob" />
            </span>
          </label>
        </div>
      </section>
    </div>
  );
}
