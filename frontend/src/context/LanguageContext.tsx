import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type AppLanguage = 'uk' | 'en' | 'ru';

export interface TranslationDictionary {
  brandTitle: string;
  streakLabel: string;
  bestStreakLabel: string;
  ratingLabel: string;
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
  clueStepLabel: string;
  generatingClues: string;
  startRoundBtn: string;
  guessBtn: string;
  skipBtn: string;
  giveUpBtn: string;
  wrongGuessesTitle: string;
  wonTitle: string;
  lostTitle: string;
  earnedPointsLabel: string;
  allCluesTitle: string;
  remainingCluesTitle: string;
  nextAnimeBtn: string;
  authPromptTitle: string;
  authPromptDesc: string;
}

const TRANSLATIONS: Record<AppLanguage, TranslationDictionary> = {
  uk: {
    brandTitle: 'Anime Guesser',
    streakLabel: 'Серія',
    bestStreakLabel: 'Рекорд',
    ratingLabel: 'Рейтинг',
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
    clueStepLabel: 'Підказка',
    generatingClues: 'ШІ генерує 6 свіжих підказок для нового раунду...',
    startRoundBtn: 'Почати раунд',
    guessBtn: 'Вгадати',
    skipBtn: 'Наступна підказка (Пропустити)',
    giveUpBtn: 'Здатися',
    wrongGuessesTitle: 'Попередні спроби у цьому раунді:',
    wonTitle: 'Перемога! Ви вгадали аніме!',
    lostTitle: 'Раунд програно — серію скинуто',
    earnedPointsLabel: 'Нараховано очок',
    allCluesTitle: 'Усі 6 підказок цього раунду',
    remainingCluesTitle: 'Нерозкриті підказки',
    nextAnimeBtn: 'Наступне аніме',
    authPromptTitle: 'Увійдіть, щоб почати гру',
    authPromptDesc:
      'Соло-режим зберігає вашу поточну серію (Streak), рекорд та MMR-рейтинг у Redis і PostgreSQL.',
  },
  en: {
    brandTitle: 'Anime Guesser',
    streakLabel: 'Streak',
    bestStreakLabel: 'Best Streak',
    ratingLabel: 'Rating',
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
    clueStepLabel: 'Clue',
    generatingClues: 'AI is generating 6 fresh clues for this round...',
    startRoundBtn: 'Start Round',
    guessBtn: 'Guess',
    skipBtn: 'Next Clue (Skip)',
    giveUpBtn: 'Give Up',
    wrongGuessesTitle: 'Previous wrong guesses in this round:',
    wonTitle: 'Victory! You guessed the anime!',
    lostTitle: 'Round Lost — Streak Reset',
    earnedPointsLabel: 'Earned Points',
    allCluesTitle: 'All 6 Clues for this Anime',
    remainingCluesTitle: 'Remaining Unrevealed Clues',
    nextAnimeBtn: 'Next Anime',
    authPromptTitle: 'Sign in to start playing',
    authPromptDesc:
      'Solo mode tracks your active session in Redis and persists your Streak, Best Streak, and Rating in PostgreSQL.',
  },
  ru: {
    brandTitle: 'Anime Guesser',
    streakLabel: 'Серия',
    bestStreakLabel: 'Рекорд',
    ratingLabel: 'Рейтинг',
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
    clueStepLabel: 'Подсказка',
    generatingClues: 'ИИ генерирует 6 свежих подсказок для нового раунда...',
    startRoundBtn: 'Начать раунд',
    guessBtn: 'Угадать',
    skipBtn: 'Следующая подсказка (Пропустить)',
    giveUpBtn: 'Сдаться',
    wrongGuessesTitle: 'Предыдущие попытки в этом раунде:',
    wonTitle: 'Победа! Вы угадали аниме!',
    lostTitle: 'Раунд проигран — серия сброшена',
    earnedPointsLabel: 'Получено очков',
    allCluesTitle: 'Все 6 подсказок этого раунда',
    remainingCluesTitle: 'Нераскрытые подсказки',
    nextAnimeBtn: 'Следующее аниме',
    authPromptTitle: 'Войдите, чтобы начать игру',
    authPromptDesc:
      'Соло-режим сохраняет вашу текущую серию (Streak), рекорд и MMR-рейтинг в Redis и PostgreSQL.',
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
