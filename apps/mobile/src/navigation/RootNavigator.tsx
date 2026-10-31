import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AssistantScreen } from '../screens/AssistantScreen';
import { GlassesScreen } from '../screens/GlassesScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { ModelsScreen } from '../screens/ModelsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{ headerShadowVisible: false }}
      >
        <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Models" component={ModelsScreen} options={{ title: 'Models' }} />
        <Stack.Screen
          name="Assistant"
          component={AssistantScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Glasses"
          component={GlassesScreen}
          options={{ title: 'Glasses' }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ title: 'Settings' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
