import React, { useEffect } from 'react';
import { MetaWearables } from '../../modules/meta-wearables/src';
import { RootNavigator } from '../navigation/RootNavigator';
import { AssistantProvider } from '../state/AssistantProvider';
import { GlassesProvider, useGlasses } from '../state/GlassesProvider';
import { ModelDownloadProvider } from '../state/ModelDownloadProvider';
import { SettingsProvider, useSettings } from '../state/SettingsProvider';

/** Providers are nested so the assistant can use glasses state, and both can use settings. */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>
      <ModelDownloadProvider>
        <GlassesProvider>
          <AssistantProvider>{children}</AssistantProvider>
        </GlassesProvider>
      </ModelDownloadProvider>
    </SettingsProvider>
  );
}

/** App-level effects: initialise the SDK on launch and keep hands-free invocations in line with Settings. */
function AppEffects() {
  const { settings, loaded } = useSettings();
  const { state, actions } = useGlasses();

  useEffect(() => {
    if (MetaWearables.available) {
      actions.initialize();
    }
    // Initialise once at launch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loaded || !state.initialized) return;
    if (settings.voiceInvocations && !state.voiceInvocationsActive) {
      actions.startVoiceInvocations();
    }
    if (!settings.voiceInvocations && state.voiceInvocationsActive) {
      actions.stopVoiceInvocations();
    }
    // Only the setting and the initialised flag drive this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, state.initialized, settings.voiceInvocations]);

  return null;
}

export function AppShell() {
  return (
    <AppProviders>
      <AppEffects />
      <RootNavigator />
    </AppProviders>
  );
}
