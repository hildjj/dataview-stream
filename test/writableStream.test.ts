import {assert, expect, test} from 'vitest';
import {DataViewWritableStream} from '../src/writableStream.ts';

test('write stream', async () => {
  const t = new TextEncoderStream();
  const w = new DataViewWritableStream();
  t.readable.pipeTo(w);
  const wr = t.writable.getWriter();
  await wr.write('foo');
  await wr.write('bar');
  await wr.close();
  const td = new TextDecoder();
  assert.equal(td.decode(w.read()), 'foobar');
});

test('write error', async () => {
  const w = new DataViewWritableStream();
  const wr = w.getWriter();
  const bogus = {
    get length(): number {
      throw new Error('Forced error');
    },
  };
  // @ts-expect-error Testing.
  await expect(wr.write(bogus)).rejects.toThrow('Forced error');
});
