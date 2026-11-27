/** Unit/integration tests for services, repositories and stores (no device required). */
module.exports = {
  preset: 'jest-expo/ios',
  testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.test.tsx'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|react-native-svg|@threshold/.*|zod)',
  ],
  setupFiles: ['<rootDir>/tests/support/setup.ts'],
  testEnvironment: 'node',
};
