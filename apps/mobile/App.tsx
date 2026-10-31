import React from 'react';
import { View } from 'react-native';
import { useFonts } from 'expo-font';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppShell } from './src/app/AppShell';
import { palette } from './src/components/theme';

export default function App() {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
  });

  // Show the theme background until the fonts are ready, so text never appears in the wrong font.
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: palette.background }} />;

  return (
    <SafeAreaProvider>
      <AppShell />
    </SafeAreaProvider>
  );
}
