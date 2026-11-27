import { Redirect, Tabs } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { ColorValue } from 'react-native';
import { useAppStore } from '../../stores/appStore';
import { colors } from '../../theme';

function icon(name: SFSymbol) {
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <SymbolView name={name} tintColor={typeof color === 'string' ? color : colors.textTertiary} size={size} />;
  }
  return TabIcon;
}

export default function TabsLayout() {
  const onboarded = useAppStore((s) => s.onboardingCompleted);
  if (!onboarded) return <Redirect href="/welcome" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: icon('sun.max') }} />
      <Tabs.Screen name="session" options={{ title: 'Session', tabBarIcon: icon('wineglass') }} />
      <Tabs.Screen name="insights" options={{ title: 'Insights', tabBarIcon: icon('chart.bar') }} />
      <Tabs.Screen name="recovery" options={{ title: 'Recovery', tabBarIcon: icon('bed.double') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('person.crop.circle') }} />
    </Tabs>
  );
}
