/**
 * Minimal typed client for the optional Threshold API. HTTPS is mandatory except for localhost
 * during development. Access tokens are short-lived; a 401 triggers one refresh attempt.
 */
export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export interface TokenStore {
  get(): Promise<Tokens | null>;
  set(tokens: Tokens | null): Promise<void>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
}>;

export function assertSecureBaseUrl(url: string, allowInsecureLocalhost: boolean): void {
  const u = new URL(url);
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(allowInsecureLocalhost && local && u.protocol === 'http:')) {
    throw new Error('The sync server must use HTTPS.');
  }
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly tokens: TokenStore,
    private readonly deviceId: string,
    private readonly fetchImpl: FetchLike,
    private readonly timeoutMs = 15_000,
    allowInsecureLocalhost = false,
  ) {
    assertSecureBaseUrl(baseUrl, allowInsecureLocalhost);
  }

  private async raw(method: string, path: string, body?: unknown, token?: string | null): Promise<{ status: number; data: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const data = res.status === 204 ? null : await res.json().catch(() => null);
      return { status: res.status, data };
    } finally {
      clearTimeout(timer);
    }
  }

  private async authed(method: string, path: string, body?: unknown): Promise<unknown> {
    const t = await this.tokens.get();
    if (!t) throw new ApiError(401, 'Not signed in');
    let r = await this.raw(method, path, body, t.accessToken);
    if (r.status === 401) {
      const refreshed = await this.refresh(t.refreshToken);
      if (!refreshed) throw new ApiError(401, 'Session expired. Please sign in again.');
      r = await this.raw(method, path, body, refreshed.accessToken);
    }
    if (r.status >= 400) throw new ApiError(r.status, detail(r.data) ?? `Request failed (${r.status})`);
    return r.data;
  }

  private async refresh(refreshToken: string): Promise<Tokens | null> {
    const r = await this.raw('POST', '/v1/auth/refresh', { refreshToken, deviceId: this.deviceId });
    if (r.status !== 200) {
      await this.tokens.set(null);
      return null;
    }
    const t = r.data as Tokens;
    await this.tokens.set({ accessToken: t.accessToken, refreshToken: t.refreshToken });
    return t;
  }

  async signIn(mode: 'register' | 'login', email: string, password: string): Promise<void> {
    const r = await this.raw('POST', `/v1/auth/${mode}`, { email, password, deviceId: this.deviceId });
    if (r.status !== 200 && r.status !== 201) throw new ApiError(r.status, detail(r.data) ?? 'Sign-in failed');
    const t = r.data as Tokens;
    await this.tokens.set({ accessToken: t.accessToken, refreshToken: t.refreshToken });
  }

  async signOut(): Promise<void> {
    try {
      await this.authed('POST', '/v1/auth/logout');
    } finally {
      await this.tokens.set(null);
    }
  }

  async isSignedIn(): Promise<boolean> {
    return (await this.tokens.get()) !== null;
  }

  push(envelopes: unknown[]): Promise<unknown> {
    return this.authed('POST', '/v1/sync/push', { deviceId: this.deviceId, envelopes });
  }

  pull(cursor: number, limit = 500): Promise<unknown> {
    return this.authed('GET', `/v1/sync/pull?cursor=${encodeURIComponent(String(cursor))}&limit=${limit}`);
  }

  exportAccount(): Promise<unknown> {
    return this.authed('GET', '/v1/account/export');
  }

  async deleteAccount(password: string): Promise<void> {
    await this.authed('DELETE', '/v1/account', { password });
    await this.tokens.set(null);
  }
}

function detail(data: unknown): string | null {
  if (data && typeof data === 'object' && 'detail' in data && typeof (data as { detail: unknown }).detail === 'string') {
    return (data as { detail: string }).detail;
  }
  return null;
}
