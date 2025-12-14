import {
  DataViewReader,
  SIZE,
  type Struct,
  type StructDefinition,
} from './reader.ts';
import {WritableSink} from './writableSink.ts';
import {assert} from '@cto.af/utils';
import {parseHalf} from './half.ts';

export interface DataViewWritableStreamOptions {
  /** Passed to ByteLengthQueuingStrategy for superclass. */
  highWaterMark?: number;

  /**
   * If specified, start with these bytes enqueued.  Strings are encoded as
   * UTF-8.
   */
  input?: Uint8Array | ArrayBuffer | string;

  /**
   * Default endianness for the stream.
   */
  littleEndian?: boolean;

  /** If there is an error in UTF8 encoding, use the replacement character. */
  ignoreUTF8errors?: boolean;
}

const TD = new TextDecoder('utf8', {ignoreBOM: false});
const TDF = new TextDecoder('utf8', {ignoreBOM: false, fatal: true});

// From the last char of a sized field to the field size in bytes.
const BYTELEN: {[last: string]: number} = {
  8: 1, // 8
  6: 2, // 16
  2: 4, // 32
  4: 8, // 64
  t: 0, // "constant"
};

/**
 * This is readable in the DataView sense, but writable in the stream sense.
 */
export class DataViewWritableStream extends WritableStream<Uint8Array> {
  public static readonly SIZE: typeof SIZE = SIZE;
  #sink: WritableSink;
  #little = false;
  #td = TDF;
  #buf = new Uint8Array(8);
  #dv = new DataView(
    this.#buf.buffer, this.#buf.byteOffset, this.#buf.byteLength
  );

  public constructor(
    options: DataViewWritableStreamOptions | string | Uint8Array = {}
  ) {
    if ((typeof options === 'string') || (options instanceof Uint8Array)) {
      options = {input: options};
    }
    const opts = {
      highWaterMark: Infinity,
      littleEndian: false,
      ...options,
    };
    const sink = new WritableSink(opts);
    super(sink, new ByteLengthQueuingStrategy(opts));
    this.#sink = sink;
    this.#little = opts.littleEndian;
    if (opts.ignoreUTF8errors) {
      this.#td = TD;
    }

    if (opts.input) {
      const w = this.getWriter(); // Lock
      // Don't call w.write here, since it's async.
      w.close(); // Will show up as state: 'closed' after one event loop.
    }
  }

  /**
   * Current number of bytes queued but unread.
   */
  public get length(): number {
    return this.#sink.length;
  }

  /**
   * Current default endianness.  May be changed in the middle of the stream
   * for formats like pcapng.
   */
  public get littleEndian(): boolean {
    return this.#little;
  }

  public set littleEndian(value: boolean) {
    this.#little = value;
  }

  /**
   * Current read position in bytes from the original start of the stream.
   */
  public get offset(): number {
    return this.#sink.offset;
  }

  /**
   * Wait for a number of bytes to be available to read immediately from the
   * stream.
   *
   * @param size Number of bytes.
   * @returns Promise that is rejected if stream is closed without enough data.
   */
  public waitFor(size: number): Promise<void> {
    return this.#sink.waitFor(size);
  }

  /**
   * Fully read a number of bytes from the stream.
   *
   * @param size Number of bytes.
   * @returns Promise that is rejected if stream is closed without enough data.
   */
  public bytes(size: number): Promise<Uint8Array> {
    return this.#sink.read(size);
  }

  /**
   * Peek at some bytes at the front of the queue.  This will cut the buffers
   * in the queue up, so it's likely to be slightly less performant than
   * reading chunks of the correct size, unless you're going to read this
   * exact size again next.
   *
   * @param size Number of bytes to peek at.
   * @returns Promise fulfilled with array of the expected size.
   */
  public peek(size: number): Promise<Uint8Array> {
    return this.#sink.peek(size);
  }

  /**
   * Wait for an unsigned byte to be available in the stream.
   *
   * @returns Promise that is rejected if stream is closed without enough data.
   */
  public async u8(): Promise<number> {
    const buf = await this.#sink.read(1);
    return buf[0];
  }

  /**
   * Wait for an unsigned short integer to be available in the stream.
   *
   * @param littleEndian Override th endianness of the stream for a single read.
   * @returns Promise that is rejected if stream is closed without enough data.
   */
  public async u16(littleEndian = this.#little): Promise<number> {
    await this.#sink.read(2, this.#buf);
    return this.#dv.getUint16(0, littleEndian);
  }

  /**
   * Wait for an unsigned integer to be available in the stream.
   *
   * @param littleEndian Override th endianness of the stream for a single read.
   * @returns Promise that is rejected if stream is closed without enough data.
   */
  public async u32(littleEndian = this.#little): Promise<number> {
    await this.#sink.read(4, this.#buf);
    return this.#dv.getUint32(0, littleEndian);
  }

  /**
   * Wait for an unsigned long integer to be available in the stream.
   *
   * @param littleEndian Override th endianness of the stream for a single read.
   * @returns Promise that is rejected if stream is closed without enough data.
   */
  public async u64(littleEndian = this.#little): Promise<bigint> {
    await this.#sink.read(8, this.#buf);
    return this.#dv.getBigUint64(0, littleEndian);
  }

  /**
   * Wait for an signed byte to be available in the stream.
   *
   * @returns Promise that is rejected if stream is closed without enough data.
   */
  public async i8(): Promise<number> {
    await this.#sink.read(1, this.#buf);
    return this.#dv.getInt8(0);
  }

  /**
   * Wait for an signed short integer to be available in the stream.
   *
   * @param littleEndian Override th endianness of the stream for a single read.
   * @returns Promise that is rejected if stream is closed without enough data.
   */
  public async i16(littleEndian = this.#little): Promise<number> {
    await this.#sink.read(2, this.#buf);
    return this.#dv.getInt16(0, littleEndian);
  }

  /**
   * Wait for an signed integer to be available in the stream.
   *
   * @param littleEndian Override th endianness of the stream for a single read.
   * @returns Promise that is rejected if stream is closed without enough data.
   */
  public async i32(littleEndian = this.#little): Promise<number> {
    await this.#sink.read(4, this.#buf);
    return this.#dv.getInt32(0, littleEndian);
  }

  /**
   * Wait for an signed long integer to be available in the stream.
   *
   * @param littleEndian Override th endianness of the stream for a single read.
   * @returns Promise that is rejected if stream is closed without enough data.
   */
  public async i64(littleEndian = this.#little): Promise<bigint> {
    await this.#sink.read(8, this.#buf);
    return this.#dv.getBigInt64(0, littleEndian);
  }

  /**
   * Wait for a short float to be available in the stream.
   *
   * @param littleEndian Override th endianness of the stream for a single read.
   * @returns Promise that is rejected if stream is closed without enough data.
   */
  public async f16(littleEndian = this.#little): Promise<number> {
    await this.#sink.read(2, this.#buf);
    return parseHalf(this.#dv, 0, littleEndian);
  }

  /**
   * Wait for a float to be available in the stream.
   *
   * @param littleEndian Override th endianness of the stream for a single read.
   * @returns Promise that is rejected if stream is closed without enough data.
   */
  public async f32(littleEndian = this.#little): Promise<number> {
    await this.#sink.read(4, this.#buf);
    return this.#dv.getFloat32(0, littleEndian);
  }

  /**
   * Wait for a double to be available in the stream.
   *
   * @param littleEndian Override th endianness of the stream for a single read.
   * @returns Promise that is rejected if stream is closed without enough data.
   */
  public async f64(littleEndian = this.#little): Promise<number> {
    await this.#sink.read(8, this.#buf);
    return this.#dv.getFloat64(0, littleEndian);
  }

  /**
   * Wait for an ASCII string of a given size (in bytes) to be available in the
   * stream.  Decoding turns each byte into a single JS character directly,
   * which may not be exactly what you want for characters over 127.
   *
   * @param length Number of bytes to read.
   * @returns Promise that is rejected if stream is closed without enough data.
   */
  public async ascii(length: number): Promise<string> {
    const buf = await this.#sink.read(length);
    return String.fromCharCode(...buf);
  }

  /**
   * Wait for a UTF8-encoded string of a given size (in bytes) to be available
   * in the stream.
   *
   * @param length Number of bytes to read.
   * @returns Promise that is rejected if stream is closed without enough
   *   data.
   */
  public async utf8(length: number): Promise<string> {
    const buf = await this.#sink.read(length);
    return this.#td.decode(buf);
  }

  /**
   * Wait for an entire packet structure at once.  Only useful for relatively-
   * simplistic structures.  If all of the fields have known size, the length
   * is not required.
   *
   * @param description Field descriptions, in the order you want them read.
   * @param length Number of bytes, if needed.
   * @returns This, for chaining.
   */
  public async struct<T extends StructDefinition>(
    description: T,
    length?: number
  ): Promise<Struct<T>> {
    if (typeof length !== 'number') {
      length = description[SIZE];
      if (typeof length !== 'number') {
        length = 0;
        // eslint-disable-next-line guard-for-in
        for (const k in description) {
          const v = description[k];
          const s = BYTELEN[v.read.slice(-1)];
          assert((typeof s === 'number') && (v.read !== 'utf8'),
            'Invalid read method for implicit size');
          length += s;
        }
        description[SIZE] = length;
      }
    }
    const buf = await this.#sink.read(length);
    const dvr = new DataViewReader(buf, {littleEndian: this.#little});
    return dvr.struct(description);
  }
}
