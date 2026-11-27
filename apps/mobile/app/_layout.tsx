import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppText, Button } from '../components/ui';
import { useNotificationRouting } from '../hooks/useNotificationRouting';
import { bootstrap } from '../services/bootstrap';
import { queryClient } from '../services/queryClient';
import { colors, spacing } from '../theme';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [state, setState] = useState<'booting' | 'ready' | 'error'>('booting');
  useNotificationRouting(state === 'ready');

  const run = useCallback(() => {
    bootstrap()
      .then(() => setState('ready'))
      .catch((e: unknown) => {
        // Never log error payloads that could contain user data; the message is generic.
        console.error('Threshold failed to start', e instanceof Error ? e.name : 'unknown');
        setState('error');
      })
      .finally(() => void SplashScreen.hideAsync().catch(() => undefined));
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  const retry = () => {
    setState('booting');
    run();
  };

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          {state === 'ready' ? (
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="(onboarding)" />
              <Stack.Screen name="log-drink" options={{ presentation: 'modal' }} />
              <Stack.Screen name="edit-drink/[id]" options={{ presentation: 'modal' }} />
              <Stack.Screen name="scan-label" options={{ presentation: 'modal' }} />
              <Stack.Screen name="checkin" options={{ presentation: 'modal' }} />
              <Stack.Screen name="emergency" options={{ presentation: 'modal' }} />
              <Stack.Screen name="session/[id]" />
              <Stack.Screen name="settings" />
            </Stack>
          ) : state === 'error' ? (
            <View style={{ flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.lg }}>
              <AppText variant="title2">Threshold couldn’t open its secure storage</AppText>
              <AppText color={colors.textSecondary}>
                Your data has not been changed. Make sure your device is unlocked, then try again.
              </AppText>
              <Button label="Try again" onPress={retry} />
            </View>
          ) : (
            <View style={{ flex: 1, backgroundColor: colors.background }} accessibilityLabel="Loading Threshold" />
          )}
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
