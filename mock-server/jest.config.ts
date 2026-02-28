import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^@app/shared/(.*)$': '<rootDir>/../shared/src/$1',
    '^@faker-js/faker$': '<rootDir>/src/__mocks__/faker-cjs.js'
  }
};

export default config;
