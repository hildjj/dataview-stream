import es6 from '@cto.af/eslint-config/es6.js';
import jsdoc from '@cto.af/eslint-config/jsdoc.js';
import json from '@cto.af/eslint-config/json.js';
import jts from '@cto.af/eslint-config/jsdoc_ts.js';
import markdown from '@cto.af/eslint-config/markdown.js';
import ts from '@cto.af/eslint-config/ts.js';

export default [
  {
    ignores: [
      'lib/**',
      'README.md/*.ts',
    ],
  },
  ...es6,
  ...ts,
  ...jsdoc,
  ...json,
  ...jts,
  ...markdown,
  {
    files: ['**/*.ts'],
    rules: {
      'n/file-extension-in-import': 'off',
      '@typescript-eslint/parameter-properties': 'off',
      '@stylistic/max-len': ['error', 80, {
        ignorePattern: '^\\s*\\/\\/ eslint-',
        ignoreRegExpLiterals: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
        ignoreUrls: true,
      }],
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      '@stylistic/array-element-newline': 'off',
    },
  },
];
