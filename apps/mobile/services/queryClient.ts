import { QueryClient } from '@tanstack/react-query';

/**
 * TanStack Query caches local-database reads (history, analytics) and optional backend calls.
 * Local reads are cheap and authoritative, so we invalidate on every session change rather than
 * relying on stale times.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      networkMode: 'offlineFirst',
    },
    mutations: {
      networkMode: 'offlineFirst',
    },
  },
});
