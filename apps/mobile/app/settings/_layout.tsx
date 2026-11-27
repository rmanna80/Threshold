import { Stack } from 'expo-router';
import { colors } from '../../theme';

export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.accent,
        headerTitleStyle: { color: colors.textPrimary },
        contentStyle: { backgroundColor: colors.background },
        headerBackTitle: 'Back',
      }}
    >
      <Stack.Screen name="goals" options={{ title: 'Goals' }} />
      <Stack.Screen name="preferences" options={{ title: 'Preferences' }} />
      <Stack.Screen name="privacy" options={{ title: 'Permissions & consent' }} />
      <Stack.Screen name="data" options={{ title: 'Your data' }} />
      <Stack.Screen name="sync" options={{ title: 'Cloud sync' }} />
      <Stack.Screen name="about" options={{ title: 'About' }} />
      <Stack.Screen name="research" options={{ title: 'Research' }} />
    </Stack>
  );
}
