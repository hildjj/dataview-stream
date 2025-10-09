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
    ],
  },
  ...es6,
  ...ts,
  ...jsdoc,
  ...json,
  ...jts,
  ...markdown,
];
