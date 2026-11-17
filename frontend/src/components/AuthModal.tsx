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
  const { login, register } = useAuth();
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
    setError(null);
  }, [initialTab, isOpen]);

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
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
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
            onClick={onClose}
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
      </div>
    </div>
  );
}
