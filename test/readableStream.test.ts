import {CUSTOM_INSPECT, type InspectOptions} from '../src/inspect.ts';
import {assert, expect, test} from 'vitest';
import {DataViewReadableStream} from '../src/readableStream.ts';

async function withNo16(f: () => Promise<void> | void): Promise<void> {
  const {f16round} = Math;
  const {setFloat16} = DataView.prototype;

  // @ts-expect-error Hack.
  delete Math.f16round;
  // @ts-expect-error Hack.
  delete DataView.prototype.setFloat16;

  await f();

  // eslint-disable-next-line require-atomic-updates
  Math.f16round = f16round;
  // eslint-disable-next-line no-extend-native, require-atomic-updates
  DataView.prototype.setFloat16 = setFloat16;
}

function f32(n: number): number {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setUint32(0, n);
  return dv.getFloat32(0);
}

async function assertReads(
  r: ReadableStreamDefaultReader<Uint8Array>,
  expected: number[][]
): Promise<void> {
  for (const exp of expected) {
    const {value, done} = await r.read();
    assert(!done);
    assert.deepEqual(value, new Uint8Array(exp));
  }
}

test('basics', async () => {
  assert.throws(() => {
    // @ts-expect-error No public constructor.
    // eslint-disable-next-line no-new
    new DataViewReadableStream({});
  });
  await expect(DataViewReadableStream.create({chunkSize: 4})).rejects.toThrow(/Invalid number/);
  await expect(DataViewReadableStream.create({chunkSize: -1})).rejects.toThrow(/Invalid number/);
  await expect(DataViewReadableStream.create({chunkSize: 10.1})).rejects.toThrow(/Invalid number/);
  await expect(DataViewReadableStream.create({chunkSize: Infinity})).rejects.toThrow(/Invalid number/);
  await expect(DataViewReadableStream.create({chunkSize: NaN})).rejects.toThrow(/Invalid number/);

  const w = await DataViewReadableStream.create({chunkSize: 8});
  assert(w);
  const r = w.getReader();
  w.utf8('abcdefghi');
  w.bytes(new Uint8Array([1, 2, 3]));
  await assertReads(r, [
    [97, 98, 99, 100, 101, 102, 103, 104, 105],
    [1, 2, 3],
  ]);

  w.u8(12)
    .u16(0x3456)
    .u32(1)
    .u32(2)
    .flush();
  await assertReads(r, [
    [12, 0x34, 0x56, 0, 0, 0, 1],
    [0, 0, 0, 2],
  ]);

  w.i8(-1)
    .i16(-1)
    .i32(-1)
    .flush();
  await assertReads(r, [
    [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF],
  ]);

  w.u64(1)
    .u64(1n)
    .i64(-1)
    .i64(-1n)
    .flush();
  await assertReads(r, [
    [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01],
    [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01],
    [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF],
    [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF],
  ]);

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

  const w2 = await DataViewReadableStream.create();
  w2.ascii('abc')
    .utf8('def')
    .end();
  assert.deepEqual(await w2.read(), new Uint8Array([
    0x61, 0x62, 0x63, 0x64, 0x65, 0x66,
  ]));

  assert.throws(() => w2.ascii('e\u0308'));
});

test('writer floats', async () => {
  const w = await DataViewReadableStream.create();
  assert.throws(() => w.f16(1.1));
  assert.throws(() => w.f16(65536));
  assert.throws(() => w.f32(1.1));

  w.f16(1.25)
    .f16(-0)
    .f16(5.9604644775390625e-8)
    .f16(NaN)
    .f16(Infinity)
    .f32(0)
    .f64(0)
    .end();
  assert.deepEqual(await w.read(), new Uint8Array([
    0x3d, 0,
    0x80, 0,
    0, 1,
    0x7e, 0,
    0x7c, 0,
    0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
  ]));

  withNo16(async () => {
    const w2 = await DataViewReadableStream.create();

    assert.throws(() => w2.f16(1.1));
    assert.throws(() => w2.f16(65536));
    assert.throws(() => w2.f16(f32(0x00000001)));
    assert.throws(() => w2.f16(f32(0x38002000)));

    w2.f16(1.25)
      .f16(-0)
      .f16(5.9604644775390625e-8)
      .f16(NaN)
      .f16(Infinity)
      .end();
    assert.deepEqual(await w2.read(), new Uint8Array([
      0x3d, 0,
      0x80, 0,
      0, 1,
      0x7e, 0,
      0x7c, 0,
    ]));
  });
});

test('writer read coalescing', async () => {
  const w = await DataViewReadableStream.create({
    chunkSize: 9,
    copyBuffers: true,
  });
  w.u64(1)
    .u64(2)
    .bytes(new Uint8Array([0]))
    .bytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))
    .end();
  assert.deepEqual(await w.read(), new Uint8Array([
    0, 0, 0, 0, 0, 0, 0, 1,
    0, 0, 0, 0, 0, 0, 0, 2,
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
  ]));
});

test('writer custom inspector', async () => {
  const w = (await DataViewReadableStream.create({chunkSize: 8}))
    .u8(12)
    .utf8('abc')
    .ascii('1234567890')
    .end();

  // Go through some gyrations so we don't have to include node:util.
  const opts: InspectOptions = {
    depth: 2,
    stylize(a: string): string {
      return a;
    },
  };

  assert.equal(w[CUSTOM_INSPECT](1, opts), 'DataViewReadableStream []');
  assert.equal(w[CUSTOM_INSPECT](-1, opts), '[DataViewReadableStream]');

  delete opts.depth;
  assert.equal(w[CUSTOM_INSPECT](1, opts), 'DataViewReadableStream []');

  assert.equal(w[CUSTOM_INSPECT](1, opts), 'DataViewReadableStream []');

  const w2 = await DataViewReadableStream.create();
  w2.u8(13);
  assert.equal(w2[CUSTOM_INSPECT](1, opts), 'DataViewReadableStream [0x0d]');

  const w3 = await DataViewReadableStream.create({chunkSize: 8});
  w3.ascii('abc').u8(14);
  assert.equal(w3[CUSTOM_INSPECT](1, opts), 'DataViewReadableStream [0x0e]');
});

test('cancel in startup', async () => {
  const w = await DataViewReadableStream.create();

  // This will fire cancel after start, because cancel is async.
  // But it gets the line covered, and if this changes in a future runtime
  // version, at least we'll see this assumption challenged.
  await w.cancel(new Error('test'));
  assert.throws(() => w.u8(12).flush());
});

test('littleEndian switching', async () => {
  const w = await DataViewReadableStream.create();
  assert.equal(w.littleEndian, false);
  w.u16(2, true);
  w.littleEndian = true;
  assert.equal(w.littleEndian, true);
  w.u16(3)
    .u16(4, false)
    .flush();
  await assertReads(w.getReader(), [
    [2, 0, 3, 0, 0, 4],
  ]);
});
