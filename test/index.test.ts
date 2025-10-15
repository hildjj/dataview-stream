import {assert, test} from 'vitest';
import {DataViewReader} from '../src/index.ts';

test('index', () => {
  const dvr = new DataViewReader(new Uint8Array());
  assert(dvr);
});
