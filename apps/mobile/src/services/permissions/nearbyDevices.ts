import { PermissionsAndroid, Platform } from 'react-native';

/** Android 12 (API 31) split Bluetooth into scan and connect permissions. Earlier versions grant them at install. */
const NEARBY_DEVICES = [
  PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
  PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
];

function needsRuntimeCheck(): boolean {
  return Platform.OS === 'android' && Platform.Version >= 31;
}

/** Whether Buddy may scan for and connect to nearby devices, without showing a prompt. */
export async function hasNearbyDevicesAccess(): Promise<boolean> {
  if (!needsRuntimeCheck()) return true;
  const results = await Promise.all(NEARBY_DEVICES.map(permission => PermissionsAndroid.check(permission)));
  return results.every(Boolean);
}

/** Shows the Android Nearby devices prompt when access is missing. Resolves true when access is granted. */
export async function requestNearbyDevicesAccess(): Promise<boolean> {
  if (await hasNearbyDevicesAccess()) return true;
  const results = await PermissionsAndroid.requestMultiple(NEARBY_DEVICES);
  return NEARBY_DEVICES.every(permission => results[permission] === PermissionsAndroid.RESULTS.GRANTED);
}
