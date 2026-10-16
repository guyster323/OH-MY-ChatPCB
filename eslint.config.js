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
    files: ['apps/panel/**/*.js'],
    rules: {
      'no-restricted-syntax': ['error',
        {
          selector: 'AssignmentExpression[left.type="MemberExpression"][left.property.name="textContent"][right.type="Literal"]',
          message: 'Do not assign a string literal to textContent. Use t().'
        },
        {
          selector: 'AssignmentExpression[left.type="MemberExpression"][left.property.name="textContent"][right.type="TemplateLiteral"]',
          message: 'Do not assign a template literal to textContent. Use t().'
        },
        {
          selector: 'AssignmentExpression[left.type="MemberExpression"][left.property.name="innerText"][right.type="Literal"]',
          message: 'Do not assign a string literal to innerText. Use t().'
        },
        {
          selector: 'AssignmentExpression[left.type="MemberExpression"][left.property.name="innerText"][right.type="TemplateLiteral"]',
          message: 'Do not assign a template literal to innerText. Use t().'
        }
      ]
    }
  },
  {
    files: ['apps/panel/**/*.js', 'scripts/verify-panel-ui.js', 'tests/panel-project-busy.test.js'],
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
