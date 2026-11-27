import { useQuery } from '@tanstack/react-query';
import { ListRow } from '../../components/ui';
import { getServices } from '../../services/container';

/** Honest connection status for the Apple Watch companion (no assumptions). */
export function WatchStatusRow() {
  const q = useQuery({
    queryKey: ['watch', 'state'],
    queryFn: async () => {
      const ws = getServices().watchSync;
      return { available: ws.available, state: await ws.getState() };
    },
    refetchInterval: 15_000,
  });
  const s = q.data?.state;
  let subtitle = 'Checking…';
  if (q.data && !q.data.available) subtitle = 'Watch support is not included in this build';
  else if (s && !s.supported) subtitle = 'Not supported on this device';
  else if (s && !s.paired) subtitle = 'No Apple Watch paired';
  else if (s && !s.installed) subtitle = 'Threshold isn’t installed on your watch';
  else if (s) subtitle = s.reachable ? 'Connected' : `Paired · syncs when available${s.pendingTransfers ? ` · ${s.pendingTransfers} pending` : ''}`;
  return <ListRow title="Apple Watch" subtitle={subtitle} onPress={() => void getServices().watchSync.pushContext().then(() => q.refetch())} />;
}
