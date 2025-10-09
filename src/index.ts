import {parseHalf} from './half.ts';

/**
 * The input was truncated, compared to the expected size.
 * In other words, an attempt was made to read past the end of the input.
 */
export class TruncationError extends Error {
  /**
   * Create a truncation error.
   *
   * @param start The starting offset for the read.
   * @param requested The number of bytes requested.
   * @param size The total size of the input.
   */
  public constructor(
    public readonly start: number,
    public readonly requested: number,
    public readonly size: number
  ) {
    super(`Message truncated, ${requested} > ${size} at ${start}`);
  }
}

/**
 * The input was longer than expected.
 */
export class ExtraBytesError extends Error {
  public constructor(
    public readonly offset: number,
    public readonly size: number
  ) {
    super(`Message overlong, ${size} > ${offset}`);
  }
}

export interface DVSoptions {
  /** Initial offset.  The reset() method will ignore this. */
  offset?: number;

  /** Read in littleEndian order, which is OPPOSITE from Network Byte Order. */
  littleEndian?: boolean;

  /** If there is an error in UTF8 encoding, use the replacement character. */
  ignoreUTF8errors?: boolean;
}

const TD = new TextDecoder('utf8', {ignoreBOM: false});
const TDF = new TextDecoder('utf8', {ignoreBOM: false, fatal: true});

/**
 * Treat a Uint8Array as a stream to read typed data from, sequentially.
 * Note that this is not an actual ReadableStream in either the nodejs
 * sense or the web sense.
 */
export class DataViewStream {
  #offset = 0;
  #little = false;
  #dv: DataView;
  #bytes: Uint8Array;
  #len: number;
  #td = TDF;

  /**
   * Construct new stream.  Relatively lightweight, creating a new DataView
   * over the Uint8Array's ArrayBuffer is the heaviest part.
   *
   * @param bytes Bytes to read.
   * @param opts Options.
   */
  public constructor(bytes: Uint8Array, opts?: DVSoptions) {
    this.#dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.#bytes = bytes;
    this.#len = bytes.length;
    if (opts) {
      if (typeof opts.offset === 'number') {
        this.#checkOffset(opts.offset);
        this.#offset = opts.offset;
      }
      this.#little = Boolean(opts.littleEndian);
      if (opts.ignoreUTF8errors) {
        this.#td = TD;
      }
    }
  }

  /**
   * Original bytes.
   *
   * @returns Original.
   */
  public get original(): Uint8Array {
    return this.#bytes;
  }

  /**
   * Current offset.
   *
   * @returns Current.
   */
  public get offset(): number {
    return this.#offset;
  }

  /**
   * Go to a particular offset in the buffer.
   *
   * @param offset The new offset.
   */
  public seek(offset = 0): void {
    this.#checkOffset(offset);
    this.#offset = offset;
  }

  /**
   * Reset to the beginning of the input.  Ignores the initial offset, so if
   * you want to restart at the same place, call seek(initialOffset).
   */
  public reset(): void {
    this.seek(0);
  }

  /**
   * Get a chunk of the original buffer.
   *
   * Advances the current read position by length bytes.
   *
   * @param length How many bytes?
   * @returns A subarray of the original buffer, without copying.
   */
  public bytes(length: number): Uint8Array {
    return this.#bytes.subarray(this.#offset, this.#check(length));
  }

  /**
   * Get a chunk of the buffer as 8-bit ASCII text.  This is only useful for
   * ancient protocols such as DNS.  If the top bit is set, you get equivalent
   * Unicode characters, which should be Latin-1.
   *
   * Advances the current read position by length bytes.
   *
   * @param length Number of bytes.
   * @returns String.
   */
  public ascii(length: number): string {
    return String.fromCharCode(...this.bytes(length));
  }

  /**
   * Read a number of *bytes* as a UTF-8 encoded string.  Use the
   * ignoreUTF8errors option to avoid throwing exceptions on invalid UTF-8
   * and get replacement characters instead.  However, by default, Postel
   * was wrong.
   *
   * Advances the current read position by length bytes.
   *
   * @param length Number of bytes.
   * @returns Unicode string.
   */
  public utf8(length: number): string {
    return this.#td.decode(this.bytes(length));
  }

