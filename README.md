# dataview-stream

Description

## Installation

```sh
npm install dataview-stream
```

## API

Full [API documentation](http://hildjj.github.io/dataview-stream/) is available.

Supported read methods:

- `bytes(len)`
- `ascii(len)`
- `utf8(len)`
- `u8()`
- `u16()`
- `u32()`
- `u64()`
- `i8()`
- `i16()`
- `i32()`
- `i64()`
- `f16()`
- `f32()`
- `f64()`

Each of those reads the appropriate number of bytes, then advances the read
position by that number of bytes.  An exception will be thrown if you go past
the end of the input.

Example:

```ts
import {DataViewReader, DataViewWriter, Packet} from 'dataview-stream';

const buf = new Uint8Array([1, 2, 3, 4]);
const dvs = new DataViewReader(buf);

dvs.u8(); // 0x01
dvs.u16(); // 0x0203
dvs.reset(); // Go back to the beginning
dvs.u32(); // 0x01020304

const dvw = new DataViewWriter();
dvw.u8(1).u16(0x0203);
dvw.read(); // Returns new Uint8([0x01, 0x02, 0x03])

/**
 * @typedef {object} Foo
 * @property {number} bar
 */

dvs.reset();

interface Foo {
  foo: number;
  last: Uint8Array;
}

interface Temp {
  bar: number;
}

const pkt = new Packet<Foo, Temp>(dvs);
pkt.u8('foo').u8('bar', {temp: true}).bytes(pkt.temp.bar)
console.log(pkt.packet); // {foo: 1, last: new Uint8Array([0x03, 0x04])}
console.log(pkt.temp); // {bar: 2}
```

---
[![Tests](https://github.com/hildjj/dataview-stream/actions/workflows/node.js.yml/badge.svg)](https://github.com/hildjj/dataview-stream/actions/workflows/node.js.yml)
[![codecov](https://codecov.io/gh/hildjj/dataview-stream/graph/badge.svg?token=ZC97U0AI06)](https://codecov.io/gh/hildjj/dataview-stream)
