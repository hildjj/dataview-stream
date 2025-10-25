import {DataViewReader, type FieldType} from './reader.ts';

export {
  DataViewReader,
};

export type {
  FieldType,
};

export interface NumStartFinish {
  start: number;
  finish?: number;
}

export interface BigStartFinish {
  start: bigint;
  finish?: bigint;
}

export interface FlagSet {
  set: {[flag: string]: number};
}

export interface BigFlagSet {
  set: {[flag: string]: bigint};
}

export type StartFinish = NumStartFinish |
  BigStartFinish |
  FlagSet |
  BigFlagSet;

export interface SimpleBitsConfig {
  convert?(value: number | boolean, name: string): void;
}

export type BitsConfig = SimpleBitsConfig & StartFinish;

export interface ReadOpts<F = FieldType> {
  /**
   * If true, write to temp instead of packet.
   */
  temp?: boolean;

  /**
   * If specified, run the results through the given function before storing.
   *
   * @param value Original read value.
   * @param name The field being stored to.  May be ignored.
   * @param temp Is the field being stored to in temp rather than packet?
   * @returns Converted value.
   */
  convert?(value: F, name: string, temp: boolean): unknown;
}

export type NotTemp<F> = Omit<ReadOpts<F>, 'temp'> & {temp?: false};
export type HasTemp<F> = ReadOpts<F> & {temp: true};

/**
 * Capture fields from a packet in a way that allows accessing the previously-
 * read fields while reading subsequent fields.
 *
 * @template T Structure of the packet.
 * @template U Structure for other temporary fields that you want to reference,
 *   but don't want in the final packet.
 */
export class Packet<T extends object, U = object> {
  #packet: Partial<T> = {};
  #temp: Partial<U> = {};
  #r: DataViewReader;

  public constructor(reader: DataViewReader) {
    this.#r = reader;
  }

  /**
   * Packet.  Only the fields that you have already read may be accessed.
   *
   * @returns Possibly-incomplete packet, even though the type is complete.
   */
  public get packet(): T {
    return this.#packet as T;
  }

  /**
   * The current offset into the reader.
   *
   * @type {number}
   */
  public get offset(): number {
    return this.#r.offset;
  }

  /**
   * How many bytes are left to be read?
   *
   * @type {number}
   */
  public get left(): number {
    return this.#r.original.length - this.#r.offset;
  }

  /**
   * Temporary storage.  Only the fields that you have already read may be
   * accessed.
   *
   * @returns Possibly-incomplete temp data, even though the type is complete.
   */
  public get temp(): U {
    return this.#temp as U;
  }

  /**
   * Get the truncation mode of the underlying reader.
   *
   * @returns True if truncation allowed.
   */
  public get allowTruncation(): boolean {
    return this.#r.allowTruncation;
  }

  /**
   * Sets the truncation mode of the underlying reader.  May not be set to
   * false.
   */
  public set allowTruncation(val: boolean) {
    this.#r.allowTruncation = val;
  }

  /**
   * Is this underlying reader truncated?
   *
   * @returns True if truncated.
   */
  public get truncated(): boolean {
    return this.#r.truncated;
  }

  /**
   * Some higher-level processor has detected truncation.  Must not be set
   * to false.
   */
  public set truncated(val: boolean) {
    this.#r.truncated = val;
  }

  /**
   * Reset all packet data, temp data, and return reader to the start.
   * Mostly useful for testing.
   *
   * @returns This, for chaining.
   */
  public reset(): this {
    this.#r.reset();
    this.#packet = {};
    this.#temp = {};
    return this;
  }

  /**
   * Assert that all of the data been read.  Throws an exception if extra
   * data.
   *
   * @returns This, for chaining.
   */
  public complete(): this {
    this.#r.complete();
    return this;
  }

  /**
   * Store all of the data that has yet to be read.
   *
   * @param name Field to write to in packet or temp.
   * @param opts Read options.
   * @returns This, for chaining.
   */
  public unused(name: keyof T, opts?: NotTemp<Uint8Array>): this;
  public unused(name: keyof U, opts: HasTemp<Uint8Array>): this;
  public unused(
    name: keyof T | keyof U,
    opts: ReadOpts<Uint8Array> = {temp: false}
  ): this {
    return this.#store(name, this.#r.unused(), opts);
  }

