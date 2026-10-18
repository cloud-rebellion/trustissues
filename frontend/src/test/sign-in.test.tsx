import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import {
  api,
  request,
  setEnrollmentRequiredHandler,
  setUnauthorizedHandler,
} from '@/lib/api';
import Login from '@/pages/Login';
import type { User } from '@/lib/types';

const account: User = {
  id: 'sign-in-fixture',
  email: 'reader@example.test',
  name: 'Sign-in fixture',
  role: 'user',
  totp_enabled: true,
  created_at: '2026-10-18T12:00:00Z',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type SignInBody = { email: string; password: string; totp_code?: string };
const fetchMock = vi.fn<typeof fetch>();
const clients: QueryClient[] = [];
let authenticated = false;
let respondToSignIn: (body: SignInBody) => Response;
let signInBodies: SignInBody[];
function lastSignInBody() { return signInBodies[signInBodies.length - 1]; }

function SessionProbe() {
  const { user } = useAuth();
  const location = useLocation();
  return <>
    <output aria-label="Signed-in account">{user?.email || 'signed out'}</output>
    <output aria-label="Current route">{location.pathname}</output>
  </>;
}

function AuthenticatedPage() {
  return <button onClick={() => void request('/vault').catch(() => undefined)}>
    Send authenticated request
  </button>;
}

function renderSignIn(path = '/login') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<AuthenticatedPage />} />
            <Route path="/vault" element={<AuthenticatedPage />} />
          </Routes>
          <SessionProbe />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

async function enterCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Email'), account.email);
  await user.type(screen.getByLabelText('Password'), 'fictional-password-only');
}

async function reachSecondFactor(user: ReturnType<typeof userEvent.setup>) {
  await enterCredentials(user);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  return screen.findByLabelText('Two-factor or recovery code');
}

