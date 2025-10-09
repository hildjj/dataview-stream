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

```js
import {DataViewStream} from 'dataview-stream';

const buf = new Uint8Array([1, 2, 3, 4]);
const dvs = new DataViewStream(buf);

dvs.u8(); // 0x01
dvs.u16(); // 0x0203
dvs.reset(); // Go back to the beginning
dvs.u32(); // 0x01020304
```

---
[![Build Status](https://github.com/hildjj/dataview-stream/workflows/Tests/badge.svg)](https://github.com/hildjj/dataview-stream/actions?query=workflow%3ATests)
[![codecov](https://codecov.io/gh/hildjj/dataview-stream/branch/main/graph/badge.svg?token=N7B7YLIDM4)](https://codecov.io/gh/hildjj/dataview-stream)
