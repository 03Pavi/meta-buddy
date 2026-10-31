import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { findModel } from '../services/models/catalog';
import { modelOnPhone } from '../services/models/modelFile';

/**
 * Whether the chat model is on the phone. Checked each time the screen comes into focus, so a model downloaded on
 * the Models screen shows up as soon as the user comes back. Null while the check is running.
 */
export function useChatModelReady(modelId: string): boolean | null {
  const [ready, setReady] = useState<boolean | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      modelOnPhone(findModel(modelId)).then(state => {
        if (active) setReady(state === 'yes');
      });
      return () => {
        active = false;
      };
    }, [modelId]),
  );

  return ready;
}
