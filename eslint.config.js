import js from '@eslint/js';
import globals from 'globals';

const UI_ASSIGN_PROPS = ['textContent', 'innerText', 'innerHTML', 'title', 'placeholder', 'ariaLabel'];
const UI_OBJECT_KEYS = 'summary|label|message|text|title';
const NON_EMPTY_STRING = 'Literal[value=/\\S/]';
const HUMAN_TEXT = '[A-Za-z\\uAC00-\\uD7A3]';
// A quasi that is only an interpolation has an empty cooked value. Any other cooked text is static copy.
const STATIC_QUASI = 'TemplateElement[value.cooked=/[\\s\\S]+/]';

function panelUiStringSyntax() {
  const rules = [];
  const add = (selector, message) => rules.push({ selector, message });

  function flagTextArgument(callSelector, argumentIndex, what) {
    const arg = `arguments.${argumentIndex}`;
    add(`${callSelector}[${arg}.type="Literal"][${arg}.value=/\\S/]`, `Do not pass a string literal to ${what}. Use t().`);
    add(`${callSelector}[${arg}.type="TemplateLiteral"] > TemplateLiteral > ${STATIC_QUASI}`, `Do not pass a template with static text to ${what}. Use t().`);
    add(`${callSelector}[${arg}.type="BinaryExpression"] > BinaryExpression > ${NON_EMPTY_STRING}`, `Do not build ${what} by concatenating a string literal. Use t().`);
    add(`${callSelector}[${arg}.type="ConditionalExpression"] > ConditionalExpression > ${NON_EMPTY_STRING}`, `Do not pass a conditional string literal to ${what}. Use t().`);
    add(`${callSelector}[${arg}.type="ConditionalExpression"] > ConditionalExpression > TemplateLiteral > ${STATIC_QUASI}`, `Do not pass a conditional template with static text to ${what}. Use t().`);
  }

  function flagDirectText(callSelector, what) {
    add(`${callSelector} > ${NON_EMPTY_STRING}`, `Do not pass a string literal to ${what}. Use t().`);
    add(`${callSelector} > TemplateLiteral > ${STATIC_QUASI}`, `Do not pass a template with static text to ${what}. Use t().`);
    add(`${callSelector} > BinaryExpression > ${NON_EMPTY_STRING}`, `Do not build ${what} by concatenating a string literal. Use t().`);
    add(`${callSelector} > ConditionalExpression > ${NON_EMPTY_STRING}`, `Do not pass a conditional string literal to ${what}. Use t().`);
    add(`${callSelector} > ConditionalExpression > TemplateLiteral > ${STATIC_QUASI}`, `Do not pass a conditional template with static text to ${what}. Use t().`);
  }

  for (const prop of UI_ASSIGN_PROPS) {
    const assign = `AssignmentExpression[left.type="MemberExpression"][left.property.name="${prop}"]`;
    add(`${assign}[right.type="Literal"][right.value=/\\S/]`, `Do not assign a string literal to ${prop}. Use t().`);
    add(`${assign}[right.type="TemplateLiteral"] > TemplateLiteral > ${STATIC_QUASI}`, `Do not assign a template literal with static text to ${prop}. Use t().`);
    add(`${assign}[right.type="BinaryExpression"] BinaryExpression > ${NON_EMPTY_STRING}`, `Do not build ${prop} by concatenating a string literal. Use t().`);
    add(`${assign}[right.type="ConditionalExpression"] ConditionalExpression > ${NON_EMPTY_STRING}`, `Do not assign a conditional string literal to ${prop}. Use t().`);
    add(`${assign}[right.type="ConditionalExpression"] ConditionalExpression > TemplateLiteral > ${STATIC_QUASI}`, `Do not assign a conditional template with static text to ${prop}. Use t().`);
  }

  const setAttr = 'CallExpression[callee.type="MemberExpression"][callee.property.name="setAttribute"][arguments.0.type="Literal"][arguments.0.value=/^(?:title|aria-label|placeholder)$/]';
  add(`${setAttr}[arguments.1.type="Literal"][arguments.1.value=/\\S/]`, 'Do not pass a string literal to setAttribute for title, aria-label, or placeholder. Use t().');
  add(`${setAttr}[arguments.1.type="TemplateLiteral"] > TemplateLiteral > ${STATIC_QUASI}`, 'Do not pass a template with static text to setAttribute for title, aria-label, or placeholder. Use t().');
  add(`${setAttr}[arguments.1.type="BinaryExpression"] BinaryExpression > ${NON_EMPTY_STRING}`, 'Do not build a title, aria-label, or placeholder by concatenating a string literal. Use t().');
  add(`${setAttr}[arguments.1.type="ConditionalExpression"] ConditionalExpression > ${NON_EMPTY_STRING}`, 'Do not pass a conditional string literal to setAttribute for title, aria-label, or placeholder. Use t().');
  add(`${setAttr}[arguments.1.type="ConditionalExpression"] ConditionalExpression > TemplateLiteral > ${STATIC_QUASI}`, 'Do not pass a conditional template with static text to setAttribute for title, aria-label, or placeholder. Use t().');

  for (const key of [
    `Property[key.type="Identifier"][key.name=/^(?:${UI_OBJECT_KEYS})$/]`,
    `Property[key.type="Literal"][key.value=/^(?:${UI_OBJECT_KEYS})$/]`
  ]) {
    add(`${key}[value.type="Literal"][value.value=/\\S/]`, 'Do not use a string literal for summary, label, message, text, or title. Use t().');
    add(`${key}[value.type="TemplateLiteral"] > TemplateLiteral > TemplateElement[value.cooked=/${HUMAN_TEXT}/]`, 'Do not use a template literal with hardcoded text for summary, label, message, text, or title. Use t().');
    add(`${key}[value.type="BinaryExpression"] > BinaryExpression > ${NON_EMPTY_STRING}`, 'Do not build summary, label, message, text, or title by concatenating a string literal. Use t().');
    add(`${key}[value.type="ConditionalExpression"] > ConditionalExpression > ${NON_EMPTY_STRING}`, 'Do not use a conditional string literal for summary, label, message, text, or title. Use t().');
    add(`${key}[value.type="ConditionalExpression"] > ConditionalExpression > TemplateLiteral > TemplateElement[value.cooked=/${HUMAN_TEXT}/]`, 'Do not use a conditional template with hardcoded text for summary, label, message, text, or title. Use t().');
  }

  // Locale keys such as 'patch.cancelled' have no spaces. Sentences and Korean copy do.
  add(
    'CallExpression[callee.type="Identifier"][callee.name!="t"] > Literal[value=/\\s|[\\uAC00-\\uD7A3]/]',
    'Do not pass a hardcoded UI sentence to a function. Use t().'
  );
  add(
    `CallExpression[callee.type="Identifier"][callee.name!="t"] > TemplateLiteral > TemplateElement[value.cooked=/\\s|${HUMAN_TEXT}/]`,
    'Do not pass a template with hardcoded UI text to a function. Use t().'
  );

  flagTextArgument(
    'CallExpression[callee.type="Identifier"][callee.name=/^(?:alert|confirm)$/]',
    0,
    'alert or confirm'
  );
  flagDirectText(
    'CallExpression[callee.type="MemberExpression"][callee.property.name=/^(?:append|prepend)$/]',
    'append or prepend'
  );
  flagTextArgument(
    'CallExpression[callee.type="MemberExpression"][callee.property.name=/^(?:insertAdjacentHTML|insertAdjacentText)$/]',
    1,
    'insertAdjacentHTML or insertAdjacentText'
  );

  return rules;
}

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
      'no-restricted-syntax': ['error', ...panelUiStringSyntax()]
    }
  },
  {
    files: ['apps/panel/**/*.js', 'scripts/verify-panel-ui.js', 'tests/panel-project-busy.test.js', 'tests/panel-ui-verifier.test.js', 'tests/chatgpt-panel-ui.test.js'],
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
