import type { ConfigContext, ExpoConfig } from 'expo/config';

const APP_GROUP = 'group.com.comebacktechnologies.threshold';
const BUNDLE_ID = 'com.comebacktechnologies.threshold';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Threshold',
  slug: 'threshold',
  scheme: 'threshold',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  backgroundColor: '#0B0C0E',
  ios: {
    bundleIdentifier: BUNDLE_ID,
    // Required for code signing of the app and the watch target (Xcode → Signing & Capabilities).
    appleTeamId: process.env.APPLE_TEAM_ID,
    supportsTablet: false,
    deploymentTarget: '17.0',
    infoPlist: {
      NSHealthShareUsageDescription:
        'Threshold reads heart rate, heart rate variability, resting heart rate, respiratory rate and sleep to describe how your body responds around drinking sessions. Health data stays on your device unless you turn on cloud sync.',
      NSHealthUpdateUsageDescription:
        'Threshold does not write to Apple Health. This permission is requested only because the Health framework requires it to be declared.',
      NSMotionUsageDescription:
        'Threshold uses motion data on your Apple Watch only if you enable optional gesture research or detection features.',
      NSCameraUsageDescription:
        'Threshold uses the camera only when you choose to scan a beverage label. Photos are processed on your device and not stored.',
      ITSAppUsesNonExemptEncryption: false,
      UIBackgroundModes: ['remote-notification'],
    },
    entitlements: {
      'com.apple.security.application-groups': [APP_GROUP],
    },
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyCollectedDataTypes: [
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeHealth',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
      ],
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
        },
      ],
    },
  },
  plugins: [
    'expo-router',
    'expo-localization',
    'expo-secure-store',
    ['expo-sqlite', { useSQLCipher: true }],
    [
      'expo-notifications',
      {
        // Local notifications only; no remote push service is configured.
        enableBackgroundRemoteNotifications: false,
      },
    ],
    ['expo-camera', { cameraPermission: 'Threshold uses the camera only when you choose to scan a beverage label.' }],
    [
      '@kingstinct/react-native-healthkit',
      {
        NSHealthShareUsageDescription:
          'Threshold reads heart rate, HRV, resting heart rate, respiratory rate and sleep to describe how your body responds around drinking sessions.',
        NSHealthUpdateUsageDescription: 'Threshold does not write to Apple Health.',
        background: false,
      },
    ],
    ['expo-build-properties', { ios: { deploymentTarget: '17.0' } }],
    // Native watchOS companion app lives in apps/watch/ThresholdWatch and is linked at prebuild.
    ['@bacons/apple-targets', { root: '../watch', match: 'ThresholdWatch' }],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    appGroup: APP_GROUP,
  },
});
