import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import {
  Award,
  Camera,
  CheckCircle2,
  Flame,
  Gamepad2,
  Heart,
  Link2,
  Loader2,
  Percent,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
  Trophy,
  Upload,
  User as UserIcon,
  Users,
  X,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { AnimeSearchResultItem } from '../components/AnimeAutocompleteInput';
import {
  FavoriteAnimeItem,
  FavoriteCharacterItem,
  useAuth,
} from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

interface CharacterSearchResultItem {
  id: number;
  name: string;
  imageUrl: string;
  animeTitle?: string;
}

const MAX_FAVORITE_SLOTS = 5;

export function ProfilePage() {
  const { user, updateProfile, uploadAvatar } = useAuth();
  const { lang, t } = useLanguage();

  const [nickname, setNickname] = useState(
    user?.nickname ?? user?.username ?? '',
  );
  const [bio, setBio] = useState(user?.bio ?? '');
  const [avatarUrlInput, setAvatarUrlInput] = useState(user?.avatarUrl ?? '');
  const [showUrlInput, setShowUrlInput] = useState(false);

  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [toast, setToast] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Anime search modal state
  const [animeModalOpen, setAnimeModalOpen] = useState(false);
  const [animeQuery, setAnimeQuery] = useState('');
  const [animeResults, setAnimeResults] = useState<AnimeSearchResultItem[]>([]);
  const [isSearchingAnime, setIsSearchingAnime] = useState(false);

  // Character search modal state
  const [charModalOpen, setCharModalOpen] = useState(false);
  const [charQuery, setCharQuery] = useState('');
  const [charResults, setCharResults] = useState<CharacterSearchResultItem[]>(
    [],
  );
  const [isSearchingChar, setIsSearchingChar] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (user) {
      setNickname(user.nickname ?? user.username);
      setBio(user.bio ?? '');
      setAvatarUrlInput(user.avatarUrl ?? '');
    }
  }, [user]);

  const showToast = (type: 'success' | 'error', message: string) => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast({ type, message });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, 3500);
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // Debounced anime search for Favorite Anime Modal
  useEffect(() => {
    if (!animeModalOpen) return;
    const trimmed = animeQuery.trim();
    if (trimmed.length < 2) {
      setAnimeResults([]);
      setIsSearchingAnime(false);
      return;
    }

    setIsSearchingAnime(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiClient.get<AnimeSearchResultItem[]>(
          '/anime/search',
          {
            params: { q: trimmed, limit: 12 },
          },
        );
        setAnimeResults(res.data);
      } catch {
        setAnimeResults([]);
      } finally {
        setIsSearchingAnime(false);
      }
    }, 260);

    return () => window.clearTimeout(timer);
  }, [animeQuery, animeModalOpen]);

  // Debounced character search for Favorite Characters Modal
  useEffect(() => {
    if (!charModalOpen) return;
    const trimmed = charQuery.trim();
    if (trimmed.length < 2) {
      setCharResults([]);
      setIsSearchingChar(false);
      return;
    }

    setIsSearchingChar(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiClient.get<CharacterSearchResultItem[]>(
          '/anime/characters/search',
          {
            params: { q: trimmed },
          },
        );
        setCharResults(res.data);
      } catch {
        setCharResults([]);
      } finally {
        setIsSearchingChar(false);
      }
    }, 280);

    return () => window.clearTimeout(timer);
  }, [charQuery, charModalOpen]);

  if (!user) {
    return null;
  }

  const favoriteAnime: FavoriteAnimeItem[] = Array.isArray(user.favoriteAnime)
    ? user.favoriteAnime.slice(0, MAX_FAVORITE_SLOTS)
    : [];
  const favoriteCharacters: FavoriteCharacterItem[] = Array.isArray(
    user.favoriteCharacters,
  )
    ? user.favoriteCharacters.slice(0, MAX_FAVORITE_SLOTS)
    : [];

  const gamesPlayed = user.gamesPlayed ?? 0;
  const gamesWon = user.gamesWon ?? 0;
  const winRate =
    gamesPlayed > 0 ? Math.round((gamesWon / gamesPlayed) * 100) : 0;

  const extractErrorMessage = (err: unknown, fallback: string): string => {
    const raw = (err as { response?: { data?: { message?: string | string[] } } })
      ?.response?.data?.message;
    if (Array.isArray(raw)) return raw.join(', ');
    if (typeof raw === 'string' && raw.trim()) return raw;
    return fallback;
  };

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedNick = nickname.trim();
    if (trimmedNick.length < 3 || trimmedNick.length > 24) {
      showToast('error', 'Nickname must be between 3 and 24 characters.');
      return;
    }

    setIsSavingProfile(true);
    try {
      await updateProfile({
        nickname: trimmedNick,
        bio: bio.trim() || null,
      });
      showToast('success', t.profileSavedToast);
    } catch (err) {
      showToast('error', extractErrorMessage(err, 'Failed to update profile.'));
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > 3 * 1024 * 1024) {
      showToast('error', t.avatarHint);
      return;
    }

    setIsUploadingAvatar(true);
    try {
      await uploadAvatar(file);
      showToast('success', t.avatarSavedToast);
    } catch (err) {
      showToast('error', extractErrorMessage(err, 'Failed to upload avatar.'));
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleApplyAvatarUrl = async () => {
    const trimmedUrl = avatarUrlInput.trim();
    setIsUploadingAvatar(true);
    try {
      await updateProfile({
        avatarUrl: trimmedUrl || null,
      });
      setShowUrlInput(false);
      showToast('success', t.avatarSavedToast);
    } catch (err) {
      showToast('error', extractErrorMessage(err, 'Invalid avatar URL.'));
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const resolveLocalizedAnimeTitle = (item: AnimeSearchResultItem): string => {
    if (lang === 'uk' && item.titleUk) return item.titleUk;
    if (lang === 'ru' && item.titleRu) return item.titleRu;
    return item.titleEn || item.titleRomaji || item.titleJa || `Anime #${item.id}`;
  };

  const handleAddFavoriteAnime = async (item: AnimeSearchResultItem) => {
    if (favoriteAnime.length >= MAX_FAVORITE_SLOTS) return;
    const itemId = String(item.id);
    if (favoriteAnime.some((a) => a.id === itemId)) {
      setAnimeModalOpen(false);
      return;
    }

    const nextAnime: FavoriteAnimeItem[] = [
      ...favoriteAnime,
      {
        id: itemId,
        title: resolveLocalizedAnimeTitle(item),
        coverUrl: item.coverUrl ?? '',
      },
    ];

    try {
      await updateProfile({ favoriteAnime: nextAnime });
      setAnimeModalOpen(false);
      setAnimeQuery('');
      setAnimeResults([]);
      showToast('success', t.profileSavedToast);
    } catch (err) {
      showToast(
        'error',
        extractErrorMessage(err, 'Failed to add favorite anime.'),
      );
    }
  };

  const handleRemoveFavoriteAnime = async (animeId: string) => {
    const nextAnime = favoriteAnime.filter((a) => a.id !== animeId);
    try {
      await updateProfile({ favoriteAnime: nextAnime });
      showToast('success', t.profileSavedToast);
    } catch (err) {
      showToast(
        'error',
        extractErrorMessage(err, 'Failed to remove favorite anime.'),
      );
    }
  };

  const handleAddFavoriteCharacter = async (char: CharacterSearchResultItem) => {
    if (favoriteCharacters.length >= MAX_FAVORITE_SLOTS) return;
    if (favoriteCharacters.some((c) => c.id === char.id)) {
      setCharModalOpen(false);
      return;
    }

    const nextChars: FavoriteCharacterItem[] = [
      ...favoriteCharacters,
      {
        id: char.id,
        name: char.name,
        imageUrl: char.imageUrl,
        ...(char.animeTitle ? { animeTitle: char.animeTitle } : {}),
      },
    ];

    try {
      await updateProfile({ favoriteCharacters: nextChars });
      setCharModalOpen(false);
      setCharQuery('');
      setCharResults([]);
      showToast('success', t.profileSavedToast);
    } catch (err) {
      showToast(
        'error',
        extractErrorMessage(err, 'Failed to add favorite character.'),
      );
    }
  };

  const handleRemoveFavoriteCharacter = async (charId: number) => {
    const nextChars = favoriteCharacters.filter((c) => c.id !== charId);
    try {
      await updateProfile({ favoriteCharacters: nextChars });
      showToast('success', t.profileSavedToast);
    } catch (err) {
      showToast(
        'error',
        extractErrorMessage(err, 'Failed to remove favorite character.'),
      );
    }
  };

  const emptyAnimeSlotsCount = Math.max(
    0,
    MAX_FAVORITE_SLOTS - favoriteAnime.length,
  );
  const emptyCharSlotsCount = Math.max(
    0,
    MAX_FAVORITE_SLOTS - favoriteCharacters.length,
  );

  return (
    <div className="profile-page">
      {toast && (
        <div
          className={`toast-notification ${toast.type}`}
          role="status"
          aria-live="polite"
        >
          <CheckCircle2 size={18} />
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header Card: Avatar, Nickname, Bio */}
      <section className="profile-header-card">
        <div className="profile-avatar-column">
          <div
            className="avatar-circle-wrapper"
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            aria-label={t.avatarUploadBtn}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                fileInputRef.current?.click();
              }
            }}
          >
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.nickname ?? user.username}
                className="avatar-circle-img"
              />
            ) : (
              <div className="avatar-circle-fallback">
                <UserIcon size={44} />
              </div>
            )}
            <div className="avatar-hover-overlay">
              {isUploadingAvatar ? (
                <Loader2 size={24} className="spin-icon" />
              ) : (
                <>
                  <Camera size={22} />
                  <span>{t.avatarUploadBtn}</span>
                </>
              )}
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only-file-input"
            onChange={(e) => void handleFileChange(e)}
          />

          <div className="avatar-action-links">
            <button
              type="button"
              className="avatar-mini-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingAvatar}
            >
              <Upload size={13} />
              {t.avatarUploadBtn}
            </button>
            <button
              type="button"
              className="avatar-mini-btn"
              onClick={() => setShowUrlInput((prev) => !prev)}
              disabled={isUploadingAvatar}
            >
              <Link2 size={13} />
              {t.avatarUrlBtn}
            </button>
          </div>
          <span className="avatar-hint-text">{t.avatarHint}</span>

          {showUrlInput && (
            <div className="avatar-url-popover">
              <input
                type="url"
                value={avatarUrlInput}
                onChange={(e) => setAvatarUrlInput(e.target.value)}
                placeholder={t.avatarUrlPlaceholder}
                className="profile-input compact"
              />
              <button
                type="button"
                className="game-btn primary compact"
                disabled={isUploadingAvatar}
                onClick={() => void handleApplyAvatarUrl()}
              >
                {t.avatarApplyBtn}
              </button>
            </div>
          )}
        </div>

        <form className="profile-Identity-form" onSubmit={handleSaveProfile}>
          <div className="profile-title-row">
            <div>
              <h2>{t.profileTitle}</h2>
              <p className="profile-subtitle">{t.profileSubtitle}</p>
            </div>
            <span className="profile-badge-chip">
              <Sparkles size={14} />
              {user.badgeTitle}
            </span>
          </div>

          <div className="form-field">
            <label htmlFor="profile-nickname">{t.nicknameLabel}</label>
            <input
              id="profile-nickname"
              type="text"
              minLength={3}
              maxLength={24}
              required
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={t.nicknamePlaceholder}
              className="profile-input"
            />
          </div>

          <div className="form-field">
            <div className="field-label-row">
              <label htmlFor="profile-bio">{t.bioLabel}</label>
              <span className="char-counter">{bio.length}/250</span>
            </div>
            <textarea
              id="profile-bio"
              rows={3}
              maxLength={250}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder={t.bioPlaceholder}
              className="profile-textarea"
            />
          </div>

          <div className="profile-save-row">
            <button
              type="submit"
              className="game-btn primary save-profile-btn"
              disabled={isSavingProfile}
            >
              {isSavingProfile ? (
                <>
                  <Loader2 size={16} className="spin-icon" />
                  {t.savingBtn}
                </>
              ) : (
                <>
                  <Save size={16} />
                  {t.saveChangesBtn}
                </>
              )}
            </button>
          </div>
        </form>
      </section>

      {/* Statistics Grid */}
      <section className="profile-section-card">
        <div className="profile-section-header">
          <h3>
            <Trophy size={19} /> {t.statsSectionTitle}
          </h3>
        </div>
        <div className="stats-cards-grid">
          <div className="stat-metric-card">
            <div className="stat-metric-icon rating">
              <Trophy size={20} />
            </div>
            <div className="stat-metric-body">
              <span className="stat-metric-label">{t.statRating}</span>
              <strong className="stat-metric-value">{user.rating}</strong>
            </div>
          </div>

          <div className="stat-metric-card">
            <div className="stat-metric-icon best-streak">
              <Award size={20} />
            </div>
            <div className="stat-metric-body">
              <span className="stat-metric-label">{t.statMaxStreak}</span>
              <strong className="stat-metric-value">{user.maxStreak}</strong>
            </div>
          </div>

          <div className="stat-metric-card">
            <div className="stat-metric-icon streak">
              <Flame size={20} />
            </div>
            <div className="stat-metric-body">
              <span className="stat-metric-label">{t.statCurrentStreak}</span>
              <strong className="stat-metric-value">{user.currentStreak}</strong>
            </div>
          </div>

          <div className="stat-metric-card">
            <div className="stat-metric-icon games">
              <Gamepad2 size={20} />
            </div>
            <div className="stat-metric-body">
              <span className="stat-metric-label">{t.statGamesPlayed}</span>
              <strong className="stat-metric-value">{gamesPlayed}</strong>
            </div>
          </div>

          <div className="stat-metric-card">
            <div className="stat-metric-icon winrate">
              <Percent size={20} />
            </div>
            <div className="stat-metric-body">
              <span className="stat-metric-label">{t.statWinRate}</span>
              <strong className="stat-metric-value">
                {winRate}%{' '}
                <small className="stat-metric-sub">
                  ({gamesWon} {t.statWinsCount})
                </small>
              </strong>
            </div>
          </div>
        </div>
      </section>

      {/* Favorite Anime Showcase (Up to 5 slots) */}
      <section className="profile-section-card">
        <div className="profile-section-header">
          <div>
            <h3>
              <Heart size={19} /> {t.favAnimeSectionTitle}
            </h3>
            <p className="section-subcaption">{t.favAnimeSectionSubtitle}</p>
          </div>
          <span className="slot-counter-badge">
            {favoriteAnime.length}/{MAX_FAVORITE_SLOTS}
          </span>
        </div>

        <div className="showcase-slots-grid">
          {favoriteAnime.map((anime) => (
            <div key={anime.id} className="showcase-poster-card">
              <div className="showcase-poster-frame">
                {anime.coverUrl ? (
                  <img
                    src={anime.coverUrl}
                    alt={anime.title}
                    className="showcase-poster-img"
                  />
                ) : (
                  <div className="showcase-poster-placeholder">
                    <Sparkles size={24} />
                  </div>
                )}
                <button
                  type="button"
                  className="showcase-remove-btn"
                  title={t.removeSlotTitle}
                  aria-label={`${t.removeSlotTitle}: ${anime.title}`}
                  onClick={() => void handleRemoveFavoriteAnime(anime.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="showcase-card-caption">
                <strong title={anime.title}>{anime.title}</strong>
              </div>
            </div>
          ))}

          {Array.from({ length: emptyAnimeSlotsCount }).map((_, idx) => (
            <button
              key={`empty-anime-${idx}`}
              type="button"
              className="showcase-empty-slot"
              onClick={() => {
                setAnimeQuery('');
                setAnimeResults([]);
                setAnimeModalOpen(true);
              }}
            >
              <div className="empty-slot-plus">
                <Plus size={24} />
              </div>
              <span>+ {t.addAnimeSlotBtn}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Favorite Characters Showcase (Up to 5 slots) */}
      <section className="profile-section-card">
        <div className="profile-section-header">
          <div>
            <h3>
              <Users size={19} /> {t.favCharsSectionTitle}
            </h3>
            <p className="section-subcaption">{t.favCharsSectionSubtitle}</p>
          </div>
          <span className="slot-counter-badge">
            {favoriteCharacters.length}/{MAX_FAVORITE_SLOTS}
          </span>
        </div>

        <div className="showcase-slots-grid">
          {favoriteCharacters.map((char) => (
            <div key={char.id} className="showcase-poster-card">
              <div className="showcase-poster-frame">
                {char.imageUrl ? (
                  <img
                    src={char.imageUrl}
                    alt={char.name}
                    className="showcase-poster-img"
                  />
                ) : (
                  <div className="showcase-poster-placeholder">
                    <UserIcon size={24} />
                  </div>
                )}
                <button
                  type="button"
                  className="showcase-remove-btn"
                  title={t.removeSlotTitle}
                  aria-label={`${t.removeSlotTitle}: ${char.name}`}
                  onClick={() => void handleRemoveFavoriteCharacter(char.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="showcase-card-caption">
                <strong title={char.name}>{char.name}</strong>
                {char.animeTitle && (
                  <span
                    className="showcase-card-sub"
                    title={char.animeTitle}
                  >
                    {char.animeTitle}
                  </span>
                )}
              </div>
            </div>
          ))}

          {Array.from({ length: emptyCharSlotsCount }).map((_, idx) => (
            <button
              key={`empty-char-${idx}`}
              type="button"
              className="showcase-empty-slot"
              onClick={() => {
                setCharQuery('');
                setCharResults([]);
                setCharModalOpen(true);
              }}
            >
              <div className="empty-slot-plus">
                <Plus size={24} />
              </div>
              <span>+ {t.addCharSlotBtn}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Favorite Anime Search Modal */}
      {animeModalOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setAnimeModalOpen(false)}
        >
          <div
            className="showcase-search-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="auth-modal-header">
              <div className="auth-modal-brand">
                <Heart size={20} />
                <h2>{t.modalSearchAnimeTitle}</h2>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                aria-label={t.modalCloseBtn}
                onClick={() => setAnimeModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="search-box">
              <Search size={18} />
              <input
                type="text"
                autoFocus
                value={animeQuery}
                onChange={(e) => setAnimeQuery(e.target.value)}
                placeholder={t.modalSearchAnimePlaceholder}
              />
              {isSearchingAnime && (
                <Loader2 size={16} className="spin-icon" />
              )}
            </div>

            <div className="modal-results-grid">
              {animeQuery.trim().length >= 2 &&
                !isSearchingAnime &&
                animeResults.length === 0 && (
                  <p className="modal-empty-state">{t.noResults}</p>
                )}

              {animeResults.map((item) => {
                const title = resolveLocalizedAnimeTitle(item);
                const alreadyAdded = favoriteAnime.some(
                  (a) => a.id === String(item.id),
                );
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={alreadyAdded}
                    className={`modal-result-item ${alreadyAdded ? 'already-added' : ''}`}
                    onClick={() => void handleAddFavoriteAnime(item)}
                  >
                    {item.coverUrl ? (
                      <img
                        src={item.coverUrl}
                        alt={title}
                        className="modal-result-thumb"
                      />
                    ) : (
                      <div className="modal-result-thumb placeholder" />
                    )}
                    <div className="modal-result-meta">
                      <strong>{title}</strong>
                      {item.titleRomaji && item.titleRomaji !== title && (
                        <span>{item.titleRomaji}</span>
                      )}
                      {item.year && <small>{item.year}</small>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Favorite Character Search Modal */}
      {charModalOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setCharModalOpen(false)}
        >
          <div
            className="showcase-search-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="auth-modal-header">
              <div className="auth-modal-brand">
                <Users size={20} />
                <h2>{t.modalSearchCharTitle}</h2>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                aria-label={t.modalCloseBtn}
                onClick={() => setCharModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="search-box">
              <Search size={18} />
              <input
                type="text"
                autoFocus
                value={charQuery}
                onChange={(e) => setCharQuery(e.target.value)}
                placeholder={t.modalSearchCharPlaceholder}
              />
              {isSearchingChar && (
                <Loader2 size={16} className="spin-icon" />
              )}
            </div>

            <div className="modal-results-grid">
              {charQuery.trim().length >= 2 &&
                !isSearchingChar &&
                charResults.length === 0 && (
                  <p className="modal-empty-state">{t.noResults}</p>
                )}

              {charResults.map((char) => {
                const alreadyAdded = favoriteCharacters.some(
                  (c) => c.id === char.id,
                );
                return (
                  <button
                    key={char.id}
                    type="button"
                    disabled={alreadyAdded}
                    className={`modal-result-item ${alreadyAdded ? 'already-added' : ''}`}
                    onClick={() => void handleAddFavoriteCharacter(char)}
                  >
                    <img
                      src={char.imageUrl}
                      alt={char.name}
                      className="modal-result-thumb"
                    />
                    <div className="modal-result-meta">
                      <strong>{char.name}</strong>
                      {char.animeTitle && <span>{char.animeTitle}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
