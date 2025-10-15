import {CUSTOM_INSPECT, type InspectOptions} from '../src/inspect.ts';
import {assert, test} from 'vitest';
import {DataViewWriter} from '../src/writer.ts';

function withNo16(f: () => void): void {
  const {f16round} = Math;
  const {setFloat16} = DataView.prototype;

  // @ts-expect-error Hack.
  delete Math.f16round;
  // @ts-expect-error Hack.
  delete DataView.prototype.setFloat16;

  f();

  Math.f16round = f16round;
  // eslint-disable-next-line no-extend-native
  DataView.prototype.setFloat16 = setFloat16;
}

function f32(n: number): number {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setUint32(0, n);
  return dv.getFloat32(0);
}

test('DataViewWriter', () => {
  const w = new DataViewWriter({chunkSize: 8});
  assert(w);
  assert.equal(w.length, 0);
  assert.deepEqual(w.read(), new Uint8Array(0));
  assert.throws(() => new DataViewWriter({chunkSize: 4}));
  assert.throws(() => new DataViewWriter({chunkSize: -1}));
  assert.throws(() => new DataViewWriter({chunkSize: 10.1}));
  assert.throws(() => new DataViewWriter({chunkSize: Infinity}));
  assert.throws(() => new DataViewWriter({chunkSize: NaN}));
  w.utf8('abcdefghi');
  assert.equal(w.length, 9);
  assert.deepEqual(w.peek(), new Uint8Array([
    97, 98, 99, 100, 101, 102, 103, 104, 105,
  ]));
  w.write(new Uint8Array([1, 2, 3]));
  assert.deepEqual(w.read(), new Uint8Array([
    97, 98, 99, 100, 101, 102, 103, 104, 105, 1, 2, 3,
  ]));

  w.write(new Uint8Array([1, 2, 3]));
  assert.deepEqual(w.peek(), new Uint8Array([1, 2, 3]));
  assert.deepEqual(w.read(), new Uint8Array([1, 2, 3]));
  assert.deepEqual(w.read(), new Uint8Array(0));

  w.u8(12)
    .u16(0x3456)
    .u32(1)
    .u32(2);
  assert.deepEqual(w.read(), new Uint8Array([
    12, 0x34, 0x56, 0, 0, 0, 1, 0, 0, 0, 2,
  ]));

  w.i8(-1)
    .i16(-1)
    .i32(-1);
  assert.deepEqual(w.read(), new Uint8Array([
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
  ]));

  w.u64(1)
    .u64(1n)
    .i64(-1)
    .i64(-1n);
  assert.deepEqual(w.read(), new Uint8Array([
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
  ]));

  assert.throws(() => w.u8(-1));
  assert.throws(() => w.u16(-1));
  assert.throws(() => w.u32(-1));
  assert.throws(() => w.u8(256));
  assert.throws(() => w.u16(0x10000));
  assert.throws(() => w.u32(0x100000000));
  assert.throws(() => w.u8(1.1));
  assert.throws(() => w.u16(1.1));
  assert.throws(() => w.u32(1.1));

  assert.throws(() => w.i8(-257));
  assert.throws(() => w.i16(-32769));
  assert.throws(() => w.i32(0x80000000));

  const w2 = new DataViewWriter();
  w2.ascii('abc');
  assert.deepEqual(w2.read(), new Uint8Array([0x61, 0x62, 0x63]));

  assert.throws(() => w2.ascii('e\u0308'));
});

test('writer floats', () => {
  const w = new DataViewWriter();

  w.f16(1.25)
    .f16(-0)
    .f16(5.9604644775390625e-8)
    .f16(NaN)
    .f16(Infinity)
    .f32(0)
    .f64(0);
  assert.deepEqual(w.read(), new Uint8Array([
    0x3d, 0,
    0x80, 0,
    0, 1,
    0x7e, 0,
    0x7c, 0,
    0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
  ]));
  assert.throws(() => w.f16(1.1));
  assert.throws(() => w.f16(65536));
  assert.throws(() => w.f32(1.1));

  withNo16(() => {
    w.f16(1.25)
      .f16(-0)
      .f16(5.9604644775390625e-8)
      .f16(NaN)
      .f16(Infinity);
    assert.deepEqual(w.read(), new Uint8Array([
      0x3d, 0,
      0x80, 0,
      0, 1,
      0x7e, 0,
      0x7c, 0,
    ]));

    assert.throws(() => w.f16(1.1));
    assert.throws(() => w.f16(65536));
    assert.throws(() => w.f16(f32(0x00000001)));
    assert.throws(() => w.f16(f32(0x38002000)));
  });
});

test('writer read coalescing', () => {
  const w = new DataViewWriter({
    chunkSize: 9,
    copyBuffers: true,
  });
  w.u64(1);
  w.u64(2);
  assert.deepEqual(w.peek(), new Uint8Array([
    0, 0, 0, 0, 0, 0, 0, 1,
    0, 0, 0, 0, 0, 0, 0, 2,
  ]));
  w.write(new Uint8Array([0]));
  w.write(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
  assert.deepEqual(w.read(), new Uint8Array([
    0, 0, 0, 0, 0, 0, 0, 1,
    0, 0, 0, 0, 0, 0, 0, 2,
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
  ]));
});

test('writer custom inspector', () => {
  const w = new DataViewWriter({chunkSize: 8});
  w.u8(12);
  w.utf8('abc');

  // Go through some gyrations so we don't have to include node:util.
  const opts: InspectOptions = {
    depth: 2,
    stylize(a: string): string {
      return a;
    },
  };
  function inspect(a: any): string {
    return String(a); // Not ideal, returns [object Object] for chunks
  }

  assert.equal(w[CUSTOM_INSPECT](1, opts, inspect), `DataViewWriter { length: 4, chunks: [
  0x0c616263
] }`);
  assert.equal(w[CUSTOM_INSPECT](-1, opts, inspect), '[DataViewWriter]');

  delete opts.depth;
  assert.equal(w[CUSTOM_INSPECT](1, opts, inspect), `DataViewWriter { length: 4, chunks: [
  0x0c616263
] }`);
});
