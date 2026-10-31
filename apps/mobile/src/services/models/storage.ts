import { Linking, PermissionsAndroid, Platform } from 'react-native';

// Android 11 (API 30) and later need "All files access" to write to shared folders such as Download.
const ALL_FILES_ACCESS_ACTION = 'android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION';
const ANDROID_11 = 30;

/** Shared folder that holds downloaded models. It stays on the phone when the app is removed. */
export const SHARED_MODELS_DIRECTORY = '/storage/emulated/0/Download/Buddy/models';

/** Reports whether the app can write to the shared models folder. */
export async function hasModelStorageAccess(
  writeProbe: (path: string) => Promise<void>,
  removeProbe: (path: string) => Promise<void>,
): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (Platform.Version < ANDROID_11) {
    const read = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE);
    const write = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
    return read && write;
  }
  // On Android 11+ a permission check cannot see All files access, so try a small write instead.
  const probe = `${SHARED_MODELS_DIRECTORY}/.access-check`;
  try {
    await writeProbe(probe);
    await removeProbe(probe).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/**
 * Asks for storage access. On Android 11+ this opens the All files access screen for Buddy and returns false,
 * because the user must switch it on and come back. The caller then checks again.
 */
export async function requestModelStorageAccess(hasAccess: () => Promise<boolean>): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (Platform.Version < ANDROID_11) {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
      PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
    ]);
    return (
      result[PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE] === PermissionsAndroid.RESULTS.GRANTED &&
      result[PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE] === PermissionsAndroid.RESULTS.GRANTED
    );
  }
  if (await hasAccess()) return true;
  // Some phones refuse the all-files screen. Buddy's own settings page is the fallback, and always opens.
  await Linking.sendIntent(ALL_FILES_ACCESS_ACTION, [{ key: 'package', value: 'com.buddy' }]).catch(() =>
    Linking.openSettings(),
  );
  return false;
}
