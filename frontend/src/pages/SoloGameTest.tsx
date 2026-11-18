import { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  Award,
  CheckCircle2,
  Flag,
  HelpCircle,
  Loader2,
  Play,
  SkipForward,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { apiClient } from '../api/client';
import {
  AnimeAutocompleteInput,
  AnimeSearchResultItem,
} from '../components/AnimeAutocompleteInput';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

export type ClueDifficulty = 'HARD' | 'MEDIUM' | 'EASY';
export type RoundStatus = 'IN_PROGRESS' | 'WON' | 'LOST';

export interface GameClueItem {
  step: number;
  difficulty: ClueDifficulty;
  text: string;
}

export interface GameGuessEntry {
  animeId: string;
  title: string;
  isCorrect: boolean;
}

export interface UserGameStats {
  currentStreak: number;
  maxStreak: number;
  rating: number;
}

export interface RevealedAnimeAnswer {
  id: string;
  anilistId: number;
  titleEn: string | null;
  titleRomaji: string;
  titleJa: string | null;
  titleUk: string | null;
  titleRu: string | null;
  synonyms: string[];
  coverUrl: string;
}

export interface SoloGameResponse {
  status: RoundStatus;
  unlockedStep: number;
  maxSteps: number;
  unlockedClues: GameClueItem[];
  allClues?: GameClueItem[];
  guesses: GameGuessEntry[];
  earnedPoints?: number;
  userStats: UserGameStats;
  answer: RevealedAnimeAnswer | null;
}

interface SoloGameTestProps {
  onStatsUpdate?: (stats: UserGameStats) => void;
}

export function SoloGameTest({ onStatsUpdate }: SoloGameTestProps) {
  const { refreshProfile } = useAuth();
  const { lang, t } = useLanguage();

  const [gameState, setGameState] = useState<SoloGameResponse | null>(null);
  const [selectedAnime, setSelectedAnime] =
    useState<AnimeSearchResultItem | null>(null);
  const [autocompleteKey, setAutocompleteKey] = useState(0);
  const [isStarting, setIsStarting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const syncUserStats = useCallback(
    (data: SoloGameResponse) => {
      onStatsUpdate?.(data.userStats);
      if (data.status === 'WON' || data.status === 'LOST') {
        void refreshProfile();
      }
    },
    [onStatsUpdate, refreshProfile],
  );

  const handleStartRound = useCallback(async () => {
    setIsStarting(true);
    setErrorMessage(null);
    setSelectedAnime(null);
    setAutocompleteKey((prev) => prev + 1);

    try {
      const response = await apiClient.post<SoloGameResponse>('/game/start', {
        lang,
      });
      setGameState(response.data);
      syncUserStats(response.data);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'Failed to start round. Please try again.';
      setErrorMessage(Array.isArray(msg) ? msg.join(', ') : String(msg));
    } finally {
      setIsStarting(false);
    }
  }, [lang, syncUserStats]);

  // Automatically start the first round on mount
  useEffect(() => {
    void handleStartRound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGuessSubmit = async () => {
    if (!selectedAnime || isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await apiClient.post<SoloGameResponse>('/game/guess', {
        animeId: String(selectedAnime.id),
      });
      setGameState(response.data);
      setSelectedAnime(null);
      setAutocompleteKey((prev) => prev + 1);
      syncUserStats(response.data);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'Failed to submit guess.';
      setErrorMessage(Array.isArray(msg) ? msg.join(', ') : String(msg));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkipClue = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await apiClient.post<SoloGameResponse>('/game/guess', {
        skip: true,
      });
      setGameState(response.data);
      syncUserStats(response.data);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'Failed to unlock next clue.';
      setErrorMessage(Array.isArray(msg) ? msg.join(', ') : String(msg));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGiveUp = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await apiClient.post<SoloGameResponse>('/game/give-up');
      setGameState(response.data);
      setSelectedAnime(null);
      syncUserStats(response.data);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'Failed to end round.';
      setErrorMessage(Array.isArray(msg) ? msg.join(', ') : String(msg));
    } finally {
      setIsSubmitting(false);
    }
  };

  const wrongGuesses = (gameState?.guesses ?? []).filter((g) => !g.isCorrect);
  const remainingUnrevealedClues =
    gameState && gameState.allClues
      ? gameState.allClues.filter((c) => c.step > gameState.unlockedStep)
      : [];

  return (
    <div className="solo-test-bench">
      {errorMessage && (
        <div className="auth-error-banner" role="alert">
          <span>{errorMessage}</span>
        </div>
      )}

      {isStarting ? (
        <div className="clue-loading-card">
          <Loader2 size={28} className="spin-icon" />
          <p>{t.generatingClues}</p>
        </div>
      ) : !gameState ? (
        <div className="clue-loading-card">
          <button
            type="button"
            className="auth-submit-btn"
            onClick={() => void handleStartRound()}
          >
            <Play size={16} /> {t.startRoundBtn}
          </button>
        </div>
      ) : (
        <div className="deduction-grid">
          {/* Left Panel: Progressive Unlocked Clues */}
          <div className="clue-panel">
            <div className="clue-panel-header">
              <h2>
                <Sparkles size={18} /> {t.progressiveCluesTitle}
              </h2>
              <span className="step-counter-pill">
                {t.clueStepLabel} {gameState.unlockedStep}/{gameState.maxSteps}
              </span>
            </div>

            <div className="clues-cards-list">
              {gameState.unlockedClues.map((clue) => (
                <div key={clue.step} className="clue-card">
                  <div className="clue-card-header">
                    <span className="clue-step-tag">
                      {t.clueStepLabel} {clue.step}/{gameState.maxSteps}
                    </span>
                    <span
                      className={`difficulty-badge difficulty-${clue.difficulty.toLowerCase()}`}
                    >
                      {clue.difficulty}
                    </span>
                  </div>
                  <p className="clue-card-text">{clue.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Right Panel: Active Guess Controls OR Round Result Card */}
          <div className="search-panel">
            {gameState.status === 'IN_PROGRESS' ? (
              <div className="guess-controls-stack">
                <div>
                  <label htmlFor="anime-search" className="search-label">
                    {t.searchLabel}
                  </label>
                  <AnimeAutocompleteInput
                    key={autocompleteKey}
                    disabled={isSubmitting}
                    onSelect={(anime) => setSelectedAnime(anime)}
                  />
                </div>

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

                <div className="game-action-buttons">
                  <button
                    type="button"
                    className="game-btn primary"
                    disabled={!selectedAnime || isSubmitting}
                    onClick={() => void handleGuessSubmit()}
                  >
                    <HelpCircle size={16} />
                    {t.guessBtn}
                  </button>

                  <button
                    type="button"
                    className="game-btn secondary"
                    disabled={isSubmitting}
                    onClick={() => void handleSkipClue()}
                  >
                    <SkipForward size={16} />
                    {t.skipBtn}
                  </button>

                  <button
                    type="button"
                    className="game-btn danger"
                    disabled={isSubmitting}
                    onClick={() => void handleGiveUp()}
                  >
                    <Flag size={15} />
                    {t.giveUpBtn}
                  </button>
                </div>

                {wrongGuesses.length > 0 && (
                  <div className="wrong-guesses-box">
                    <h4>{t.wrongGuessesTitle}</h4>
                    <ul className="wrong-guesses-list">
                      {wrongGuesses.map((g, idx) => (
                        <li key={`${g.animeId}-${idx}`}>
                          <XCircle size={14} className="wrong-guess-icon" />
                          <span>{g.title}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              /* Round Result Card (WON or LOST) */
              <div
                className={`round-result-card ${
                  gameState.status === 'WON' ? 'result-won' : 'result-lost'
                }`}
              >
                <div className="result-header">
                  {gameState.status === 'WON' ? (
                    <CheckCircle2 size={24} className="result-icon-won" />
                  ) : (
                    <XCircle size={24} className="result-icon-lost" />
                  )}
                  <div>
                    <h3>
                      {gameState.status === 'WON' ? t.wonTitle : t.lostTitle}
                    </h3>
                    {gameState.status === 'WON' && (
                      <span className="earned-points-pill">
                        <Award size={14} /> {t.earnedPointsLabel}: +
                        {gameState.earnedPoints ?? 0} MMR
                      </span>
                    )}
                  </div>
                </div>

                {gameState.answer && (
                  <div className="revealed-anime-card">
                    <img
                      src={gameState.answer.coverUrl}
                      alt={
                        gameState.answer.titleEn ??
                        gameState.answer.titleRomaji
                      }
                      className="revealed-anime-cover"
                    />
                    <div className="revealed-anime-details">
                      <h4 className="revealed-primary-title">
                        {(lang === 'uk' && gameState.answer.titleUk) ||
                          (lang === 'ru' && gameState.answer.titleRu) ||
                          gameState.answer.titleEn ||
                          gameState.answer.titleRomaji}
                      </h4>
                      <div className="revealed-localized-list">
                        <span>
                          <strong>Romaji:</strong>{' '}
                          {gameState.answer.titleRomaji}
                        </span>
                        {gameState.answer.titleEn && (
                          <span>
                            <strong>EN:</strong> {gameState.answer.titleEn}
                          </span>
                        )}
                        {gameState.answer.titleUk && (
                          <span>
                            <strong>UA:</strong> {gameState.answer.titleUk}
                          </span>
                        )}
                        {gameState.answer.titleRu && (
                          <span>
                            <strong>RU:</strong> {gameState.answer.titleRu}
                          </span>
                        )}
                        {gameState.answer.titleJa && (
                          <span>
                            <strong>JA:</strong> {gameState.answer.titleJa}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {remainingUnrevealedClues.length > 0 && (
                  <div className="remaining-clues-section">
                    <h5>{t.remainingCluesTitle}</h5>
                    <div className="clues-cards-list compact">
                      {remainingUnrevealedClues.map((clue) => (
                        <div key={clue.step} className="clue-card unrevealed">
                          <div className="clue-card-header">
                            <span className="clue-step-tag">
                              {t.clueStepLabel} {clue.step}/{gameState.maxSteps}
                            </span>
                            <span
                              className={`difficulty-badge difficulty-${clue.difficulty.toLowerCase()}`}
                            >
                              {clue.difficulty}
                            </span>
                          </div>
                          <p className="clue-card-text">{clue.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  className="next-anime-btn"
                  onClick={() => void handleStartRound()}
                >
                  <span>{t.nextAnimeBtn}</span>
                  <ArrowRight size={18} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
