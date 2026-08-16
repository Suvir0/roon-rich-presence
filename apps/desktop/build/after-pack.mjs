import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const UNUSED_PRIVACY_KEYS = [
  'NSAppTransportSecurity',
  'NSAudioCaptureUsageDescription',
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription'
];

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const plistPath = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Info.plist'
  );

  for (const key of UNUSED_PRIVACY_KEYS) {
    const result = spawnSync('/usr/bin/plutil', ['-remove', key, plistPath], { encoding: 'utf8' });
    if (result.status !== 0 && !result.stderr.includes('Could not modify plist')) {
      throw new Error(`Could not remove unused macOS privacy key ${key}: ${result.stderr.trim()}`);
    }
  }
}
