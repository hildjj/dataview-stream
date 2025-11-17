import {CUSTOM_INSPECT, type Inspect, type InspectOptions, u8toHex} from './inspect.ts';
import {ExtraBytesError, TruncationError} from './errors.ts';
import type {Pretty} from '@cto.af/utils';
import {parseHalf} from './half.ts';

export type FieldType =
  number | bigint | string | boolean | Uint8Array | FieldType[];

export interface ReaderOptions {
  /** Initial offset.  The reset() method will ignore this. */
  offset?: number;

  /** Read in littleEndian order, which is OPPOSITE from Network Byte Order. */
  littleEndian?: boolean;

  /** If there is an error in UTF8 encoding, use the replacement character. */
  ignoreUTF8errors?: boolean;

  /** If true, do not throw exception on truncation. */
  allowTruncation?: boolean;
}

export type RequiredRederOptions = Required<ReaderOptions>;

export interface NumberReader<W> {
  read: 'u8' | 'u16' | 'u32' |
    'i8' | 'i16' | 'i32' |
    'f16' | 'f32' | 'f64';
  littleEndian?: boolean;
  convert?(n: number, tmp: Temp, dvr: DataViewReader): W;
}

export interface BigIntReader<W> {
  read: 'u64' | 'i64';
  littleEndian?: boolean;
  convert?(n: bigint, tmp: Temp, dvr: DataViewReader): W;
}

export interface StringReader<W> {
  read: 'ascii' | 'utf8';
  length(temp: Temp, dvr: DataViewReader): number;
  convert?(n: string, tmp: Temp, dvr: DataViewReader): W;
}

export interface BytesReader<W> {
  read: 'bytes';
  length(tmp: Temp, dvr: DataViewReader): number;
  convert?(n: Uint8Array, tmp: Temp, dvr: DataViewReader): W;
}

export interface ConstantReader<W> {
  read: 'constant';
  value(tmp: Temp, dvr: DataViewReader): W;
}

export type Reader<W> = NumberReader<W> | BigIntReader<W> |
  StringReader<W> | BytesReader<W> | ConstantReader<W>;

export type ReaderType<T> =
  T extends {convert(n: any): infer W} ? W :
    T extends ConstantReader<infer X> ? X :
      T extends NumberReader<any> ? number :
        T extends BigIntReader<any> ? bigint :
          T extends StringReader<any> ? string :
            T extends BytesReader<any> ? Uint8Array :
              never;

export interface Temp {
  [K: string]: unknown;
}

export const SIZE: unique symbol = Symbol('struct.size');

export type StructDefinition =
  {[K: string]: Reader<unknown>} & {[SIZE]?: number};

export type Struct<T> = Pretty<{
  [K in keyof T as K extends `_${string}` ? never : K]: ReaderType<T[K]>;
}>;

const TD = new TextDecoder('utf8', {ignoreBOM: false});
const TDF = new TextDecoder('utf8', {ignoreBOM: false, fatal: true});

/**
 * Treat a Uint8Array as a stream to read typed data from, sequentially.
 * Note that this is not an actual ReadableStream in either the nodejs
 * sense or the web sense.
 */
export class DataViewReader {
  public static readonly defaultOptions: RequiredRederOptions = {
    offset: 0,
    littleEndian: false,
    ignoreUTF8errors: false,
    allowTruncation: false,
  };

  /**
   * Invalid value for reading a signed 64-bit integer.  This will allow
   * all bitflags to still be zero while signalling the error.  Effectively
   * NaN for 64-bit bigints.
   */
  public static readonly BAD_I64 = 1n << 64n;

  #allowTruncation = false;
  #bytes: Uint8Array;
  #dv: DataView;
  #len: number;
  #little: boolean;
  #offset = 0;
  #td = TDF;
  #truncated = false;

  /**
   * Construct new stream.  Relatively lightweight, creating a new DataView
   * over the Uint8Array's ArrayBuffer is the heaviest part.
   *
   * @param bytes Bytes to read.
   * @param opts Options.
   */
  public constructor(bytes: Uint8Array, opts: ReaderOptions = {}) {
    this.#dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.#bytes = bytes;
    this.#len = bytes.length;
    const ropts = {
      ...DataViewReader.defaultOptions,
      ...opts,
    };

    this.#checkOffset(ropts.offset);
    this.#offset = ropts.offset;
    this.#little = ropts.littleEndian;
    this.#allowTruncation = ropts.allowTruncation;
    if (ropts.ignoreUTF8errors) {
      this.#td = TD;
    }
  }

  public get littleEndian(): boolean {
    return this.#little;
  }

