import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type AppLanguage = 'uk' | 'en' | 'ru';

export interface TranslationDictionary {
  brandTitle: string;
  streakLabel: string;
  loading: string;
  signIn: string;
  register: string;
  signOut: string;
  verifyBannerPrefix: string;
  verifyBannerSuffix: string;
  verifyEmailBtn: string;
  modeAiClues: string;
  modeFrameGuess: string;
  modeEndlessStreak: string;
  progressiveCluesTitle: string;
  cluePlaceholderStep1: string;
  searchLabel: string;
  searchPlaceholder: string;
  searching: string;
  noResults: string;
  selectedAnimeLabel: string;
  keyboardHint: string;
}

const TRANSLATIONS: Record<AppLanguage, TranslationDictionary> = {
  uk: {
    brandTitle: 'Anime Guesser',
    streakLabel: 'Серія',
    loading: 'Завантаження...',
    signIn: 'Увійти',
    register: 'Реєстрація',
    signOut: 'Вийти',
    verifyBannerPrefix: 'Ваша електронна адреса (',
    verifyBannerSuffix:
      ') ще не підтверджена. Підтвердьте пошту для захисту акаунта та відновлення пароля.',
    verifyEmailBtn: 'Підтвердити пошту',
    modeAiClues: 'ШІ Підказки',
    modeFrameGuess: 'Вгадай за кадром',
    modeEndlessStreak: 'Нескінченна серія',
    progressiveCluesTitle: 'Прогресивні підказки',
    cluePlaceholderStep1:
      'Крок 1: Живі підказки від ШІ (персонажі, лор, меми фандому) генеруються обраною мовою інтерфейсу.',
    searchLabel: 'Багатомовний пошук аніме (UA / EN / Romaji / JA / RU)',
    searchPlaceholder: 'Введіть назву аніме будь-якою мовою (мін. 2 символи)...',
    searching: 'Пошук...',
    noResults: 'Збігів не знайдено',
    selectedAnimeLabel: 'Обрано відповідь:',
    keyboardHint: '↑↓ навігація • Enter обрати • Esc закрити',
  },
  en: {
    brandTitle: 'Anime Guesser',
    streakLabel: 'Streak',
    loading: 'Loading...',
    signIn: 'Sign In',
    register: 'Register',
    signOut: 'Sign Out',
    verifyBannerPrefix: 'Your email address (',
    verifyBannerSuffix:
      ') is not verified yet. Verify your email to secure your account and unlock full recovery features.',
    verifyEmailBtn: 'Verify Email',
    modeAiClues: 'AI Clues',
    modeFrameGuess: 'Frame Guess',
    modeEndlessStreak: 'Endless Streak',
    progressiveCluesTitle: 'Progressive Clues',
    cluePlaceholderStep1:
      'Step 1: On-the-fly AI clues (characters, lore, Fandom trivia & memes) appear in your selected language.',
    searchLabel: 'Multilingual Search (EN / Romaji / JA / UK / RU)',
    searchPlaceholder: 'Type anime title in any supported language (min 2 chars)...',
    searching: 'Searching...',
    noResults: 'No matching anime found',
    selectedAnimeLabel: 'Selected guess:',
    keyboardHint: '↑↓ navigate • Enter select • Esc close',
  },
  ru: {
    brandTitle: 'Anime Guesser',
    streakLabel: 'Серия',
    loading: 'Загрузка...',
    signIn: 'Войти',
    register: 'Регистрация',
    signOut: 'Выйти',
    verifyBannerPrefix: 'Ваш email (',
    verifyBannerSuffix:
      ') ещё не подтверждён. Подтвердите почту для защиты аккаунта и восстановления доступа.',
    verifyEmailBtn: 'Подтвердить почту',
    modeAiClues: 'ИИ Подсказки',
    modeFrameGuess: 'Угадай по кадру',
    modeEndlessStreak: 'Бесконечная серия',
    progressiveCluesTitle: 'Прогрессивные подсказки',
    cluePlaceholderStep1:
      'Шаг 1: Живые подсказки от ИИ (персонажи, лор, мемы фандома) генерируются на выбранном языке интерфейса.',
    searchLabel: 'Многоязычный поиск аниме (RU / UA / EN / Romaji / JA)',
    searchPlaceholder: 'Введите название аниме на любом языке (мин. 2 символа)...',
    searching: 'Поиск...',
    noResults: 'Совпадений не найдено',
    selectedAnimeLabel: 'Выбранный ответ:',
    keyboardHint: '↑↓ навигация • Enter выбрать • Esc закрыть',
  },
};

const STORAGE_KEY = 'anime_guesser_lang';

interface LanguageContextValue {
  lang: AppLanguage;
  setLang: (next: AppLanguage) => void;
  t: TranslationDictionary;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

function getInitialLanguage(): AppLanguage {
  if (typeof window === 'undefined') {
    return 'en';
  }
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === 'uk' || saved === 'en' || saved === 'ru') {
    return saved;
  }
  const browserLang = window.navigator.language.toLowerCase();
  if (browserLang.startsWith('uk')) return 'uk';
  if (browserLang.startsWith('ru')) return 'ru';
  return 'en';
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<AppLanguage>(getInitialLanguage);

  const setLang = (next: AppLanguage) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore storage quota errors
    }
  };

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      lang,
      setLang,
      t: TRANSLATIONS[lang],
    }),
    [lang],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return ctx;
}
