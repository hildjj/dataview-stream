import {DataViewStream, ExtraBytesError, TruncationError} from '../src/index.ts';
import {assert, test} from 'vitest';

function withNo16(f: () => void): void {
  const f16 = DataView.prototype.getFloat16;
  // @ts-expect-error Hack.
  delete DataView.prototype.getFloat16;

  f();

  // eslint-disable-next-line no-extend-native
  DataView.prototype.getFloat16 = f16;
}

test('DataViewStream', () => {
  const buf = new Uint8Array([
    0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  ]);
  assert.throws(() => new DataViewStream(buf, {offset: -1}), RangeError);
  assert.throws(() => new DataViewStream(buf, {offset: 100}), RangeError);
  assert.throws(() => new DataViewStream(buf, {offset: 2.1}), RangeError);

  const d = new DataViewStream(buf);
  assert(d);
  assert.equal(d.u8(), 0x61);
  assert.equal(d.u16(), 0x6263);
  assert.equal(d.offset, 3);
  assert.equal(d.original, buf);
  assert.throws(() => d.complete(), ExtraBytesError);
  d.seek(0);
  assert.throws(() => d.seek(-1), RangeError);
  assert.throws(() => d.seek(100), RangeError);
  d.seek(0);
  assert.equal(d.u32(), 0x61626364);
  d.reset();
  assert.equal(d.u64(), 0x6162636465666768n);
  d.reset();
  assert.equal(d.i8(), 0x61);
  d.reset();
  assert.equal(d.i16(), 0x6162);
  d.reset();
  assert.equal(d.i32(), 0x61626364);
  d.reset();
  assert.equal(d.i64(), 0x6162636465666768n);
  d.seek();
  assert.deepEqual(d.bytes(2), new Uint8Array([0x61, 0x62]));
  d.seek();
  assert.deepEqual(d.ascii(2), 'ab');
  assert.throws(() => d.ascii(30), TruncationError);
  d.reset();
  assert.equal(d.f16(), 689);
  d.reset();
  assert.equal(d.f32(), 26100787562286154e+4);
  d.reset();
  assert.equal(d.f64(), 1.2926117907728089e+161);
  d.reset();
  assert.equal(d.utf8(4), 'abcd');

  const d2 = new DataViewStream(new Uint8Array([0, 1]));
  assert.equal(d2.f16(), 5.960464477539063e-8);

  const d3 = new DataViewStream(new Uint8Array([0x7e, 0x00]));
  assert.isNaN(d3.f16());

  const d4 = new DataViewStream(new Uint8Array([0xfc, 0x00]));
  assert.equal(d4.f16(), -Infinity);
  withNo16(() => {
    d2.reset();
    assert.equal(d2.f16(), 5.960464477539063e-8);
    d3.reset();
    assert.isNaN(d3.f16());
    d4.reset();
    assert.equal(d4.f16(), -Infinity);
  });
});

test('littleEndian', () => {
  const buf = new Uint8Array([0x61, 0x62, 0x63, 0x64]);
  const d = new DataViewStream(buf, {
    littleEndian: true,
    offset: 0,
    ignoreUTF8errors: true,
  });
  assert.equal(d.f16(), 816.5);
  const d2 = new DataViewStream(new Uint8Array([1, 0]), {littleEndian: true});
  assert.equal(d2.f16(), 5.960464477539063e-8);

  withNo16(() => {
    d.reset();
    assert.equal(d.f16(), 816.5);
    d2.reset();
    assert.equal(d2.f16(), 5.960464477539063e-8);
  });
});
