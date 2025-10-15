import {
  CUSTOM_INSPECT,
  type Inspect,
  type InspectOptions,
  u8toHex,
} from './inspect.ts';
import {halfToUint, isF16} from './half.ts';

export {
  isF16,
};

export interface WriterOptions {
  /**
   * How many bytes to allocate for each chunk?  Best case is that this number
   * is larger than your final size, so only one allocation has to happen and
   * no copies on read.
   * @default 4096
   */
  chunkSize?: number;

  /**
   * If true, Uint8Arrays passed in to write() will always have their current
   * state copied into the writer, even if they are larger than chunkSize.
   * @default false
   */
  copyBuffers?: boolean;

  /**
   * Do all reads as littleEndian, instead of network byte order (big endian).
   */
  littleEndian?: boolean;
}

export type RequiredWriterOptions = Required<WriterOptions>;

const TE = new TextEncoder();

/**
 * Is the number an integer in the given range, inclusive?
 *
 * @param n Number to check.
 * @param start First valid number.
 * @param end Last valid number.
 * @throws {RangeError} On invalid number.
 */
function intRange(
  n: number | bigint,
  start: number | bigint,
  end: number | bigint
): void {
  if (((typeof n !== 'bigint') && !Number.isSafeInteger(n)) || (n < start) || (n > end)) {
    throw new RangeError(`Invalid number ${n} for range ${start}..${end}`);
  }
}

/**
 * Write bytes to a growing buffer.  Intended for relatively-small final
 * buffer sizes; everything is held in memory.
 */
export class DataViewWriter {
  public static defaultOptions: RequiredWriterOptions = {
    chunkSize: 4096,
    copyBuffers: false,
    littleEndian: false,
  };

  #opts: RequiredWriterOptions;
  #chunks: Uint8Array[] = []; // Invariant: always at least one chunk.
  #dv: DataView | null = null; // View over last chunk.
  #offset = Infinity; // Use Infinity for "full".
  #length = 0;

  public constructor(opts: WriterOptions = {}) {
    this.#opts = {
      ...DataViewWriter.defaultOptions,
      ...opts,
    };
    intRange(this.#opts.chunkSize, 8, Number.MAX_SAFE_INTEGER);
    this.#alloc();
  }

  /**
   * Current number of bytes in the writer.
   *
   * @returns Length in bytes.
   */
  public get length(): number {
    return this.#length;
  }

  /**
   * Destructively read all bytes from the writer as a single buffer.
   * Could take some time if there are lots of chunks.
   *
   * @returns Bytes.
   */
  public read(): Uint8Array {
    const buf = this.#read(true);
    this.clear();
    return buf;
  }

  /**
   * Read the current contents of the writer as a single buffer, but does not
   * clear the current contents.  This has a side effect, which is to coalesce
   * multiple chunks into a single chunk, making subsequent read() and peek()
   * operations a little faster.  Note: there is no need to call peek() before
   * read() for performance, read() does the same coalescing, then throws away
   * the result.
   *
   * @returns Current contents of the writer.
   */
  public peek(): Uint8Array {
    return this.#read(false);
  }

