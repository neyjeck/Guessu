import { FormEvent, useEffect, useState } from 'react';
import { AxiosError } from 'axios';
import {
  AlertCircle,
  CheckCircle2,
  Lock,
  LogIn,
  Mail,
  ShieldCheck,
  User as UserIcon,
  UserPlus,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export type AuthTab = 'login' | 'register';

interface AuthModalProps {
  isOpen: boolean;
  initialTab?: AuthTab;
  onClose: () => void;
}

interface ApiErrorPayload {
  message?: string | string[];
  statusCode?: number;
}

const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function extractErrorMessage(err: unknown): string {
  if (err instanceof AxiosError) {
    const status = err.response?.status;
    if (status === 429) {
      return 'Too many attempts. Please wait 60 seconds before trying again.';
    }
    const data = err.response?.data as ApiErrorPayload | undefined;
    if (Array.isArray(data?.message)) {
      return data.message.join(' • ');
    }
    if (typeof data?.message === 'string' && data.message.trim().length > 0) {
      return data.message;
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return 'An unexpected error occurred. Please try again.';
}

export function AuthModal({
  isOpen,
  initialTab = 'login',
  onClose,
}: AuthModalProps) {
  const { login, register, authError, clearAuthError } = useAuth();
  const [activeTab, setActiveTab] = useState<AuthTab>(initialTab);

  const [loginInput, setLoginInput] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setActiveTab(initialTab);
    setError(authError);
  }, [initialTab, isOpen, authError]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const trimmedUsername = username.trim();
  const normalizedEmail = email.trim().toLowerCase();

  const passwordChecks = {
    minLength: registerPassword.length >= 8,
    hasUpper: /[A-Z]/.test(registerPassword),
    hasLower: /[a-z]/.test(registerPassword),
    hasNumber: /\d/.test(registerPassword),
  };

  const validateLogin = (): string | null => {
    if (loginInput.trim().length < 3) {
      return 'Please enter a valid username or email (at least 3 characters).';
    }
    if (loginPassword.length < 8) {
      return 'Password must be at least 8 characters long.';
    }
    return null;
  };

  const validateRegister = (): string | null => {
    if (trimmedUsername.length < 3 || trimmedUsername.length > 20) {
      return 'Username must be between 3 and 20 characters.';
    }
    if (!USERNAME_REGEX.test(trimmedUsername)) {
      return 'Username may only contain letters, numbers, and underscores.';
    }
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return 'Please enter a valid email address.';
    }
    if (
      !passwordChecks.minLength ||
      !passwordChecks.hasUpper ||
      !passwordChecks.hasLower ||
      !passwordChecks.hasNumber
    ) {
      return 'Password must be at least 8 characters and include uppercase, lowercase, and a number.';
    }
    return null;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const validationError =
      activeTab === 'login' ? validateLogin() : validateRegister();

    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    try {
      if (activeTab === 'login') {
        await login({
          login: loginInput.trim(),
          password: loginPassword,
        });
      } else {
        await register({
          username: trimmedUsername,
          email: normalizedEmail,
          password: registerPassword,
        });
      }
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const switchTab = (tab: AuthTab) => {
    setActiveTab(tab);
    setError(null);
    clearAuthError();
  };

  const handleClose = () => {
    setError(null);
    clearAuthError();
    onClose();
  };

  const handleGoogleAuth = () => {
    const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
    const normalizedBase = apiBase.replace(/\/+$/, '');
    window.location.href = `${normalizedBase}/api/auth/google`;
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
    >
      <div className="auth-modal">
        <div className="auth-modal-header">
          <div className="auth-modal-brand">
            <ShieldCheck size={20} />
            <h2 id="auth-modal-title">
              {activeTab === 'login'
                ? 'Welcome Back'
                : 'Create Challenger Account'}
            </h2>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={handleClose}
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'login'}
            className={activeTab === 'login' ? 'auth-tab active' : 'auth-tab'}
            onClick={() => switchTab('login')}
          >
            <LogIn size={16} />
            Sign In
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'register'}
            className={
              activeTab === 'register' ? 'auth-tab active' : 'auth-tab'
            }
            onClick={() => switchTab('register')}
          >
            <UserPlus size={16} />
            Register
          </button>
        </div>

        {error && (
          <div className="auth-error-banner" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form className="auth-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
          {activeTab === 'login' ? (
            <>
              <div className="form-field">
                <label htmlFor="auth-login-input">Email or Username</label>
                <div className="input-wrapper">
                  <UserIcon size={16} />
                  <input
                    id="auth-login-input"
                    type="text"
                    autoComplete="username"
                    value={loginInput}
                    onChange={(e) => setLoginInput(e.target.value)}
                    placeholder="your_username or you@example.com"
                    required
                  />
                </div>
              </div>

              <div className="form-field">
                <label htmlFor="auth-login-password">Password</label>
                <div className="input-wrapper">
                  <Lock size={16} />
                  <input
                    id="auth-login-password"
                    type="password"
                    autoComplete="current-password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="form-field">
                <label htmlFor="auth-register-username">
                  Username{' '}
                  <span className="field-hint">
                    (3–20 chars, letters/numbers/_)
                  </span>
                </label>
                <div className="input-wrapper">
                  <UserIcon size={16} />
                  <input
                    id="auth-register-username"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="otaku_detective"
                    maxLength={20}
                    required
                  />
                </div>
              </div>

              <div className="form-field">
                <label htmlFor="auth-register-email">Email Address</label>
                <div className="input-wrapper">
                  <Mail size={16} />
                  <input
                    id="auth-register-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="challenger@example.com"
                    required
                  />
                </div>
              </div>

              <div className="form-field">
                <label htmlFor="auth-register-password">Password</label>
                <div className="input-wrapper">
                  <Lock size={16} />
                  <input
                    id="auth-register-password"
                    type="password"
                    autoComplete="new-password"
                    value={registerPassword}
                    onChange={(e) => setRegisterPassword(e.target.value)}
                    placeholder="Min. 8 chars with A-Z, a-z, 0-9"
                    required
                  />
                </div>

                <ul className="password-checklist" aria-label="Password requirements">
                  <li className={passwordChecks.minLength ? 'met' : ''}>
                    <CheckCircle2 size={13} /> 8+ characters
                  </li>
                  <li className={passwordChecks.hasUpper ? 'met' : ''}>
                    <CheckCircle2 size={13} /> 1 uppercase letter
                  </li>
                  <li className={passwordChecks.hasLower ? 'met' : ''}>
                    <CheckCircle2 size={13} /> 1 lowercase letter
                  </li>
                  <li className={passwordChecks.hasNumber ? 'met' : ''}>
                    <CheckCircle2 size={13} /> 1 number
                  </li>
                </ul>
              </div>
            </>
          )}

          <button
            type="submit"
            className="auth-submit-btn"
            disabled={isSubmitting}
          >
            {isSubmitting
              ? activeTab === 'login'
                ? 'Signing in...'
                : 'Creating account...'
              : activeTab === 'login'
                ? 'Sign In'
                : 'Create Account'}
          </button>
        </form>

        <div className="oauth-divider" role="separator">
          <span>or</span>
        </div>

        <button
          type="button"
          className="oauth-google-btn"
          onClick={handleGoogleAuth}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
            />
            <path
              fill="#FBBC05"
              d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
            />
          </svg>
          Continue with Google
        </button>
      </div>
    </div>
  );
}
