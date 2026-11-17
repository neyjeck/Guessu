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

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  isEmailVerified: boolean;
  role: UserRole;
  avatarUrl: string | null;
  profileTheme: string;
  badgeTitle: string;
  rating: number;
  currentStreak: number;
  maxStreak: number;
  createdAt: string;
  updatedAt: string;
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
  clearAuthError: () => void;
  login: (payload: LoginPayload) => Promise<AuthUser>;
  register: (payload: RegisterPayload) => Promise<AuthUser>;
  verifyEmail: (payload: VerifyEmailPayload) => Promise<AuthUser>;
  resendVerification: (email: string) => Promise<string>;
  forgotPassword: (email: string) => Promise<string>;
  resetPassword: (payload: ResetPasswordPayload) => Promise<string>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  google_cancelled: 'Google sign-in was cancelled.',
  google_auth_failed:
    'Google authentication failed. Please ensure your Google account has a verified email and try again.',
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
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

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const response = await apiClient.get<AuthUser>('/auth/me');
      setUser(response.data);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

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

  const login = useCallback(async (payload: LoginPayload): Promise<AuthUser> => {
    const response = await apiClient.post<AuthUser>('/auth/login', payload);
    setUser(response.data);
    setAuthError(null);
    return response.data;
  }, []);

  const register = useCallback(
    async (payload: RegisterPayload): Promise<AuthUser> => {
      const response = await apiClient.post<AuthUser>(
        '/auth/register',
        payload,
      );
      setUser(response.data);
      setAuthError(null);
      return response.data;
    },
    [],
  );

  const verifyEmail = useCallback(
    async (payload: VerifyEmailPayload): Promise<AuthUser> => {
      const response = await apiClient.post<AuthUser>(
        '/auth/verify-email',
        payload,
      );
      setUser(response.data);
      return response.data;
    },
    [],
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
      clearAuthError,
      login,
      register,
      verifyEmail,
      resendVerification,
      forgotPassword,
      resetPassword,
      logout,
      refreshProfile,
    }),
    [
      user,
      isLoading,
      authError,
      clearAuthError,
      login,
      register,
      verifyEmail,
      resendVerification,
      forgotPassword,
      resetPassword,
      logout,
      refreshProfile,
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
