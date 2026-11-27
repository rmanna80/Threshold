import { useQuery } from '@tanstack/react-query';
import { getServices } from '../services/container';

/** Features + gated prediction decision for one ended session. */
export function useRecoveryOutlook(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: ['recovery', 'outlook', sessionId],
    enabled: Boolean(sessionId),
    queryFn: () => getServices().recovery.outlookFor(sessionId as string),
  });
}