  /**
   * Store some number of bytes.
   *
   * @param name Field to write to in packet or temp.
   * @param len Number of bytes to read.
   * @param opts Read options.
   * @returns This, for chaining.
   */
  public bytes(name: keyof T, len: number, opts?: NotTemp<Uint8Array>): this;
  public bytes(name: keyof U, len: number, opts: HasTemp<Uint8Array>): this;
  public bytes(
    name: keyof T | keyof U,
    len: number,
    opts: ReadOpts<Uint8Array> = {temp: false}
  ): this {
    return this.#store(name, this.#r.bytes(len), opts);
  }

  /**
   * Store some number of bytes, interpreted as an ASCII string.
   *
   * @param name Field to write to in packet or temp.
   * @param len Number of bytes to read.
   * @param opts Read options.
   * @returns This, for chaining.
   */
  public ascii(
    name: keyof T,
    len: number,
    opts?: NotTemp<string>
  ): this;
  public ascii(
    name: keyof U,
    len: number,
    opts: HasTemp<string>
  ): this;
  public ascii(
    name: keyof T | keyof U,
    len: number,
    opts: ReadOpts<string> = {temp: false}
  ): this {
    return this.#store(name, this.#r.ascii(len), opts);
  }

  /**
   * Store some number of bytes, interpreted as a UTF8 string.
   *
   * @param name Field to write to in packet or temp.
   * @param len Number of bytes to read.
   * @param opts Read options.
   * @returns This, for chaining.
   */
  public utf8(name: keyof T, len: number, opts?: NotTemp<string>): this;
  public utf8(
    name: keyof U,
    len: number,
    opts: HasTemp<string>
  ): this;
  public utf8(
    name: keyof T | keyof U,
    len: number,
    opts: ReadOpts<string> = {temp: false}
  ): this {
    return this.#store(name, this.#r.utf8(len), opts);
  }

  /**
   * Store an unsigned 8 bit integer.
   *
   * @param name Field to write to in packet or temp.
   * @param opts Read options.
   * @returns This, for chaining.
   */
  public u8(name: keyof T, opts?: NotTemp<number>): this;
  public u8(name: keyof U, opts: HasTemp<number>): this;
  public u8(
    name: keyof T | keyof U,
    opts: ReadOpts<number> = {temp: false}
  ): this {
    return this.#store(name, this.#r.u8(), opts);
  }

  /**
   * Store an unsigned 16 bit integer.
   *
   * @param name Field to write to in packet or temp.
   * @param opts Read options.
   * @returns This, for chaining.
   */
  public u16(name: keyof T, opts?: NotTemp<number>): this;
  public u16(name: keyof U, opts: HasTemp<number>): this;
  public u16(
    name: keyof T | keyof U,
    opts: ReadOpts<number> = {temp: false}
  ): this {
    return this.#store(name, this.#r.u16(), opts);
  }

  /**
   * Store an unsigned 32 bit integer.
   *
   * @param name Field to write to in packet or temp.
   * @param opts Read options.
   * @returns This, for chaining.
   */
  public u32(name: keyof T, opts?: NotTemp<number>): this;
  public u32(name: keyof U, opts: HasTemp<number>): this;
  public u32(
    name: keyof T | keyof U,
    opts: ReadOpts<number> = {temp: false}
  ): this {
    return this.#store(name, this.#r.u32(), opts);
  }

  /**
   * Store an unsigned 64 bit integer as a bigint.
   *
   * @param name Field to write to in packet or temp.
   * @param opts Read options.
   * @returns This, for chaining.
   */
  public u64(name: keyof T, opts?: NotTemp<bigint>): this;
  public u64(name: keyof U, opts: HasTemp<bigint>): this;
  public u64(
    name: keyof T | keyof U,
    opts: ReadOpts<bigint> = {temp: false}
  ): this {
    return this.#store(name, this.#r.u64(), opts);
  }

  /**
   * Store a signed 8 bit integer.
   *
   * @param name Field to write to in packet or temp.
   * @param opts Read options.
   * @returns This, for chaining.
   */
  public i8(name: keyof T, opts?: NotTemp<number>): this;
  public i8(name: keyof U, opts: HasTemp<number>): this;
  public i8(
    name: keyof T | keyof U,
    opts: ReadOpts<number> = {temp: false}
  ): this {
    return this.#store(name, this.#r.i8(), opts);
  }

