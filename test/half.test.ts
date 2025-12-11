import {assert, test} from 'vitest';
import {halfToUint, parseHalf} from '../src/half.ts';

// Requires NODE_OPTIONS=--experimental-json-modules on node 20.
import f16 from './data/f16.json' with {type: 'json'};
import {withNo16} from './utils.ts';

test('full f16', () => {
  withNo16(() => {
    const buf = new Uint8Array(2);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    for (const [hex, expected] of Object.entries(f16)) {
      const u16 = parseInt(hex, 16);
      dv.setUint16(0, u16);

      const actual = parseHalf(dv, 0);
      const expectedF = parseFloat(expected);
      assert(Object.is(actual, expectedF));
      if (!isNaN(expectedF)) {
        assert.equal(halfToUint(expectedF), u16);
      }
    }
  });
});

test('littleEndian', () => {
  const buf = new Uint8Array([1, 0]);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  assert.equal(
    parseHalf(dv, undefined, true),
    5.960464477539063e-8
  );
});

