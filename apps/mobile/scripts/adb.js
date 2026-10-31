// Runs adb from the Android SDK platform-tools. Uses ANDROID_HOME when set, otherwise the Android Studio default.
// Usage: node scripts/adb.js devices
const { spawnSync } = require('child_process');
const path = require('path');

const sdk = process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
const adb = path.join(sdk, 'platform-tools', 'adb.exe');
const result = spawnSync(adb, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) {
  console.error(`Could not run adb at ${adb}. Set ANDROID_HOME to your Android SDK folder.`);
  process.exit(1);
}
process.exit(result.status ?? 1);
