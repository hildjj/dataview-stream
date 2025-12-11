import {assert, describe, expect, test} from 'vitest';
import {DataViewWritableStream} from '../src/writableStream.ts';
import {TruncationError} from '../src/errors.ts';

const TE = new TextEncoder();

describe('DataViewWritableStream', () => {
  test('create', async () => {
    const n = new DataViewWritableStream('foo');
    assert(n);
    assert.deepEqual(await n.peek(1), new Uint8Array([0x66]));
    assert.equal(n.length, 3);
    assert.equal(n.offset, 0);
    const b = await n.bytes(1);
    assert.deepEqual(b, new Uint8Array([102]));
    assert.equal(n.length, 2);
    assert.equal(n.offset, 1);
    await expect(n.bytes(10)).rejects.toThrow(TruncationError);
    assert.deepEqual(await n.bytes(0), new Uint8Array(0));
  });

  test('create w buffer', () => {
    const n = new DataViewWritableStream({input: TE.encode('foo')});
    assert.equal(n.length, 3);
  });

  test('bad inputs', () => {
    assert.throws(() => new DataViewWritableStream({input: 1 as unknown as string}), /Unknown input type/);
  });

  test('write exact', async () => {
    const n = new DataViewWritableStream();
    const p = n.bytes(2);
    setTimeout(() => {
      n.getWriter().write(TE.encode('12'));
    }, 100);
    assert.deepEqual(await p, new Uint8Array([49, 50]));
  });

  test('write multi', async () => {
    const n = new DataViewWritableStream();
    const p = n.bytes(3);
    setTimeout(async () => {
      const w = n.getWriter();
      await w.write(TE.encode('12'));
      await w.write(TE.encode('345'));
    }, 100);
    assert.deepEqual(await p, new Uint8Array([49, 50, 51]));
    assert.equal(n.length, 2);
    assert.equal(n.offset, 3);
  });

  test('waitFor errors', async () => {
    const n = new DataViewWritableStream();
    await expect(n.waitFor('0' as unknown as number)).rejects.toThrow(/Invalid size/);
    await expect(n.waitFor(-1)).rejects.toThrow(/Invalid size/);
    await expect(n.waitFor(1.1)).rejects.toThrow(/Invalid size/);
    await expect(n.waitFor(Infinity)).rejects.toThrow(/Invalid size/);
    await expect(n.waitFor(NaN)).rejects.toThrow(/Invalid size/);
    n.waitFor(1); // Don't wait
    await expect(n.waitFor(1)).rejects.toThrow(/Already waiting/);
  });

  test('close', async () => {
    const n = new DataViewWritableStream();
    const p = n.bytes(1);
    n.close();
    await expect(p).rejects.toThrow(TruncationError);
  });

  test('abort before', async () => {
    const n = new DataViewWritableStream();
    n.abort(new Error('Expected test error'));
    await new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        expect(n.waitFor(1)).rejects.toThrow(/Message truncated, 1 > 0 at 0/)
          .then(resolve, reject);
      }, 100);
    });
  });

  test('abort after', async () => {
    const n = new DataViewWritableStream();
    setTimeout(() => {
      n.abort(new Error('Expected test error'));
    }, 100);
    await expect(n.waitFor(1)).rejects.toThrow(/Expected test error/i);
  });

  test('typed read', async () => {
    const input = new Uint8Array([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
    const n = new DataViewWritableStream(input);
    assert.equal(await n.u8(), 0);
    assert.equal(await n.u16(), 0x0102);
    assert.equal(await n.u16(true), 0x0403);
    assert.equal(await n.u32(), 0x05060708);
    assert.equal(await n.u32(true), 0x0c0b0a09);

    const n2 = new DataViewWritableStream({input, littleEndian: true});
    assert.equal(await n2.u64(), 0x0706050403020100n);
    assert.equal(await n2.u64(false), 0x08090a0b0c0d0e0fn);

    const n3 = new DataViewWritableStream({input, ignoreUTF8errors: true});
    assert.equal(await n3.i8(), 0);
    assert.equal(await n3.i16(), 0x0102);
    assert.equal(await n3.i32(), 0x03040506);
    assert.equal(await n3.i64(), 0x0708090a0b0c0d0en);
    assert.equal(await n3.utf8(1), '\x0f');

    const n4 = new DataViewWritableStream(input);
    assert.equal(await n4.f16(), 5.960464477539063e-8);
    assert.equal(await n4.f32(), 9.625513546253311e-38);
    assert.equal(await n4.f64(), 1.2688028550867148e-279);
    assert.equal(await n4.ascii(2), '\x0e\x0f');
  });

  test('endianness', async () => {
    const input = new Uint8Array([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    const n = new DataViewWritableStream({input, littleEndian: true});
    assert.equal(n.littleEndian, true);
    assert.equal(await n.u16(), 0x0100);
    assert.equal(await n.u16(false), 0x0203);
    n.littleEndian = false;
    assert.equal(n.littleEndian, false);
    assert.equal(await n.u16(), 0x0405);
    assert.equal(await n.u16(true), 0x0706);
  });

  test('struct', async () => {
    const input = new Uint8Array([
      0xfe, 0xff,
      0xff, 0xfe,
      0xff,
      0, 1,
      0x61, 0x62, 0x63, 0x64,
      2, 3, 4, 5, 6, 7, 8, 9,
      0x01, 0x62, 0x63, 0x64, 0x65,
    ]);
    const n = new DataViewWritableStream(input);

    const desc = {
      two: {read: 'u16', littleEndian: true},
    } as const;
    assert.deepEqual(await n.struct(desc), {
      two: 0xfffe,
    });
    assert.deepEqual(await n.struct(desc), {
      two: 0xfeff,
    });

    const res = await n.struct({
      one: {read: 'u8'},
      two: {read: 'u16'},
      four: {read: 'u32'},
      big: {read: 'u64'},
      _len: {read: 'u8'},
      asc: {read: 'ascii', length: t => t.len as number},
      up: {read: 'ascii', length: () => 1, convert: v => v.toUpperCase()},
      by: {read: 'bytes', length: () => 1},
      tes: {read: 'bytes', length: () => 1, convert: v => v.map(b => b * 2)},
      cons: {read: 'constant', value: () => false},
      empty: {read: 'bytes', length: () => 0},
    }, input.length - 4);
    assert.deepEqual(res, {
      one: 0xff,
      two: 0x0001,
      four: 0x61626364,
      big: 0x0203040506070809n,
      asc: 'b',
      up: 'C',
      by: new Uint8Array([0x64]),
      tes: new Uint8Array([0xCA]),
      cons: false,
      empty: new Uint8Array(),
    });
    await expect(n.struct({
      byt: {read: 'bytes', length: () => 10},
    })).rejects.toThrow(/Invalid read method for implicit size/);
    await expect(n.struct({
      byt: {read: 'bytes', length: () => 10},
    }, 10)).rejects.toThrow(/Message truncated/);
  });
});
