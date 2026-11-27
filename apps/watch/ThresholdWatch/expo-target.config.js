/**
 * Native watchOS companion app, generated into the Xcode project by @bacons/apple-targets at
 * `npx expo prebuild` (see apps/mobile/app.config.ts: root "../watch", match "ThresholdWatch").
 * Every Swift file in this directory (including Shared/) is compiled into the watch target.
 * Tests/ and Package.swift live outside this directory and are not part of the app.
 *
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = (config) => ({
  type: 'watch',
  name: 'ThresholdWatch',
  displayName: 'Threshold',
  bundleIdentifier: '.watchkitapp',
  deploymentTarget: '10.0',
  colors: {
    $accent: '#D9A55B',
  },
  frameworks: ['WatchConnectivity', 'UserNotifications', 'CoreMotion', 'HealthKit', 'CoreML'],
  entitlements: {
    'com.apple.security.application-groups': config.ios?.entitlements?.['com.apple.security.application-groups'] ?? [],
  },
});