  /**
   * Get an unsigned byte.  Advances the current read position by 1 byte.
   *
   * @returns Number.
   */
  public u8(): number {
    const start = this.#offset;
    this.#check(1);
    return this.#dv.getUint8(start);
  }

  /**
   * Get a two-byte unsigned integer. Advances the current read position by 2
   * bytes.
   *
   * @returns Number.
   */
  public u16(): number {
    const start = this.#offset;
    this.#check(2);
    return this.#dv.getUint16(start, this.#little);
  }

  /**
   * Get a four-byte unsigned integer. Advances the current read position by 4
   * bytes.
   *
   * @returns Number.
   */

  public u32(): number {
    const start = this.#offset;
    this.#check(4);
    return this.#dv.getUint32(start, this.#little);
  }

  /**
   * Get an eight-byte unsigned integer. Advances the current read position by 8
   * bytes.
   *
   * @returns Bigint, since 2**64 > 2**53.
   */
  public u64(): bigint {
    const start = this.#offset;
    this.#check(8);
    return this.#dv.getBigUint64(start, this.#little);
  }

  /**
   * Get a signed byte.  Advances the current read position by 1 byte.
   *
   * @returns Number.
   */
  public i8(): number {
    const start = this.#offset;
    this.#check(1);
    return this.#dv.getInt8(start);
  }

  /**
   * Get a two-byte signed integer. Advances the current read position by 2
   * bytes.
   *
   * @returns Number.
   */
  public i16(): number {
    const start = this.#offset;
    this.#check(2);
    return this.#dv.getInt16(start, this.#little);
  }

  /**
   * Get a four-byte signed integer. Advances the current read position by 4
   * bytes.
   *
   * @returns Number.
   */
  public i32(): number {
    const start = this.#offset;
    this.#check(4);
    return this.#dv.getInt32(start, this.#little);
  }

  /**
   * Get a eight-byte signed integer. Advances the current read position by 8
   * bytes.
   *
   * @returns Bigint.
   */

  public i64(): bigint {
    const start = this.#offset;
    this.#check(8);
    return this.#dv.getBigInt64(start, this.#little);
  }

  /**
   * Get a half-precision floating point number.  On older JS runtimes, uses
   * a local implementation of f16.
   *
   * Advances the current read position by 2 bytes.
   *
   * @returns Number.
   */
  public f16(): number {
    const start = this.#offset;
    this.#check(2);
    if (this.#dv.getFloat16) {
      return this.#dv.getFloat16(start, this.#little);
    }
    return parseHalf(this.#bytes, start, this.#little);
  }

  /**
   * Get a single-precision floating point number.
   *
   * Advances the current read position by 4 bytes.
   *
   * @returns Number.
   */
  public f32(): number {
    const start = this.#offset;
    this.#check(4);
    return this.#dv.getFloat32(start, this.#little);
  }

  /**
   * Get a double-precision floating point number.
   *
   * Advances the current read position by 8 bytes.
   *
   * @returns Number.
   */
  public f64(): number {
    const start = this.#offset;
    this.#check(4);
    return this.#dv.getFloat64(start, this.#little);
  }

  /**
   * If the current buffer has not been completely read, throws an error.
   *
   * @throws {ExtraBytesError} When extra data.
   */
  public complete(): void {
    if (this.#offset !== this.#len) {
      throw new ExtraBytesError(this.#offset, this.#len);
    }
  }

  #checkOffset(offset: number): void {
    if ((offset > this.#len) || (offset < 0) || !Number.isSafeInteger(offset)) {
      throw new RangeError(`Invalid offset: ${offset}`);
    }
  }

  #check(add: number): number {
    const start = this.#offset;
    this.#offset += add;
    if (this.#offset > this.#len) {
      throw new TruncationError(start, this.#offset, this.#len);
    }
    return this.#offset;
  }
}
