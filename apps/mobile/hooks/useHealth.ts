import { DAY_MS } from '@threshold/core';
import { useQuery } from '@tanstack/react-query';
import { getServices } from '../services/container';

export function useBaselines() {
  return useQuery({
    queryKey: ['health', 'baselines'],
    queryFn: async () => {
      const s = getServices();
      return { available: await s.healthService.isAvailable(), baselines: await s.repos.baselines.listAll() };
    },
  });
}

export function useSleepNights(days = 30) {
  return useQuery({
    queryKey: ['health', 'sleep', days],
    queryFn: async () => {
      const s = getServices();
      const now = s.clock.now();
      return s.healthService.sleepNights(now - days * DAY_MS, now);
    },
  });
}

export function useMeasurementSeries(kind: 'resting_heart_rate' | 'hrv_sdnn', days = 30) {
  return useQuery({
    queryKey: ['health', 'series', kind, days],
    queryFn: async () => {
      const s = getServices();
      const now = s.clock.now();
      return s.repos.measurements.list([kind], now - days * DAY_MS, now);
    },
  });
}
