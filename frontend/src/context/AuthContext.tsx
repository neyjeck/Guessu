import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { apiClient } from '../api/client';

export type UserRole = 'USER' | 'ADMIN';
export type AppTheme =
  | 'midnight'
  | 'obsidian'
  | 'sakura-dusk'
  | 'warm-parchment';

export interface FavoriteAnimeItem {
  id: string;
  title: string;
  coverUrl: string;
}

export interface FavoriteCharacterItem {
  id: number;
  name: string;
  imageUrl: string;
  animeTitle?: string;
}

export interface AuthUser {
  id: string;
  username: string;
  nickname?: string;
  email: string;
  isEmailVerified: boolean;
  role: UserRole;
  avatarUrl: string | null;
  bio: string | null;
  favoriteAnime: FavoriteAnimeItem[];
  favoriteCharacters: FavoriteCharacterItem[];
  theme: AppTheme;
  profileTheme: string;
  badgeTitle: string;
  isPublicProfile: boolean;
  showStats: boolean;
  showFavorites: boolean;
  gamesPlayed: number;
  gamesWon: number;
  rating: number;
  currentStreak: number;
  maxStreak: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateUserProfilePayload {
  nickname?: string;
  bio?: string | null;
  avatarUrl?: string | null;
  favoriteAnime?: FavoriteAnimeItem[];
  favoriteCharacters?: FavoriteCharacterItem[];
  theme?: AppTheme;
  lang?: 'uk' | 'en' | 'ru';
  isPublicProfile?: boolean;
  showStats?: boolean;
  showFavorites?: boolean;
}

export interface LoginPayload {
  login: string;
  password: string;
}

export interface RegisterPayload {
  username: string;
  email: string;
  password: string;
}

export interface VerifyEmailPayload {
  email: string;
  code: string;
}

export interface ResetPasswordPayload {
  email: string;
  code: string;
  newPassword: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  authError: string | null;
  theme: AppTheme;
  setTheme: (nextTheme: AppTheme, persistToBackend?: boolean) => Promise<void>;
  clearAuthError: () => void;
  login: (payload: LoginPayload) => Promise<AuthUser>;
  register: (payload: RegisterPayload) => Promise<AuthUser>;
  verifyEmail: (payload: VerifyEmailPayload) => Promise<AuthUser>;
  resendVerification: (email: string) => Promise<string>;
  forgotPassword: (email: string) => Promise<string>;
  resetPassword: (payload: ResetPasswordPayload) => Promise<string>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (payload: UpdateUserProfilePayload) => Promise<AuthUser>;
  uploadAvatar: (file: File) => Promise<AuthUser>;
}

const THEME_STORAGE_KEY = 'anime_guesser_theme';
const VALID_THEMES: AppTheme[] = [
  'midnight',
  'obsidian',
  'sakura-dusk',
  'warm-parchment',
];

function isValidTheme(val: unknown): val is AppTheme {
  return typeof val === 'string' && VALID_THEMES.includes(val as AppTheme);
}

function getInitialTheme(): AppTheme {
  if (typeof window === 'undefined') {
    return 'midnight';
  }
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isValidTheme(saved) ? saved : 'midnight';
}

function applyThemeToDocument(theme: AppTheme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage quota errors
  }
}

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  google_cancelled: 'Google sign-in was cancelled.',
  google_auth_failed:
    'Google authentication failed. Please ensure your Google account has a verified email and try again.',
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function normalizeUser(raw: AuthUser): AuthUser {
  return {
    ...raw,
    nickname: raw.nickname ?? raw.username,
    bio: raw.bio ?? null,
    theme: isValidTheme(raw.theme) ? raw.theme : 'midnight',
    isPublicProfile: raw.isPublicProfile ?? true,
    showStats: raw.showStats ?? true,
    showFavorites: raw.showFavorites ?? true,
    gamesPlayed: raw.gamesPlayed ?? 0,
    gamesWon: raw.gamesWon ?? 0,
    favoriteAnime: Array.isArray(raw.favoriteAnime) ? raw.favoriteAnime : [],
    favoriteCharacters: Array.isArray(raw.favoriteCharacters)
      ? raw.favoriteCharacters
      : [],
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [theme, setThemeState] = useState<AppTheme>(() => {
    const initial = getInitialTheme();
    applyThemeToDocument(initial);
    return initial;
  });

  const [authError, setAuthError] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const errorCode = params.get('auth_error');
    if (!errorCode) {
      return null;
    }
    return (
      OAUTH_ERROR_MESSAGES[errorCode] ??
      'Authentication failed. Please try again.'
    );
  });

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  const syncUserAndTheme = useCallback((rawUser: AuthUser): AuthUser => {
    const normalized = normalizeUser(rawUser);
    setUser(normalized);
    if (isValidTheme(normalized.theme)) {
      setThemeState(normalized.theme);
      applyThemeToDocument(normalized.theme);
    }
    return normalized;
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const response = await apiClient.get<AuthUser>('/users/me');
      syncUserAndTheme(response.data);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, [syncUserAndTheme]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('auth_error')) {
      params.delete('auth_error');
      const remaining = params.toString();
      const nextUrl = `${window.location.pathname}${remaining ? `?${remaining}` : ''}${window.location.hash}`;
      window.history.replaceState({}, document.title, nextUrl);
    }

    void refreshProfile();
  }, [refreshProfile]);

  const updateProfile = useCallback(
    async (payload: UpdateUserProfilePayload): Promise<AuthUser> => {
      const response = await apiClient.patch<AuthUser>('/users/me', payload);
      return syncUserAndTheme(response.data);
    },
    [syncUserAndTheme],
  );

  const uploadAvatar = useCallback(
    async (file: File): Promise<AuthUser> => {
      const formData = new FormData();
      formData.append('avatar', file);
      const response = await apiClient.post<AuthUser>(
        '/users/me/avatar',
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        },
      );
      return syncUserAndTheme(response.data);
    },
    [syncUserAndTheme],
  );

  const setTheme = useCallback(
    async (nextTheme: AppTheme, persistToBackend = true): Promise<void> => {
      setThemeState(nextTheme);
      applyThemeToDocument(nextTheme);
      if (persistToBackend && user) {
        try {
          const response = await apiClient.patch<AuthUser>('/users/me', {
            theme: nextTheme,
          });
          setUser(normalizeUser(response.data));
        } catch {
          // Local theme change still applies even if network request fails
        }
      }
    },
    [user],
  );

  const login = useCallback(
    async (payload: LoginPayload): Promise<AuthUser> => {
      const response = await apiClient.post<AuthUser>('/auth/login', payload);
      setAuthError(null);
      return syncUserAndTheme(response.data);
    },
    [syncUserAndTheme],
  );

  const register = useCallback(
    async (payload: RegisterPayload): Promise<AuthUser> => {
      const response = await apiClient.post<AuthUser>(
        '/auth/register',
        payload,
      );
      setAuthError(null);
      return syncUserAndTheme(response.data);
    },
    [syncUserAndTheme],
  );

  const verifyEmail = useCallback(
    async (payload: VerifyEmailPayload): Promise<AuthUser> => {
      const response = await apiClient.post<AuthUser>(
        '/auth/verify-email',
        payload,
      );
      return syncUserAndTheme(response.data);
    },
    [syncUserAndTheme],
  );

  const resendVerification = useCallback(
    async (email: string): Promise<string> => {
      const response = await apiClient.post<{ message: string }>(
        '/auth/resend-verification',
        { email },
      );
      return response.data.message;
    },
    [],
  );

  const forgotPassword = useCallback(async (email: string): Promise<string> => {
    const response = await apiClient.post<{ message: string }>(
      '/auth/forgot-password',
      { email },
    );
    return response.data.message;
  }, []);

  const resetPassword = useCallback(
    async (payload: ResetPasswordPayload): Promise<string> => {
      const response = await apiClient.post<{ message: string }>(
        '/auth/reset-password',
        payload,
      );
      setUser(null);
      return response.data.message;
    },
    [],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiClient.post('/auth/logout');
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      authError,
      theme,
      setTheme,
      clearAuthError,
      login,
      register,
      verifyEmail,
      resendVerification,
      forgotPassword,
      resetPassword,
      logout,
      refreshProfile,
      updateProfile,
      uploadAvatar,
    }),
    [
      user,
      isLoading,
      authError,
      theme,
      setTheme,
      clearAuthError,
      login,
      register,
      verifyEmail,
      resendVerification,
      forgotPassword,
      resetPassword,
      logout,
      refreshProfile,
      updateProfile,
      uploadAvatar,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
