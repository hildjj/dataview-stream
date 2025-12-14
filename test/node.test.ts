/**
 * Tests that require node.js.
 *
 * @module
 */

import {DataViewReadableStream, DataViewWritableStream} from '../src/index.ts';
import {assert, describe, test} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import stream from 'node:stream';

interface TmpDirFixture {
  tmpdir: string;
}

async function createTempDir(): Promise<string> {
  const ostmpdir = os.tmpdir();
  const tmpdir = path.join(ostmpdir, 'unit-test-');
  return fs.mkdtemp(tmpdir);
}

export const tmpdirTest = test.extend<TmpDirFixture>({
  // eslint-disable-next-line no-empty-pattern
  tmpdir: async ({}, use): Promise<void> => {
    const directory = await createTempDir();

    await use(directory);

    await fs.rm(directory, {recursive: true});
  },
});

describe('node', () => {
  tmpdirTest('read/write', async ({tmpdir}) => {
    const nums = path.join(tmpdir, 'nums');
    const fw = await fs.open(nums, 'w');
    const w = stream.Writable.toWeb(fw.createWriteStream({autoClose: true}));
    const dvr = await DataViewReadableStream.create();
    dvr.pipeTo(w);
    for (let i = 0; i < 100; i++) {
      dvr.u32(i);
    }
    dvr.end();

    const fr = await fs.open(nums, 'r');
    const r = fr.readableWebStream({autoClose: true});
    const dvw = new DataViewWritableStream();
    r.pipeTo(dvw);
    const res = await dvw.u32();
    assert.equal(res, 0);
    const bytes = await dvw.bytes(20);
    assert.instanceOf(bytes, Uint8Array);
    assert.equal(bytes.length, 20);
  });
});
