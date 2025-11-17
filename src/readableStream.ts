import {
  CUSTOM_INSPECT,
  type InspectOptions,
  u8toHex,
} from './inspect.ts';
import {assert, promiseWithResolvers} from '@cto.af/utils';
import {halfToUint, isF16} from './half.ts';

export {
  isF16,
};

export interface DataViewReadableStreamOptions {
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

  /**
   * Custom queueing strategy.
   */
  queuingStrategy?: QueuingStrategy<Uint8Array> | null;
}

export type RequiredDataViewReadableStreamOptions =
  Required<DataViewReadableStreamOptions>;

const TE = new TextEncoder();
const NOT_INITIALIZED = 'DataViewReadableStream not initialized, await .ready';
const INTERNAL = Symbol('DataViewReadableStream internal');

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
export class DataViewReadableStream extends ReadableStream<Uint8Array> {
  public static defaultOptions: RequiredDataViewReadableStreamOptions = {
    chunkSize: 4096,
    copyBuffers: false,
    littleEndian: false,
    queuingStrategy: null,
  };

  #opts: RequiredDataViewReadableStreamOptions;
  #chunk: Uint8Array;
  #dv: DataView | null = null; // View over last chunk.
  #offset = 0;
  #controller: ReadableStreamDefaultController | undefined = undefined;
  #ready: Promise<void>;

