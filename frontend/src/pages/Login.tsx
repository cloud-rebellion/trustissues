import { useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';
import { KeyRound, Loader2 } from 'lucide-react';

function signInError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) {
      if (err.message === 'invalid credentials') {
        return 'Email or password is incorrect. Check your saved sign-in details and try again.';
      }
      if (err.message === 'invalid 2FA code') {
        return 'The two-factor or recovery code was not accepted. Enter a fresh authenticator code or an unused recovery code.';
      }
      return 'Sign-in was not accepted. Check your sign-in details and try again.';
    }
    if (err.status === 429) {
      if (err.message.includes('15 minutes')) {
        return 'Too many failed sign-in attempts. Try again in 15 minutes.';
      }
      return 'Too many sign-in attempts from this address. Wait before trying again.';
    }
    if (err.status === 503) {
      return 'TrustIssues is temporarily busy. Wait a moment and try signing in again.';
    }
    return err.message;
  }
  return 'Could not sign in. Check your connection and try again.';
}

export default function Login() {
  const { login, isLoading, setupRequired, user } = useAuth();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const errorMessages: Record<string, string> = {
    auth_failed: 'Authentication failed',
    session_expired: 'Your session has expired',
    account_disabled: 'Your account has been disabled',
  };
  const errorParam = searchParams.get('error') || '';
  const [error, setError] = useState(errorMessages[errorParam] || '');
  const [loading, setLoading] = useState(false);
  const [totpStep, setTotpStep] = useState(false);
  const [totpCode, setTotpCode] = useState('');

  function clearSecondFactor() {
    setTotpStep(false);
    setTotpCode('');
    setError('');
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (setupRequired) {
    return <Navigate to="/setup" replace />;
  }

  if (user) {
    return <Navigate to="/vault" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await login(email, password, totpStep ? totpCode : undefined);
      if (res.totp_required) {
        setTotpStep(true);
        setLoading(false);
        return;
      }
    } catch (err) {
      setError(signInError(err));
      setTotpCode('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-3 flex items-center justify-center gap-2">
            <KeyRound className="h-6 w-6 text-slate-700" />
            <span className="text-xl font-bold text-slate-900">
              Trustissues
            </span>
          </div>
          <h1 className="text-lg font-semibold text-slate-900">
            Sign in to Trustissues
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Your secrets are safe. That is the whole point.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-slate-200 bg-white p-6"
        >
          {error && (
            <div role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label
              htmlFor="email"
              className="mb-1.5 block text-sm font-medium text-slate-700"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                clearSecondFactor();
              }}
              required
              disabled={loading}
              autoComplete="email"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-hidden transition-colors focus:border-slate-400 focus:ring-0"
              placeholder="admin@example.com"
            />
          </div>

          <div className="mb-6">
            <label
              htmlFor="password"
              className="mb-1.5 block text-sm font-medium text-slate-700"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearSecondFactor();
              }}
              required
              disabled={loading}
              autoComplete="current-password"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-hidden transition-colors focus:border-slate-400 focus:ring-0"
              placeholder="Enter your password"
            />
          </div>

          {totpStep && (
            <div className="mb-6">
              <label
                htmlFor="totp"
                className="mb-1.5 block text-sm font-medium text-slate-700"
              >
                Two-factor or recovery code
              </label>
              <input
                id="totp"
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                autoCapitalize="none"
                spellCheck={false}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tracking-widest outline-hidden transition-colors focus:border-slate-400 focus:ring-0"
                placeholder="000000"
                maxLength={16}
                autoFocus
              />
              <p className="mt-1 text-xs text-slate-400">
                Enter the 6-digit code from your authenticator app, or an unused
                16-character recovery code.
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {totpStep ? 'Verify' : 'Sign in'}
          </button>

          {!totpStep && (
            <p className="mt-4 text-center text-xs text-slate-400">
              Have an invitation?{' '}
              <a href="/invite" className="text-slate-600 hover:text-slate-900">
                Accept it here
              </a>
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