  /**
   * Store a signed 16 bit integer.
   *
   * @param name Field to write to in packet or temp.
   * @param opts Read options.
   * @returns This, for chaining.
   */
  public i16(name: keyof T, opts?: NotTemp<number>): this;
  public i16(name: keyof U, opts: HasTemp<number>): this;
  public i16(
    name: keyof T | keyof U,
    opts: ReadOpts<number> = {temp: false}
  ): this {
    return this.#store(name, this.#r.i16(), opts);
  }

  /**
   * Store a signed 32 bit integer.
   *
   * @param name Field to write to in packet or temp.
   * @param opts Read options.
   * @returns This, for chaining.
   */
  public i32(name: keyof T, opts?: NotTemp<number>): this;
  public i32(name: keyof U, opts: HasTemp<number>): this;
  public i32(
    name: keyof T | keyof U,
    opts: ReadOpts<number> = {temp: false}
  ): this {
    return this.#store(name, this.#r.i32(), opts);
  }

  /**
   * Store a signed 64 bit integer as a bigint.
   *
   * @param name Field to write to in packet or temp.
   * @param opts Read options.
   * @returns This, for chaining.
   */
  public i64(name: keyof T, opts?: NotTemp<bigint>): this;
  public i64(name: keyof U, opts: HasTemp<bigint>): this;
  public i64(
    name: keyof T | keyof U,
    opts: ReadOpts<bigint> = {temp: false}
  ): this {
    return this.#store(name, this.#r.i64(), opts);
  }

  /**
   * Store a 16 bit float.
   *
   * @param name Field to write to in packet or temp.
   * @param opts Read options.
   * @returns This, for chaining.
   */
  public f16(name: keyof T, opts?: NotTemp<number>): this;
  public f16(name: keyof U, opts: HasTemp<number>): this;
  public f16(
    name: keyof T | keyof U,
    opts: ReadOpts<number> = {temp: false}
  ): this {
    return this.#store(name, this.#r.f16(), opts);
  }

  /**
   * Store a 32 bit float.
   *
   * @param name Field to write to in packet or temp.
   * @param opts Read options.
   * @returns This, for chaining.
   */
  public f32(name: keyof T, opts?: NotTemp<number>): this;
  public f32(name: keyof U, opts: HasTemp<number>): this;
  public f32(
    name: keyof T | keyof U,
    opts: ReadOpts<number> = {temp: false}
  ): this {
    return this.#store(name, this.#r.f32(), opts);
  }

  /**
   * Store a 64 bit float.
   *
   * @param name Field to write to in packet or temp.
   * @param opts Read options.
   * @returns This, for chaining.
   */
  public f64(name: keyof T, opts?: NotTemp<number>): this;
  public f64(name: keyof U, opts: HasTemp<number>): this;
  public f64(
    name: keyof T | keyof U,
    opts: ReadOpts<number> = {temp: false}
  ): this {
    return this.#store(name, this.#r.f64(), opts);
  }

  /**
   * Convenience function to repeat reading a given number of times.
   *
   * @param name Packet field name to read into, as an array.
   * @param num Number of times to call fn.
   * @param fn Function that reads.
   * @param opts Read options.
   * @returns This, for chaining.
   */
  public times(
    name: keyof T,
    num: number,
    fn: (n: number) => FieldType,
    opts?: NotTemp<FieldType[]>
  ): this;
  public times(
    name: keyof U,
    num: number,
    fn: (n: number) => FieldType,
    opts: HasTemp<FieldType[]>
  ): this;
  public times(
    name: keyof T | keyof U,
    num: number,
    fn: (n: number) => FieldType,
    opts: ReadOpts<FieldType[]> = {temp: false}
  ): this {
    return this.#store(name, this.#r.times(num, fn), opts);
  }

  /**
   * Convenience function to perhaps execute a read.  Does not call the
   * function if input was truncated.
   *
   * @param doIt Should fn be executed?
   * @param fn Run if doIt is true.
   * @returns This, for chaining.
   */
  public maybe(doIt: boolean, fn: () => void): this {
    if (!this.#r.truncated && doIt) {
      fn.call(this);
    }
    return this;
  }

