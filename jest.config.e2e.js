module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testRunner: 'jest-circus/runner',
  testMatch: ['**/tests/e2e/**/*.spec.ts'],
  setupFiles: ['<rootDir>/tests/e2e/setup.ts'],
  globalSetup: '<rootDir>/jest.globalSetup.js',
  globalTeardown: '<rootDir>/jest.globalTeardown.js',



  // A longer timeout is needed for E2E tests that involve network and async operations.
  testTimeout: 60000,
};