  private constructor(
    options: DataViewReadableStreamOptions,
    internal: typeof INTERNAL
  ) {
    if (internal !== INTERNAL) {
      throw new Error('Await the result of DataViewReadableStream.create instead of calling new.');
    }

    const opts = {
      ...DataViewReadableStream.defaultOptions,
      ...options,
    };
    intRange(opts.chunkSize, 8, Number.MAX_SAFE_INTEGER);
    const p = promiseWithResolvers<ReadableStreamDefaultController>();

    const ready = p.promise.then(c => {
      this.#controller = c;
    });

    /** @see https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream/ReadableStream */
    super({
      start(c) {
        p.resolve(c);
        return ready; // Wait for this.#q to drain before continuing.
      },
      cancel(reason?: any) {
        // This can never happen before start, but it's here for completeness
        // and in case other runtimes don't have that limitation.
        p.reject(reason);
      },
    }, opts.queuingStrategy ?? undefined);

    this.#opts = opts;

    // Unroll #alloc to make it clear we are initializing #chunk.
    this.#chunk = new Uint8Array(this.#opts.chunkSize);
    this.#dv = new DataView(
      this.#chunk.buffer,
      this.#chunk.byteOffset,
      this.#chunk.byteLength
    );
    this.#ready = ready;
  }

  public get littleEndian(): boolean {
    return this.#opts.littleEndian;
  }

  public set littleEndian(value: boolean) {
    this.#opts.littleEndian = value;
  }

  public static async create(
    options: DataViewReadableStreamOptions = {}
  ): Promise<DataViewReadableStream> {
    const res = new DataViewReadableStream(options, INTERNAL);
    return res.#ready.then(() => res);
  }

  /**
   * Destructively read all bytes from the reader as a single buffer.
   *
   * @returns Bytes.
   */
  public read(): Promise<Uint8Array> {
    return new Response(this).bytes();
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
  public bytes(buf: Uint8Array, copy = this.#opts.copyBuffers): this {
    const len = buf.length;
    this.#makeSpace(len + 8);
    if (len > (this.#opts.chunkSize - 8)) {
      // Won't fit, just re-use the existing buffer.
      this.#enq(copy ? buf.slice() : buf);
    } else {
      // There is room left in the existing chunk
      this.#chunk.set(buf, this.#offset);
      this.#offset += len;
    }
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
   * @param littleEndian Override stream's littleEndian option.
   * @returns This, for chaining.
   */
  public u16(n: number, littleEndian = this.#opts.littleEndian): this {
    intRange(n, 0, 0xffff);
    this.#makeSpace(2).setUint16(this.#offset, n, littleEndian);
    return this.#advance(2);
  }

  /**
   * Write a four-byte unsigned integer.
   *
   * @param n Unsigned int.
   * @param littleEndian Override stream's littleEndian option.
   * @returns This, for chaining.
   */
  public u32(n: number, littleEndian = this.#opts.littleEndian): this {
    intRange(n, 0, 0xffffffff);
    this.#makeSpace(4).setUint32(this.#offset, n, littleEndian);
    return this.#advance(4);
  }

  /**
   * Write an eight-byte unsigned integer.
   *
   * @param n Unsigned long long.
   * @param littleEndian Override stream's littleEndian option.
   * @returns This, for chaining.
   */
  public u64(n: bigint | number, littleEndian = this.#opts.littleEndian): this {
    intRange(n, 0n, 0xffffffffffffffffn);
    this.#makeSpace(8)
      .setBigUint64(this.#offset, BigInt(n), littleEndian);
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
   * @param littleEndian Override stream's littleEndian option.
   * @returns This, for chaining.
   */
  public i16(n: number, littleEndian = this.#opts.littleEndian): this {
    intRange(n, -0x8000, 0x7fff);
    this.#makeSpace(2).setInt16(this.#offset, n, littleEndian);
    return this.#advance(2);
  }

  /**
   * Write a signed four-byte integer.
   *
   * @param n Signed int.
   * @param littleEndian Override stream's littleEndian option.
   * @returns This, for chaining.
   */
  public i32(n: number, littleEndian = this.#opts.littleEndian): this {
    intRange(n, -0x80000000, 0x7fffffff);
    this.#makeSpace(4).setInt32(this.#offset, n, littleEndian);
    return this.#advance(4);
  }

  /**
   * Write an eight-byte signed integer.
   *
   * @param n Signed long long.
   * @param littleEndian Override stream's littleEndian option.
   * @returns This, for chaining.
   */
  public i64(n: bigint | number, littleEndian = this.#opts.littleEndian): this {
    intRange(n, -0x8000000000000000n, 0x7fffffffffffffffn);
    this.#makeSpace(8)
      .setBigInt64(this.#offset, BigInt(n), littleEndian);
    return this.#advance(8);
  }

  /**
   * Write a two-byte float.
   *
   * @param n Number that fits in a short float without losing precision.
   * @param littleEndian Override stream's littleEndian option.
   * @returns This, for chaining.
   * @throws {RangeError} If number would lose precision on write.
   */
  public f16(n: number, littleEndian = this.#opts.littleEndian): this {
    if (!isF16(n)) {
      throw new RangeError('Casting this number to float16 would lose precision');
    }
    const dv = this.#makeSpace(2);
    if (dv.setFloat16) {
      // New in node v24.
      dv.setFloat16(this.#offset, n, littleEndian);
    } else {
      dv.setUint16(this.#offset, halfToUint(n) as number, littleEndian);
    }
    return this.#advance(2);
  }

  /**
   * Write a four-byte float.
   *
   * @param n Number that fits in a float.
   * @param littleEndian Override stream's littleEndian option.
   * @returns This, for chaining.
   * @throws {RangeError} Would lose precision.
   */
  public f32(n: number, littleEndian = this.#opts.littleEndian): this {
    if (!Object.is(n, Math.fround(n))) { // -0, NaN
      throw new RangeError('Casting this number to float32 would lose precision');
    }
    this.#makeSpace(4).setFloat32(this.#offset, n, littleEndian);
    return this.#advance(4);
  }

  /**
   * Write an eight-byte integer.
   *
   * @param n Double.
   * @param littleEndian Override stream's littleEndian option.
   * @returns This, for chaining.
   */
  public f64(n: number, littleEndian = this.#opts.littleEndian): this {
    this.#makeSpace(8).setFloat64(this.#offset, n, littleEndian);
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
    return this.bytes(TE.encode(s), false);
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
    return this.bytes(buf, false);
  }

  /**
   * Usually, chunks will be only become available to be read after chunkSize
   * bytes have been written.  Flush forces whatever is currently queued into
   * the readable stream.
   *
   * @returns This, for chaining.
   */
  public flush(): this {
    if (this.#offset > 0) {
      this.#enq(this.#chunk.subarray(0, this.#offset));
      this.#alloc();
    }
    return this;
  }

  /**
   * No more data will be written.  Flush everything that is pending.
   *
   * @returns This, for chaining.
   */
  public end(): this {
    this.flush();
    assert(this.#controller, NOT_INITIALIZED);
    this.#controller.close();
    return this;
  }

  /**
   * When outputting with `console.log('%O', this)` or at the node REPL,
   * see the current chunk structure.
   *
   * @param depth Current depth.
   * @param options Options for writing, generated by util.inpect.
   * @returns Formatted string.
   */
  public [CUSTOM_INSPECT](
    depth: number,
    options: InspectOptions
  ): string {
    if (depth < 0) {
      return options.stylize(`[${this.constructor.name}]`, 'special');
    }

    let res = `${options.stylize(this.constructor.name, 'special')} [`;
    if (this.#offset) {
      res += options.stylize(u8toHex(this.#chunk.subarray(0, this.#offset)), 'string');
    }
    res += ']';
    return res;
  }

  /**
   * Allocate a new chunk.  Ensure the previous last-chunk is truncated before
   * calling, if one exists.
   */
  #alloc(): void {
    this.#chunk = new Uint8Array(this.#opts.chunkSize);
    this.#dv = new DataView(
      this.#chunk.buffer,
      this.#chunk.byteOffset,
      this.#chunk.byteLength
    );
    this.#offset = 0;
  }

  /**
   * How many bytes are left in the last chunk?
   *
   * @returns Number of bytes safe to write.
   */
  #left(): number {
    return this.#chunk.length - this.#offset;
  }

  /**
   * Ensure that there are at least sz bytes in the last chunk.
   *
   * @param sz Always 8 or less.
   * @returns The current view for the last chunk.
   */
  #makeSpace(sz: number): DataView {
    if (this.#left() < sz) {
      this.flush();
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
    return this;
  }

  /**
   * Push the given buffer into the output.
   *
   * @param buf Buffer to push.
   * @returns This, for chaining.
   */
  #enq(buf: Uint8Array): this {
    assert(this.#controller, NOT_INITIALIZED);
    this.#controller.enqueue(buf);
    return this;
  }
}
