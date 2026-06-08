/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Only run the active test under src/. The known-good template in cached/ is
  // copied into src/ by the generator; it must not be collected from cached/.
  testMatch: ["<rootDir>/src/**/*.pact.test.ts"],
  // Pact spins up a mock server per test file; keep things serial and patient.
  testTimeout: 30000,
};
