// CJS shim for @faker-js/faker — used by Jest (CommonJS mode) only.
// Provides the minimal API surface that seed.ts and factories.ts use.
'use strict';

function randomString(n) {
  return Math.random().toString(36).substring(2, 2 + n).padEnd(n, '0');
}

const faker = {
  seed: () => {},
  number: {
    int: ({ min = 0, max = 100 } = {}) =>
      Math.floor(Math.random() * (max - min + 1)) + min
  },
  person: {
    firstName: () => 'Jane',
    lastName: () => 'Doe'
  },
  date: {
    past: () => new Date('2025-01-01T00:00:00.000Z')
  },
  internet: {
    email: ({ firstName = 'jane', lastName = 'doe', provider = 'example.com' } = {}) =>
      `${firstName}.${lastName}@${provider}`.toLowerCase()
  },
  datatype: {
    boolean: ({ probability = 0.5 } = {}) => Math.random() < probability
  },
  helpers: {
    arrayElement: arr => arr[Math.floor(Math.random() * arr.length)]
  },
  string: {
    alphanumeric: (n = 10) => randomString(n)
  }
};

module.exports = { faker };
