import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-constant-condition': ['error', { checkLoops: false }]
    }
  },
  {
    files: ['apps/panel/**/*.js', 'scripts/verify-panel-ui.js', 'tests/panel-project-busy.test.js', 'tests/chatgpt-panel-ui.test.js'],
    languageOptions: {
      globals: {
        ...globals.browser
      }
    }
  },
  {
    ignores: [
      'node_modules/**',
      'workspaces/**',
      '.git/**',
      'coverage/**',
      'dist/**'
    ]
  }
];
