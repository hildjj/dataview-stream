import {assert, describe, test} from 'vitest';
import {DataViewReader} from '../src/reader.ts';
import {Packet} from '../src/packet.ts';

interface Foo {
  foo: number;
  bar: boolean;
  bop: number;
  blort: number;
  bytes: Uint8Array;
  ascii: string;
  utf8?: string;
  baz: Uint8Array;
  u64?: bigint;
  times?: number[];
}

interface Temp {
  len: number;
  bits: number;
}

describe('Packet', () => {
  test('create', () => {
    const r = new DataViewReader(new Uint8Array([
      0x01, 0x02, 0x03, 0x04,
      0x3, 0x61, 0x62, 0x63,
      0x64,
    ]));
    const p = new Packet<Foo, Temp>(r);
    p.u8('foo')
      .bits({from: 'foo', to: 'bar', start: 0})
      .u16('bop')
      .bits({from: 'bop', to: 'blort', start: 8, finish: 9})
      .bytes('bytes', 1)
      .u8('len', {temp: true, convert: i => i})
      .bits({fromTemp: 'len', toTemp: 'bits', start: 0, finish: 1})
      .ascii('ascii', p.temp.len)
      .maybe(false, () => p.utf8('utf8', 1))
      .maybe(true, () => p.utf8('utf8', 1))
      .unused('baz')
      .complete();
    assert.deepEqual(p.packet, {
      foo: 1,
      bar: true,
      bop: 0x0203,
      blort: 0x2,
      bytes: new Uint8Array([0x04]),
      ascii: 'abc',
      utf8: 'd',
      baz: new Uint8Array(0),
    });
    p.reset().u32('foo');
    assert.equal(p.packet.foo, 0x01020304);
    p.reset()
      .u64('u64')
      .bits({from: 'u64', to: 'foo', start: 63n, finish: 56n});
    assert.equal(p.packet.u64, 0x0102030403616263n);
    assert.equal(p.packet.foo, 1);
    p.reset()
      .i8('foo', {convert: i => i << 2})
      .i16('bop');
    assert.deepEqual(p.packet as object, {
      foo: 4,
      bop: 0x0203,
    });
    assert.equal(p.reset().i32('foo').packet.foo, 0x01020304);
    assert.equal(p.reset().i64('u64').packet.u64, 0x0102030403616263n);
    assert.equal(p.reset().f16('foo').packet.foo, 0.00001537799835205078);
    assert.equal(p.reset().f32('foo').packet.foo, 2.387939260590663e-38);
    assert.equal(p.reset().f64('foo').packet.foo, 8.20788035450169e-304);
    assert.deepEqual(p.reset().times('times', 4, () => r.u8()).packet.times, [
      0x01, 0x02, 0x03, 0x04,
    ]);
  });
});
