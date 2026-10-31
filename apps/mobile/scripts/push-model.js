// Copies a local Gemma GGUF file to the app's external models folder on a USB-connected Android phone.
// Usage: npm run model:push -- path/to/gemma-3-1b-it-Q8_0.gguf
const { spawnSync } = require('child_process');
const path = require('path');

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run model:push -- <path to .gguf file>');
  process.exit(1);
}

const sdk = process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
const adb = path.join(sdk, 'platform-tools', 'adb.exe');
const remoteDir = '/sdcard/Android/data/com.buddy/files/models';

for (const args of [['shell', 'mkdir', '-p', remoteDir], ['push', file, `${remoteDir}/`]]) {
  const result = spawnSync(adb, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('Model copied. Check it in Settings → AI model.');
