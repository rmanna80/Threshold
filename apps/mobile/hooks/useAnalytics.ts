import { useQuery } from '@tanstack/react-query';
import { loadAnalytics } from '../services/analyticsService';
import { getServices } from '../services/container';
import { useAppStore } from '../stores/appStore';

export function useAnalytics(weeks = 8) {
  const boundary = useAppStore((s) => s.preferences.dayBoundaryHour);
  const goals = useAppStore((s) => s.goals);
  return useQuery({
    queryKey: ['analytics', weeks, boundary, goals.updatedAt],
    queryFn: () => loadAnalytics(getServices(), { dayBoundaryHour: boundary }, goals, weeks),
  });
}
