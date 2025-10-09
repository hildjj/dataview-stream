import assert from 'node:assert';
import {foo} from '../lib/index.js';
import test from 'node:test';

test('index', () => {
  assert.equal(foo(), 2);
});
