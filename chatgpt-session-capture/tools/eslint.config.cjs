'use strict';

// Static check of the shipped extension sources: undefined globals, unused
// bindings and unreachable code. Run: tools/lint.sh

const shared = {
  console: 'readonly', chrome: 'readonly', crypto: 'readonly', globalThis: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly', Blob: 'readonly', File: 'readonly', Response: 'readonly',
  TextEncoder: 'readonly', CompressionStream: 'readonly', DataView: 'readonly', indexedDB: 'readonly',
  IDBKeyRange: 'readonly', btoa: 'readonly', location: 'readonly', navigator: 'readonly',
  CgscDB: 'readonly', CgscZip: 'readonly', CgscSanitize: 'readonly', CgscTurnMerge: 'readonly',
  CgscCaptureCore: 'readonly', CgscExport: 'readonly'
};
const dom = {
  window: 'readonly', document: 'readonly', getComputedStyle: 'readonly', Node: 'readonly', Element: 'readonly',
  NodeFilter: 'readonly', CSS: 'readonly', performance: 'readonly', caches: 'readonly', history: 'readonly',
  addEventListener: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly', fetch: 'readonly',
  Headers: 'readonly', Request: 'readonly', FormData: 'readonly', XMLHttpRequest: 'readonly', WebSocket: 'readonly',
  EventSource: 'readonly', confirm: 'readonly'
};

module.exports = [
  {
    files: ['**/*.js'],
    ignores: ['tests/**', 'tools/**'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...shared, ...dom, importScripts: 'readonly' }
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-redeclare': 'error',
      'no-const-assign': 'error',
      'no-self-assign': 'error',
      'no-unsafe-finally': 'error'
    }
  }
];
