/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '\\.(e2e-spec|spec)\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { diagnostics: false, tsconfig: 'tsconfig.eslint.json' }],
  },
  testEnvironment: 'node',
  testTimeout: 120000,
  setupFiles: ['<rootDir>/test/jest-env.ts'],
  maxWorkers: 1,
};