  /**
   * Repeat the given read until a condition fails.
   *
   * @param name Packet field name to read into, as an array.
   * @param keepGoing While this function returns true, keep calling read.
   * @param read The value returned from this function is added to the array.
   * @param opts Read options.
   */
  public while<V>(
    name: keyof T,
    keepGoing: (iteration: number, r: DataViewReader) => boolean,
    read: (iteration: number, r: DataViewReader) => V,
    opts?: NotTemp<V[]>
  ): this;
  public while<V>(
    name: keyof U,
    keepGoing: (iteration: number, r: DataViewReader) => boolean,
    read: (iteration: number, r: DataViewReader) => V,
    opts: HasTemp<V[]>
  ): this;
  public while<V>(
    name: keyof T | keyof U,
    keepGoing: (iteration: number, r: DataViewReader) => boolean,
    read: (iteration: number, r: DataViewReader) => V,
    opts: ReadOpts<V[]> = {temp: false}
  ): this {
    const res: V[] = [];
    let it = 0;
    while (!this.#r.truncated && keepGoing.call(this, it, this.#r)) {
      res.push(read.call(this, it++, this.#r));
    }
    return this.#store(name, res, opts);
  }

  /**
   * Copy some of the bits from one existing field to another.  Does
   * not work for fields larger than 53 bits.  For fields larger than
   * 32 bits, use bigints, as returned from u64().  Should only be
   * applied to unsigned from fields.  Bits are numbered with 0 on the
   * right, MSB on the left.  Start and finish can be in either order.
   *
   * @param desc Description of bits to capture.
   */
  public bits(desc: {
    from: keyof T;
    to: keyof T;
  } & BitsConfig): this;
  public bits(desc: {
    fromTemp: keyof U;
    to: keyof T;
  } & BitsConfig): this;
  public bits(desc: {
    from: keyof T;
    toTemp: keyof U;
  } & BitsConfig): this;
  public bits(desc: {
    fromTemp: keyof U;
    toTemp: keyof U;
  } & BitsConfig): this;
  public bits(
    {from, to, fromTemp, toTemp, convert, ...startFinish}:
    {
      from: keyof T;
      fromTemp: keyof U;
      to: keyof T;
      toTemp: keyof U;
    } & BitsConfig
  ): this {
    const field = fromTemp ? this.#temp[fromTemp] : this.#packet[from];
    if (this.#r.allowTruncation && (typeof field === 'undefined')) {
      return this;
    }
    const one = (typeof field === 'bigint' ? 1n : 1) as typeof field;

    let val: boolean | number | bigint | Set<string> | undefined = undefined;

    if ('set' in startFinish) {
      val = new Set<string>();
      for (const [flag, start] of Object.entries(startFinish.set)) {
        // @ts-expect-error TS blows at generic maths.
        if ((field >> start) & one) {
          val.add(flag);
        }
      }
    } else {
      let {start, finish} = startFinish;
      finish ??= start;

      // Start is the higher number.
      if (finish > start) {
        [start, finish] = [finish, start];
      }

      // @ts-expect-error TS blows at generic maths.
      const diff = (start - finish + one) as typeof field;

      // Always extract 53 bits or fewer.
      // @ts-expect-error TS blows at generic maths.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion
      const tmp = Number((field >> finish) & ((one << diff) - one));
      val = (start === finish) ? Boolean(tmp) : tmp;
    }

    return this.#store(
      toTemp ?? to,
      val,
      {
        temp: Boolean(toTemp),
        convert,
      }
    );
  }

  /**
   * Store a constant to the packet.
   *
   * @param name Field to write to in packet or temp.
   * @param val Any constant value.
   * @param opts Read options.
   */
  public constant(
    name: keyof T,
    val: FieldType,
    opts?: NotTemp<FieldType>
  ): this;
  public constant(
    name: keyof U,
    val: FieldType,
    opts: HasTemp<FieldType>
  ): this;
  public constant(
    name: keyof T | keyof U,
    val: FieldType,
    opts: ReadOpts<FieldType> = {temp: false}
  ): this {
    return this.#store(name, val, opts);
  }

  #store<V>(
    name: keyof T | keyof U,
    value: V,
    opts: ReadOpts<V>
  ): this {
    if (!this.#r.truncated) {
      let res: unknown = value;
      if (opts.convert) {
        res = opts.convert(value, name as string, opts.temp ?? false);
      }
      if (opts.temp) {
        this.#temp[name as keyof U] = res as U[keyof U];
      } else {
        this.#packet[name as keyof T] = res as T[keyof T];
      }
    }
    return this;
  }
}
