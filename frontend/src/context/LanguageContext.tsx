import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type AppLanguage = 'uk' | 'en' | 'ru';

export interface TranslationDictionary {
  brandTitle: string;
  navPlay: string;
  navProfile: string;
  navSettings: string;
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
  // Profile Page
  profileTitle: string;
  profileSubtitle: string;
  avatarUploadBtn: string;
  avatarUrlBtn: string;
  avatarUrlPlaceholder: string;
  avatarApplyBtn: string;
  avatarHint: string;
  nicknameLabel: string;
  nicknamePlaceholder: string;
  bioLabel: string;
  bioPlaceholder: string;
  saveChangesBtn: string;
  savingBtn: string;
  profileSavedToast: string;
  avatarSavedToast: string;
  statsSectionTitle: string;
  statRating: string;
  statMaxStreak: string;
  statCurrentStreak: string;
  statGamesPlayed: string;
  statWinRate: string;
  statWinsCount: string;
  favAnimeSectionTitle: string;
  favAnimeSectionSubtitle: string;
  addAnimeSlotBtn: string;
  favCharsSectionTitle: string;
  favCharsSectionSubtitle: string;
  addCharSlotBtn: string;
  removeSlotTitle: string;
  modalSearchAnimeTitle: string;
  modalSearchAnimePlaceholder: string;
  modalSearchCharTitle: string;
  modalSearchCharPlaceholder: string;
  modalCloseBtn: string;
  // Settings Page
  settingsTitle: string;
  settingsSubtitle: string;
  settingsLangSectionTitle: string;
  settingsLangSectionDesc: string;
  settingsThemeSectionTitle: string;
  settingsThemeSectionDesc: string;
  themeMidnightName: string;
  themeMidnightDesc: string;
  themeObsidianName: string;
  themeObsidianDesc: string;
  themeSakuraName: string;
  themeSakuraDesc: string;
  themeParchmentName: string;
  themeParchmentDesc: string;
  settingsPrivacySectionTitle: string;
  settingsPrivacySectionDesc: string;
  privacyPublicProfileLabel: string;
  privacyPublicProfileDesc: string;
  privacyShowStatsLabel: string;
  privacyShowStatsDesc: string;
  privacyShowFavoritesLabel: string;
  privacyShowFavoritesDesc: string;
  settingsSavedToast: string;
}

