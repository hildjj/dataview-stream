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
import {DataViewReader} from 'dataview-stream';

const buf = new Uint8Array([1, 2, 3, 4, 5, 6]);
const dvs = new DataViewReader(buf);

dvs.u8(); // 0x01
dvs.u16(); // 0x0203
dvs.reset(); // Go back to the beginning
dvs.u32(); // 0x01020304

dvs.reset();

dvs.struct({
  foo: {read: 'u8'},
  _bar: {read: 'u8', convert: v => v * 2}, // Not output because initial _
  last: {read: 'bytes', length: temp => temp.bar as number}
}); // {foo: 1, last: new Uint8Array([3, 4, 5, 6])}

const dvw = new DataViewReader();
dvw.u8(1).u16(0x0203);
dvw.getReader().read(); // Returns new Uint8([0x01, 0x02, 0x03])
```

---
[![Tests](https://github.com/hildjj/dataview-stream/actions/workflows/node.js.yml/badge.svg)](https://github.com/hildjj/dataview-stream/actions/workflows/node.js.yml)
[![codecov](https://codecov.io/gh/hildjj/dataview-stream/graph/badge.svg?token=ZC97U0AI06)](https://codecov.io/gh/hildjj/dataview-stream)