  /**
   * Write an arbitrarily-large amount of data to the writer.  If this buffer
   * is larger than chunkSize, it is appended directly -- see the copyBuffers
   * option for what should happen in this case.  If the buffer is less than
   * the chunkSize + 8 bytes, the buffer is always copied, since it might be
   * worth writing some more data into that same chunk later.
   *
   * @param buf Bytes to write.
   * @param copy Override the copyBuffers option if specified.
   * @returns This, for chaining.
   */
  public write(buf: Uint8Array, copy = this.#opts.copyBuffers): this {
    const len = buf.length;
    if (len > this.#left()) {
      // Either we just started, we exactly filled the previous chunk, or the
      // previous chunk was from a write.
      if (this.#offset === 0) {
        this.#chunks.pop();
      } else {
        this.#trim();
      }
      if (len > (this.#opts.chunkSize - 8)) {
        // Won't fit, just re-use the existing buffer.
        this.#chunks.push(copy ? buf.slice() : buf);
        this.#offset = len;
        this.#dv = null;
      } else {
        this.#alloc();
        this.#chunks[this.#chunks.length - 1].set(buf, 0);
        this.#offset = len;
      }
    } else {
      // There is room left in the existing chunk
      this.#chunks[this.#chunks.length - 1].set(buf, this.#offset);
      this.#offset += len;
    }
    this.#length += len;
    return this;
  }

  /**
   * Write a single unsigned byte.
   *
   * @param n Byte.
   * @returns This, for chaining.
   */
  public u8(n: number): this {
    intRange(n, 0, 0xff);
    this.#makeSpace(1).setUint8(this.#offset, n);
    return this.#advance(1);
  }

  /**
   * Write a two-byte unsigned integer.
   *
   * @param n Unsigned short int.
   * @returns This, for chaining.
   */
  public u16(n: number): this {
    intRange(n, 0, 0xffff);
    this.#makeSpace(2).setUint16(this.#offset, n, this.#opts.littleEndian);
    return this.#advance(2);
  }

  /**
   * Write a four-byte unsigned integer.
   *
   * @param n Unsigned int.
   * @returns This, for chaining.
   */
  public u32(n: number): this {
    intRange(n, 0, 0xffffffff);
    this.#makeSpace(4).setUint32(this.#offset, n, this.#opts.littleEndian);
    return this.#advance(4);
  }

  /**
   * Write an eight-byte unsigned integer.
   *
   * @param n Unsigned long long.
   * @returns This, for chaining.
   */
  public u64(n: bigint | number): this {
    intRange(n, 0n, 0xffffffffffffffffn);
    this.#makeSpace(8)
      .setBigUint64(this.#offset, BigInt(n), this.#opts.littleEndian);
    return this.#advance(8);
  }

  /**
   * Write a signed byte.
   *
   * @param n Signed byte.
   * @returns This, for chaining.
   */
  public i8(n: number): this {
    intRange(n, -0x80, 0x7f);
    this.#makeSpace(1).setInt8(this.#offset, n);
    return this.#advance(1);
  }

  /**
   * Write a signed two-byte integer.
   *
   * @param n Signed short int.
   * @returns This, for chaining.
   */
  public i16(n: number): this {
    intRange(n, -0x8000, 0x7fff);
    this.#makeSpace(2).setInt16(this.#offset, n, this.#opts.littleEndian);
    return this.#advance(2);
  }

  /**
   * Write a signed four-byte integer.
   *
   * @param n Signed int.
   * @returns This, for chaining.
   */
  public i32(n: number): this {
    intRange(n, -0x80000000, 0x7fffffff);
    this.#makeSpace(4).setInt32(this.#offset, n, this.#opts.littleEndian);
    return this.#advance(4);
  }

  /**
   * Write an eight-byte signed integer.
   *
   * @param n Signed long long.
   * @returns This, for chaining.
   */
  public i64(n: bigint | number): this {
    intRange(n, -0x8000000000000000n, 0x7fffffffffffffffn);
    this.#makeSpace(8)
      .setBigInt64(this.#offset, BigInt(n), this.#opts.littleEndian);
    return this.#advance(8);
  }

  /**
   * Write a two-byte float.
   *
   * @param n Number that fits in a short float without losing precision.
   * @returns This, for chaining.
   * @throws {RangeError} If number would lose precision on write.
   */
  public f16(n: number): this {
    if (!isF16(n)) {
      throw new RangeError('Casting this number to float16 would lose precision');
    }
    const dv = this.#makeSpace(2);
    if (dv.setFloat16) {
      // New in node v24.
      dv.setFloat16(this.#offset, n, this.#opts.littleEndian);
    } else {
      dv.setUint16(
        this.#offset,
        halfToUint(n) as number,
        this.#opts.littleEndian
      );
    }
    return this.#advance(2);
  }

  /**
   * Write a four-byte float.
   *
   * @param n Number that fits in a float.
   * @returns This, for chaining.
   * @throws {RangeError} Would lose precision.
   */
  public f32(n: number): this {
    if (!Object.is(n, Math.fround(n))) { // -0, NaN
      throw new RangeError('Casting this number to float32 would lose precision');
    }
    this.#makeSpace(4).setFloat32(this.#offset, n, this.#opts.littleEndian);
    return this.#advance(4);
  }

  /**
   * Write an eight-byte integer.
   *
   * @param n Double.
   * @returns This, for chaining.
   */
  public f64(n: number): this {
    this.#makeSpace(8).setFloat64(this.#offset, n, this.#opts.littleEndian);
    return this.#advance(8);
  }

  /**
   * Encode the string as UTF8.
   *
   * @param s String.  If there are unpaired surrogates, they will be switched
   *   to the replacement character.
   * @returns This, for chaining.
   */
  public utf8(s: string): this {
    return this.write(TE.encode(s), false);
  }

  /**
   * Convert a string to ASCII bytes.
   *
   * @param s Latin-1 string.
   * @returns This, for chaining.
   * @throws {RangeError} Character not in 0-256.
   */
  public ascii(s: string): this {
    const {length} = s; // For ASCII, length is bytes.
    const buf = Uint8Array.from({length}, (_, i) => {
      const cp = s.charCodeAt(i);
      if (cp > 0xff) {
        throw new RangeError(`Invalid ASCII character: "${String.fromCharCode(cp)}" (U+${cp.toString(16).padStart(4, '0')})`);
      }
      return cp;
    });
    return this.write(buf, false);
  }

  /**
   * Clear all of the existing data.
   *
   * @returns This, for chaining.
   */
  public clear(): this {
    this.#length = 0;
    this.#chunks = [];
    this.#alloc();
    return this;
  }

  /**
   * When outputting with `console.log('%O', this)` or at the node REPL,
   * see the current chunk structure.
   *
   * @param depth Current depth.
   * @param options Options for writing, generated by util.inpect.
   * @param inspect Local copy of util.inspect, so there is no node dependency.
   * @returns Formatted string.
   */
  public [CUSTOM_INSPECT](
    depth: number,
    options: InspectOptions,
    inspect: Inspect
  ): string {
    if (depth < 0) {
      return options.stylize('[DataViewWriter]', 'special');
    }

    const count = this.#chunks.length;
    const bufStr = this.#chunks.map((c, i) => {
      if (i === count - 1) {
        c = c.subarray(0, this.#offset);
      }
      return options.stylize(u8toHex(c), 'string');
    }).join('\n  ');
    return `${options.stylize('DataViewWriter', 'special')} { length: ${inspect(this.#length, options)}, chunks: [
  ${bufStr}
] }`;
  }

  /**
   * Allocate a new chunk.  Ensure the previous last-chunk is truncated before
   * calling, if one exists.
   */
  #alloc(): void {
    const buf = new Uint8Array(this.#opts.chunkSize);
    this.#chunks.push(buf);
    this.#offset = 0;
    this.#dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  /**
   * Trim the previous last block so that it only has offset bytes.
   */
  #trim(): void {
    const last = this.#chunks.length - 1;
    const lastChunk = this.#chunks[last];
    if (lastChunk.length !== this.#offset) {
      this.#chunks[last] = lastChunk.subarray(0, this.#offset);
      this.#dv = null;
    }
  }

  /**
   * How many bytes are left in the last chunk?
   *
   * @returns Number of bytes safe to write.
   */
  #left(): number {
    const last = this.#chunks.length - 1;
    return this.#chunks[last].length - this.#offset;
  }

  /**
   * Ensure that there are at least sz bytes in the last chunk.
   *
   * @param sz Always 8 or less.
   * @returns The current view for the last chunk.
   */
  #makeSpace(sz: number): DataView {
    // Assert: sz <= this.#opts.chunkSize
    if (this.#left() < sz) {
      this.#trim();
      this.#alloc();
    }
    // Assert(this.#dv)
    return this.#dv as DataView;
  }

  /**
   * We have added sz bytes.  Update offset and length.
   *
   * @param sz Number of bytes.
   * @returns This, for chaining.
   */
  #advance(sz: number): this {
    this.#offset += sz;
    this.#length += sz;
    return this;
  }

  /**
   * Either peek or read.
   *
   * @param clear If false, coalesce chunks when needed.
   * @returns The current full contents.
   */
  #read(clear = true): Uint8Array {
    this.#trim();
    let ret: Uint8Array | null = null;
    const count = this.#chunks.length; // Always 1+
    if (count === 1) {
      [ret] = this.#chunks; // Above trim makes this right
    } else {
      ret = new Uint8Array(this.#length);
      let len = 0;
      for (const u8 of this.#chunks) {
        ret.set(u8, len); // Last chunk already trimmed
        len += u8.length;
      }
      if (!clear) {
        this.#chunks = [ret];
        this.#offset = len;
      }
    }
    return ret;
  }
}