  public set littleEndian(val: boolean) {
    this.#little = val;
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
   * Have we read all the bytes yet?
   * @returns True if finished.
   */
  public get finished(): boolean {
    return this.#offset === this.#len;
  }

  /**
   * Is truncation allowed?
   *
   * @returns Truncation allowed.
   */
  public get allowTruncation(): boolean {
    return this.#allowTruncation;
  }

  /**
   * Set truncation mode.  May not turn it off, once it's on.
   */
  public set allowTruncation(val: boolean) {
    if (!val) {
      throw new Error('Cannot disable truncation mode');
    }
    this.#allowTruncation = true;
  }

  /**
   * If true, truncation is allowed, and this reader has detected truncation.
   * @returns Truncation state.
   */
  public get truncated(): boolean {
    return this.#truncated;
  }

  /**
   * Allowed to be set from outside the class if some higher layer wants to
   * stop all further reads.  May only be set to true.
   */
  public set truncated(val: boolean) {
    if (!val) {
      throw new Error('What has be truncated may no longer be read.');
    }
    this.#truncated = true;
  }

  /**
   * Go to a particular offset in the buffer.
   *
   * @param offset The new offset.
   * @throws {Error} If truncation is allowed, since truncation state would be
   *   lost.
   */
  public seek(offset = 0): void {
    if (this.#allowTruncation) {
      throw new Error('Invalid seek in a potentially-truncated buffer');
    }
    this.#checkOffset(offset);
    this.#offset = offset;
  }

  /**
   * Reset to the beginning of the input.  Ignores the initial offset, so if
   * you want to restart at the same place, call seek(initialOffset).
   * Sets the truncation state back to false.
   */
  public reset(): void {
    this.#truncated = false;
    this.#offset = 0; // Always valid.
  }

  /**
   * All of the bytes that have not been used yet.  If complete, returns
   * an empty array.
   *
   * @returns Byte array.
   */
  public unused(): Uint8Array {
    return this.#bytes.subarray(this.#offset);
  }

  /**
   * Skip some number of bytes without manipulating them.
   *
   * @param length Number of bytes to skip.
   */
  public skip(length: number): void {
    this.#check(length);
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
   * Returns NaN if truncation is allowed and the packet was truncated.
   *
   * @returns Number.
   */
  public u8(): number {
    const start = this.#offset;
    if (Number.isNaN(this.#check(1))) {
      return NaN;
    }
    return this.#dv.getUint8(start);
  }

  /**
   * Get a two-byte unsigned integer. Advances the current read position by 2
   * bytes.  Returns NaN if truncation is allowed and the packet was truncated.
   *
   * @param littleEndian Override stream's endianness.
   * @returns Number.
   */
  public u16(littleEndian = this.#little): number {
    const start = this.#offset;
    if (Number.isNaN(this.#check(2))) {
      return NaN;
    }
    return this.#dv.getUint16(start, littleEndian);
  }

  /**
   * Get a four-byte unsigned integer. Advances the current read position by 4
   * bytes.  Returns NaN if truncation is allowed and the packet was truncated.
   *
   * @param littleEndian Override stream's endianness.
   * @returns Number.
   */

  public u32(littleEndian = this.#little): number {
    const start = this.#offset;
    if (Number.isNaN(this.#check(4))) {
      return NaN;
    }
    return this.#dv.getUint32(start, littleEndian);
  }

  /**
   * Get an eight-byte unsigned integer. Advances the current read position by 8
   * bytes.  Returns -1n if truncation is allowed and the packet was truncated.
   *
   * @param littleEndian Override stream's endianness.
   * @returns Bigint, since 2**64 > 2**53.
   */
  public u64(littleEndian = this.#little): bigint {
    const start = this.#offset;
    if (Number.isNaN(this.#check(8))) {
      return -1n;
    }
    return this.#dv.getBigUint64(start, littleEndian);
  }

  /**
   * Get a signed byte.  Advances the current read position by 1 byte.
   * Returns NaN if truncation is allowed and the packet was truncated.
   *
   * @returns Number.
   */
  public i8(): number {
    const start = this.#offset;
    if (Number.isNaN(this.#check(1))) {
      return NaN;
    }
    return this.#dv.getInt8(start);
  }

  /**
   * Get a two-byte signed integer. Advances the current read position by 2
   * bytes.  Returns NaN if truncation is allowed and the packet was truncated.
   *
   * @param littleEndian Override stream's endianness.
   * @returns Number.
   */
  public i16(littleEndian = this.#little): number {
    const start = this.#offset;
    if (Number.isNaN(this.#check(2))) {
      return NaN;
    }
    return this.#dv.getInt16(start, littleEndian);
  }

  /**
   * Get a four-byte signed integer. Advances the current read position by 4
   * bytes.  Returns NaN if truncation is allowed and the packet was truncated.
   *
   * @param littleEndian Override stream's endianness.
   * @returns Number.
   */
  public i32(littleEndian = this.#little): number {
    const start = this.#offset;
    if (Number.isNaN(this.#check(4))) {
      return NaN;
    }
    return this.#dv.getInt32(start, littleEndian);
  }

  /**
   * Get a eight-byte signed integer. Advances the current read position by 8
   * bytes.  Returns DataViewReader.BAD_I64 if truncation is allowed and the
   * packet was truncated.
   *
   * @param littleEndian Override stream's endianness.
   * @returns Bigint.
   */

  public i64(littleEndian = this.#little): bigint {
    const start = this.#offset;
    if (Number.isNaN(this.#check(8))) {
      return DataViewReader.BAD_I64;
    }
    return this.#dv.getBigInt64(start, littleEndian);
  }

  /**
   * Get a half-precision floating point number.  On older JS runtimes, uses a
   * local implementation of f16.  Returns NaN if truncation is allowed and
   * the packet was truncated.
   *
   * Advances the current read position by 2 bytes.
   *
   * @param littleEndian Override stream's endianness.
   * @returns Number.
   */
  public f16(littleEndian = this.#little): number {
    const start = this.#offset;
    if (Number.isNaN(this.#check(2))) {
      // This is not ideal for floats, since NaN is a valid thing to have
      // read.
      return NaN;
    }
    return parseHalf(this.#dv, start, littleEndian);
  }

  /**
   * Get a single-precision floating point number.  Returns NaN if truncation
   * is allowed and the packet was truncated.
   *
   * Advances the current read position by 4 bytes.
   *
   * @param littleEndian Override stream's endianness.
   * @returns Number.
   */
  public f32(littleEndian = this.#little): number {
    const start = this.#offset;
    if (Number.isNaN(this.#check(4))) {
      return NaN;
    }
    return this.#dv.getFloat32(start, littleEndian);
  }

  /**
   * Get a double-precision floating point number.  Returns NaN if truncation
   * is allowed and the packet was truncated.
   *
   * Advances the current read position by 8 bytes.
   *
   * @param littleEndian Override stream's endianness.
   * @returns Number.
   */
  public f64(littleEndian = this.#little): number {
    const start = this.#offset;
    if (Number.isNaN(this.#check(4))) {
      return NaN;
    }
    return this.#dv.getFloat64(start, littleEndian);
  }

  /**
   * Convenience function to repeat reading a given number of times.
   *
   * @param num Number of times to call fn.
   * @param fn Function that reads.
   * @returns Array of results.
   */
  public times<T extends FieldType>(num: number, fn: (n: number) => T): T[] {
    const res: T[] = [];
    for (let i = 0; !this.#truncated && (i < num); i++) {
      res[i] = fn.call(this, i);
    }
    return res;
  }

  public struct<T extends StructDefinition>(description: T): Struct<T> {
    const temp: Temp = {};
    const res: Partial<Struct<T>> = {};
    // eslint-disable-next-line guard-for-in
    for (const k in description) {
      const v = description[k];
      let val: any = undefined;
      switch (v.read) {
        case 'u8':
        case 'u16':
        case 'u32':
        case 'u64':
        case 'i8':
        case 'i16':
        case 'i32':
        case 'i64':
        case 'f16':
        case 'f32':
        case 'f64':
          val = this[v.read](v.littleEndian);
          break;
        case 'ascii':
        case 'utf8':
          val = this[v.read](v.length(temp, this));
          if (v.convert) {
            val = v.convert(val, temp, this);
          }
          break;
        case 'bytes':
          val = this[v.read](v.length(temp, this));
          if (v.convert) {
            val = v.convert(val, temp, this);
          }
          break;
        case 'constant':
          val = v.value(temp, this);
          break;
      }
      if (k.startsWith('_')) {
        temp[k.slice(1)] = val;
      } else {
        res[k as string as keyof Struct<T>] = val;
      }
    }
    return res as Struct<T>;
  }

  /**
   * If the current buffer has not been completely read, throws an error.
   * Does not throw error if truncation is allowed.
   *
   * @throws {ExtraBytesError} When extra data.
   */
  public complete(): void {
    if (!this.#truncated && (this.#offset !== this.#len)) {
      throw new ExtraBytesError(this.#offset, this.#len);
    }
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
      return options.stylize('[DataViewReader]', 'special');
    }

    return `${options.stylize('DataViewReader', 'special')} { length: ${inspect(this.#len, options)}, offset: ${inspect(this.#offset, options)}, unused: ${options.stylize(u8toHex(this.unused()), 'string')}}`;
  }

  /**
   * If the offset is invalid, throw a RangeError.
   *
   * @param offset Current offset.
   * @throws {RangeError} The offset is invalid.
   */
  #checkOffset(offset: number): void {
    if ((offset > this.#len) || (offset < 0) || !Number.isSafeInteger(offset)) {
      throw new RangeError(`Invalid offset: ${offset}`);
    }
  }

  /**
   * Move the offset ahead by a number of bytes.
   *
   * @param add Number of bytes to add.
   * @returns The new offset.
   * @throws {TruncationError} Invalid total number.
   */
  #check(add: number): number {
    if (this.#truncated) {
      return NaN;
    }
    const start = this.#offset;
    this.#offset += add;
    if (this.#offset > this.#len) {
      if (this.#allowTruncation) {
        this.#truncated = true;
        return NaN;
      }
      throw new TruncationError(start, add, this.#len);
    }
    return this.#offset;
  }
}