const TRANSLATIONS: Record<AppLanguage, TranslationDictionary> = {
  uk: {
    brandTitle: 'Anime Guesser',
    navPlay: 'Грати',
    navProfile: 'Профіль',
    navSettings: 'Налаштування',
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
    profileTitle: 'Профіль гравця',
    profileSubtitle: 'Налаштуйте аватар, нікнейм, біо та вітрину улюблених аніме й персонажів.',
    avatarUploadBtn: 'Завантажити файл',
    avatarUrlBtn: 'URL зображення',
    avatarUrlPlaceholder: 'Вставте пряме посилання https://...',
    avatarApplyBtn: 'Застосувати',
    avatarHint: 'JPG, PNG або WEBP до 3 МБ',
    nicknameLabel: 'Нікнейм (3–24 символи)',
    nicknamePlaceholder: 'Введіть унікальний нікнейм...',
    bioLabel: 'Про себе (Біо)',
    bioPlaceholder: 'Розкажіть про свої улюблені жанри чи тайтли (до 250 символів)...',
    saveChangesBtn: 'Зберегти зміни',
    savingBtn: 'Збереження...',
    profileSavedToast: 'Профіль успішно оновлено!',
    avatarSavedToast: 'Аватар успішно оновлено!',
    statsSectionTitle: 'Ігрова статистика',
    statRating: 'Рейтинг MMR',
    statMaxStreak: 'Макс. серія',
    statCurrentStreak: 'Поточна серія',
    statGamesPlayed: 'Зіграно ігор',
    statWinRate: 'Відсоток перемог',
    statWinsCount: 'перемог',
    favAnimeSectionTitle: 'Улюблені аніме',
    favAnimeSectionSubtitle: 'До 5 тайтлів на вашій персональній вітрині',
    addAnimeSlotBtn: 'Додати аніме',
    favCharsSectionTitle: 'Улюблені персонажі',
    favCharsSectionSubtitle: 'До 5 персонажів із портретами з AniList',
    addCharSlotBtn: 'Додати персонажа',
    removeSlotTitle: 'Видалити зі слота',
    modalSearchAnimeTitle: 'Оберіть улюблене аніме',
    modalSearchAnimePlaceholder: 'Пошук аніме українською, англійською або ромаджі...',
    modalSearchCharTitle: 'Оберіть улюбленого персонажа',
    modalSearchCharPlaceholder: 'Введіть ім’я персонажа (напр. Lelouch, Killua, Frieren)...',
    modalCloseBtn: 'Закрити',
    settingsTitle: 'Налаштування',
    settingsSubtitle: 'Мова інтерфейсу та ШІ-підказок, тема оформлення й приватність профілю.',
    settingsLangSectionTitle: 'Мова інтерфейсу та підказок ШІ',
    settingsLangSectionDesc: 'Визначає мову меню, пошуку та генерації 6 підказок у грі.',
    settingsThemeSectionTitle: 'Тема оформлення (Комфорт для очей)',
    settingsThemeSectionDesc: 'Усі теми розроблені без сліпучо-білого фону для тривалих ігрових сесій.',
    themeMidnightName: 'Midnight Indigo',
    themeMidnightDesc: 'Глибокий темно-синій індиго (за замовчуванням)',
    themeObsidianName: 'Obsidian Carbon',
    themeObsidianDesc: 'Стриманий нейтральний вугільно-темний',
    themeSakuraName: 'Sakura Dusk',
    themeSakuraDesc: 'Вечірній сливово-фіолетовий відтінок',
    themeParchmentName: 'Soft Warm Paper',
    themeParchmentDesc: 'Теплий бежевий папір (#E6E1D6) без відблисків із темним текстом',
    settingsPrivacySectionTitle: 'Приватність профілю',
    settingsPrivacySectionDesc: 'Керуйте тим, яку інформацію бачать інші гравці у вашому профілі.',
    privacyPublicProfileLabel: 'Публічний профіль',
    privacyPublicProfileDesc: 'Дозволити іншим гравцям переглядати вашу сторінку профілю',
    privacyShowStatsLabel: 'Показувати ігрову статистику',
    privacyShowStatsDesc: 'Відображати ваш рейтинг, серію, кількість ігор та відсоток перемог',
    privacyShowFavoritesLabel: 'Показувати улюблені аніме та персонажів',
    privacyShowFavoritesDesc: 'Відображати ваші вітрини улюблених тайтлів і персонажів',
    settingsSavedToast: 'Налаштування збережено!',
  },
  en: {
    brandTitle: 'Anime Guesser',
    navPlay: 'Play',
    navProfile: 'Profile',
    navSettings: 'Settings',
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
    profileTitle: 'Player Profile',
    profileSubtitle: 'Customize your avatar, nickname, bio, and favorite anime & character showcases.',
    avatarUploadBtn: 'Upload Image',
    avatarUrlBtn: 'Paste Image URL',
    avatarUrlPlaceholder: 'Paste direct image link https://...',
    avatarApplyBtn: 'Apply',
    avatarHint: 'JPG, PNG, or WEBP up to 3MB',
    nicknameLabel: 'Nickname (3–24 characters)',
    nicknamePlaceholder: 'Enter your unique nickname...',
    bioLabel: 'Bio',
    bioPlaceholder: 'Share your favorite anime genres, studios, or quotes (up to 250 chars)...',
    saveChangesBtn: 'Save Changes',
    savingBtn: 'Saving...',
    profileSavedToast: 'Profile updated successfully!',
    avatarSavedToast: 'Avatar updated successfully!',
    statsSectionTitle: 'Game Statistics',
    statRating: 'MMR Rating',
    statMaxStreak: 'Max Streak',
    statCurrentStreak: 'Current Streak',
    statGamesPlayed: 'Games Played',
    statWinRate: 'Win Rate (%)',
    statWinsCount: 'wins',
    favAnimeSectionTitle: 'Favorite Anime Showcase',
    favAnimeSectionSubtitle: 'Up to 5 titles featured on your profile card',
    addAnimeSlotBtn: 'Add Anime',
    favCharsSectionTitle: 'Favorite Characters Showcase',
    favCharsSectionSubtitle: 'Up to 5 characters with portraits from AniList',
    addCharSlotBtn: 'Add Character',
    removeSlotTitle: 'Remove from showcase',
    modalSearchAnimeTitle: 'Select Favorite Anime',
    modalSearchAnimePlaceholder: 'Search anime by English, Romaji, Ukrainian, or Russian title...',
    modalSearchCharTitle: 'Select Favorite Character',
    modalSearchCharPlaceholder: 'Search character name (e.g. Lelouch, Killua, Frieren)...',
    modalCloseBtn: 'Close',
    settingsTitle: 'Settings',
    settingsSubtitle: 'Configure your interface & AI clue language, low-glare theme, and privacy controls.',
    settingsLangSectionTitle: 'Interface & AI Clue Language',
    settingsLangSectionDesc: 'Controls the UI language as well as the language of AI-generated clues.',
    settingsThemeSectionTitle: 'Appearance & Background Theme',
    settingsThemeSectionDesc: 'Eye-comfortable low-glare presets with zero harsh pure-white backgrounds.',
    themeMidnightName: 'Midnight Indigo',
    themeMidnightDesc: 'Deep navy and indigo dark theme (Default)',
    themeObsidianName: 'Obsidian Carbon',
    themeObsidianDesc: 'Sleek neutral charcoal dark theme',
    themeSakuraName: 'Sakura Dusk',
    themeSakuraDesc: 'Deep plum and twilight violet dark theme',
    themeParchmentName: 'Soft Warm Paper',
    themeParchmentDesc: 'Low-glare warm parchment beige (#E6E1D6) with dark charcoal text',
    settingsPrivacySectionTitle: 'Privacy Controls',
    settingsPrivacySectionDesc: 'Choose what other players can see when viewing your profile.',
    privacyPublicProfileLabel: 'Public Profile',
    privacyPublicProfileDesc: 'Allow other players to view your profile page',
    privacyShowStatsLabel: 'Show Game Statistics',
    privacyShowStatsDesc: 'Display your MMR rating, streaks, games played, and win rate publicly',
    privacyShowFavoritesLabel: 'Show Favorite Anime & Characters',
    privacyShowFavoritesDesc: 'Display your favorite anime posters and character portraits publicly',
    settingsSavedToast: 'Settings saved!',
  },
  ru: {
    brandTitle: 'Anime Guesser',
    navPlay: 'Играть',
    navProfile: 'Профиль',
    navSettings: 'Настройки',
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
    profileTitle: 'Профиль игрока',
    profileSubtitle: 'Настройте аватар, никнейм, био и витрину любимых аниме и персонажей.',
    avatarUploadBtn: 'Загрузить файл',
    avatarUrlBtn: 'URL картинки',
    avatarUrlPlaceholder: 'Вставьте прямую ссылку https://...',
    avatarApplyBtn: 'Применить',
    avatarHint: 'JPG, PNG или WEBP до 3 МБ',
    nicknameLabel: 'Никнейм (3–24 символа)',
    nicknamePlaceholder: 'Введите уникальный никнейм...',
    bioLabel: 'О себе (Био)',
    bioPlaceholder: 'Расскажите о любимых жанрах или тайтлах (до 250 символов)...',
    saveChangesBtn: 'Сохранить изменения',
    savingBtn: 'Сохранение...',
    profileSavedToast: 'Профиль успешно обновлён!',
    avatarSavedToast: 'Аватар успешно обновлён!',
    statsSectionTitle: 'Игровая статистика',
    statRating: 'Рейтинг MMR',
    statMaxStreak: 'Макс. серия',
    statCurrentStreak: 'Текущая серия',
    statGamesPlayed: 'Сыграно игр',
    statWinRate: 'Процент побед',
    statWinsCount: 'побед',
    favAnimeSectionTitle: 'Любимые аниме',
    favAnimeSectionSubtitle: 'До 5 тайтлов на вашей персональной витрине',
    addAnimeSlotBtn: 'Добавить аниме',
    favCharsSectionTitle: 'Любимые персонажи',
    favCharsSectionSubtitle: 'До 5 персонажей с портретами из AniList',
    addCharSlotBtn: 'Добавить персонажа',
    removeSlotTitle: 'Удалить из слота',
    modalSearchAnimeTitle: 'Выберите любимое аниме',
    modalSearchAnimePlaceholder: 'Поиск аниме на русском, украинском, английском или ромадзи...',
    modalSearchCharTitle: 'Выберите любимого персонажа',
    modalSearchCharPlaceholder: 'Введите имя персонажа (напр. Lelouch, Killua, Frieren)...',
    modalCloseBtn: 'Закрыть',
    settingsTitle: 'Настройки',
    settingsSubtitle: 'Язык интерфейса и ИИ-подсказок, комфортная тема оформления и приватность.',
    settingsLangSectionTitle: 'Язык интерфейса и подсказок ИИ',
    settingsLangSectionDesc: 'Определяет язык меню, поиска и генерации 6 подсказок в игре.',
    settingsThemeSectionTitle: 'Тема оформления (Комфорт для глаз)',
    settingsThemeSectionDesc: 'Все темы созданы без слепяще-белого фона для долгих игровых сессий.',
    themeMidnightName: 'Midnight Indigo',
    themeMidnightDesc: 'Глубокий тёмно-синий индиго (по умолчанию)',
    themeObsidianName: 'Obsidian Carbon',
    themeObsidianDesc: 'Строгий нейтральный угольно-тёмный',
    themeSakuraName: 'Sakura Dusk',
    themeSakuraDesc: 'Вечерний сливово-фиолетовый оттенок',
    themeParchmentName: 'Soft Warm Paper',
    themeParchmentDesc: 'Тёплый бежевый пергамент (#E6E1D6) без бликов с тёмным текстом',
    settingsPrivacySectionTitle: 'Приватность профиля',
    settingsPrivacySectionDesc: 'Управляйте тем, какую информацию видят другие игроки в вашем профиле.',
    privacyPublicProfileLabel: 'Публичный профиль',
    privacyPublicProfileDesc: 'Разрешить другим игрокам просматривать вашу страницу профиля',
    privacyShowStatsLabel: 'Показывать игровую статистику',
    privacyShowStatsDesc: 'Отображать ваш рейтинг, серии, количество игр и процент побед',
    privacyShowFavoritesLabel: 'Показывать любимые аниме и персонажей',
    privacyShowFavoritesDesc: 'Отображать ваши витрины любимых тайтлов и персонажей',
    settingsSavedToast: 'Настройки сохранены!',
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