beforeEach(() => {
  authenticated = false;
  signInBodies = [];
  respondToSignIn = () => json({ totp_required: true });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, options) => {
    switch (String(input)) {
      case '/api/auth/status': return json({ setup_required: false });
      case '/api/auth/me': return authenticated ? json(account) : json({ error: 'not authenticated' }, 401);
      case '/api/auth/login': {
        const body = JSON.parse(String(options?.body)) as SignInBody;
        signInBodies.push(body);
        return respondToSignIn(body);
      }
      case '/api/vault': return json({ error: 'session revoked' }, 401);
      default: throw new Error('Unexpected sign-in fixture request');
    }
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  setUnauthorizedHandler(undefined);
  setEnrollmentRequiredHandler(undefined);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('sign-in refusals retain their meaning without changing session rules', () => {
  it.each(['invalid credentials', 'invalid 2FA code'])(
    'retains the server response for %s without invoking global session invalidation',
    async (message) => {
      const onUnauthorized = vi.fn();
      setUnauthorizedHandler(onUnauthorized);
      respondToSignIn = () => json({ error: message, code: 'unauthorized' }, 401);

      await expect(api.auth.login(account.email, 'fictional-password-only')).rejects.toMatchObject({
        status: 401,
        message,
        body: { error: message, code: 'unauthorized' },
      });
      expect(onUnauthorized).not.toHaveBeenCalled();
    },
  );

  it('keeps the anonymous /auth/me probe opted out and authenticated 401s opted in', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    await expect(api.auth.me()).rejects.toMatchObject({ status: 401, message: 'Unauthorized' });
    expect(onUnauthorized).not.toHaveBeenCalled();
    await expect(request('/vault')).rejects.toMatchObject({ status: 401, message: 'Unauthorized' });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('the real AuthProvider clears both user and query cache when an authenticated request is refused', async () => {
    authenticated = true;
    const user = userEvent.setup();
    const client = renderSignIn('/');
    await waitFor(() => expect(screen.getByLabelText('Signed-in account')).toHaveTextContent(account.email));
    client.setQueryData(['private-fixture'], { name: 'fictional private metadata' });

    await user.click(screen.getByRole('button', { name: 'Send authenticated request' }));

    expect(await screen.findByRole('heading', { name: 'Sign in to Trustissues' })).toBeInTheDocument();
    expect(screen.getByLabelText('Signed-in account')).toHaveTextContent('signed out');
    expect(client.getQueryData(['private-fixture'])).toBeUndefined();
  });

  it.each([
    [401, 'invalid credentials', /Email or password is incorrect/],
    [429, 'too many failed attempts, try again in 15 minutes', /Try again in 15 minutes/],
    [429, 'too many requests', /Too many sign-in attempts from this address/],
    [503, 'the server is at capacity verifying passwords; retry shortly', /temporarily busy/],
  ] as const)('explains a %s response accurately', async (status, error, expected) => {
    const user = userEvent.setup();
    respondToSignIn = () => json({ error }, status);
    renderSignIn();
    await enterCredentials(user);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
    expect(screen.getByLabelText('Signed-in account')).toHaveTextContent('signed out');
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/login');
  });
});

describe('the actual login form and AuthProvider complete second-factor sign-in', () => {
  it('accepts a full pasted recovery code, explains a rejected code, and permits a fresh retry without bypassing MFA', async () => {
    const user = userEvent.setup();
    const consoleSpies = (['log', 'info', 'warn', 'error'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined));
    const rejectedCode = '0123456789abcdef';
    const acceptedCode = 'fedcba9876543210';
    respondToSignIn = (body) => {
      if (!body.totp_code) return json({ totp_required: true });
      if (body.totp_code !== acceptedCode) return json({ error: 'invalid 2FA code' }, 401);
      authenticated = true;
      return json({ user: account });
    };
    renderSignIn();
    const codeField = await reachSecondFactor(user);
    expect(codeField).toHaveAttribute('maxlength', '16');
    expect(codeField).toHaveAttribute('inputmode', 'text');
    expect(screen.getByLabelText('Signed-in account')).toHaveTextContent('signed out');
    await user.click(codeField);
    await user.paste(rejectedCode);
    expect(codeField).toHaveValue(rejectedCode);
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/two-factor or recovery code was not accepted/);
    expect(screen.getByRole('alert')).not.toHaveTextContent(/password is incorrect/);
    expect(screen.getByLabelText('Signed-in account')).toHaveTextContent('signed out');
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/login');
    expect(codeField).toHaveValue('');
    expect(lastSignInBody()?.totp_code).toBe(rejectedCode);

    await user.click(codeField);
    await user.paste(acceptedCode);
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(screen.getByLabelText('Signed-in account')).toHaveTextContent(account.email));
    expect(lastSignInBody()?.totp_code).toBe(acceptedCode);
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/vault');
    for (const spy of consoleSpies) {
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).not.toContain('fictional-password-only');
      expect(logged).not.toContain(rejectedCode);
      expect(logged).not.toContain(acceptedCode);
    }
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it.each(['Email', 'Password'])('drops the stale MFA step and code when %s is edited or autofilled', async (label) => {
    const user = userEvent.setup();
    renderSignIn();
    const codeField = await reachSecondFactor(user);
    await user.type(codeField, '123456');
    const replacement = label === 'Email' ? 'another@example.test' : 'replacement-fictional-password';

    // One change event also covers a password manager replacing the full value.
    fireEvent.change(screen.getByLabelText(label), { target: { value: replacement } });

    expect(screen.queryByLabelText('Two-factor or recovery code')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByLabelText('Two-factor or recovery code')).toHaveValue('');
    expect(lastSignInBody()).not.toHaveProperty('totp_code');
    expect(lastSignInBody()?.[label.toLowerCase() as 'email' | 'password']).toBe(replacement);
    expect(screen.getByLabelText('Signed-in account')).toHaveTextContent('signed out');
  });
});
