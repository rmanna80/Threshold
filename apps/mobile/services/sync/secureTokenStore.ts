import * as SecureStore from 'expo-secure-store';
import type { Tokens, TokenStore } from './apiClient';

const KEY = 'threshold.auth.tokens.v1';

/** Tokens live only in the iOS Keychain (this device only, after first unlock). */
export const secureTokenStore: TokenStore = {
  async get() {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    try {
      const t = JSON.parse(raw) as Tokens;
      return typeof t.accessToken === 'string' && typeof t.refreshToken === 'string' ? t : null;
    } catch {
      return null;
    }
  },
  async set(tokens) {
    if (tokens === null) await SecureStore.deleteItemAsync(KEY);
    else await SecureStore.setItemAsync(KEY, JSON.stringify(tokens), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  },
};

export class MemoryTokenStore implements TokenStore {
  tokens: Tokens | null = null;
  async get() {
    return this.tokens;
  }
  async set(t: Tokens | null) {
    this.tokens = t;
  }
}
