import {DataViewReader, type FieldType} from './reader.ts';

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

export type StartFinish = NumStartFinish | BigStartFinish;

export class Packet<T extends object, U = object> {
  #packet: Partial<T> = {};
  #temp: Partial<U> = {};
  #r: DataViewReader;

  public constructor(reader: DataViewReader) {
    this.#r = reader;
  }

  public get packet(): T {
    return this.#packet as T;
  }

  public get temp(): U {
    return this.#temp as U;
  }

  public reset(): this {
    this.#r.reset();
    this.#packet = {};
    this.#temp = {};
    return this;
  }

  public complete(): this {
    this.#r.complete();
    return this;
  }

  public unused(name: keyof T): this;
  public unused(name: keyof U, temp: true): this;
  public unused(name: keyof T | keyof U, temp = false): this {
    return this.#store(name, this.#r.unused(), temp);
  }

  public bytes(name: keyof T, len: number): this;
  public bytes(name: keyof U, len: number, temp: true): this;
  public bytes(name: keyof T | keyof U, len: number, temp = false): this {
    return this.#store(name, this.#r.bytes(len), temp);
  }

  public ascii(name: keyof T, len: number): this;
  public ascii(name: keyof U, len: number, temp: true): this;
  public ascii(name: keyof T | keyof U, len: number, temp = false): this {
    return this.#store(name, this.#r.ascii(len), temp);
  }

  public utf8(name: keyof T, len: number): this;
  public utf8(name: keyof U, len: number, temp: true): this;
  public utf8(name: keyof T | keyof U, len: number, temp = false): this {
    return this.#store(name, this.#r.utf8(len), temp);
  }

  public u8(name: keyof T): this;
  public u8(name: keyof U, temp: true): this;
  public u8(name: keyof T | keyof U, temp = false): this {
    return this.#store(name, this.#r.u8(), temp);
  }

  public u16(name: keyof T): this;
  public u16(name: keyof U, temp: true): this;
  public u16(name: keyof T | keyof U, temp = false): this {
    return this.#store(name, this.#r.u16(), temp);
  }

  public u32(name: keyof T): this;
  public u32(name: keyof U, temp: true): this;
  public u32(name: keyof T | keyof U, temp = false): this {
    return this.#store(name, this.#r.u32(), temp);
  }

  public u64(name: keyof T): this;
  public u64(name: keyof U, temp: true): this;
  public u64(name: keyof T | keyof U, temp = false): this {
    return this.#store(name, this.#r.u64(), temp);
  }

  public i8(name: keyof T): this;
  public i8(name: keyof U, temp: true): this;
  public i8(name: keyof T | keyof U, temp = false): this {
    return this.#store(name, this.#r.i8(), temp);
  }

  public i16(name: keyof T): this;
  public i16(name: keyof U, temp: true): this;
  public i16(name: keyof T | keyof U, temp = false): this {
    return this.#store(name, this.#r.i16(), temp);
  }

  public i32(name: keyof T): this;
  public i32(name: keyof U, temp: true): this;
  public i32(name: keyof T | keyof U, temp = false): this {
    return this.#store(name, this.#r.i32(), temp);
  }

  public i64(name: keyof T): this;
  public i64(name: keyof U, temp: true): this;
  public i64(name: keyof T | keyof U, temp = false): this {
    return this.#store(name, this.#r.i64(), temp);
  }

  public f16(name: keyof T): this;
  public f16(name: keyof U, temp: true): this;
  public f16(name: keyof T | keyof U, temp = false): this {
    return this.#store(name, this.#r.f16(), temp);
  }

  public f32(name: keyof T): this;
  public f32(name: keyof U, temp: true): this;
  public f32(name: keyof T | keyof U, temp = false): this {
    return this.#store(name, this.#r.f32(), temp);
  }

  public f64(name: keyof T): this;
  public f64(name: keyof U, temp: true): this;
  public f64(name: keyof T | keyof U, temp = false): this {
    return this.#store(name, this.#r.f64(), temp);
  }

  public times(
    name: keyof T,
    num: number,
    fn: (n: number) => FieldType
  ): this;
  public times(
    name: keyof U,
    num: number,
    fn: (n: number) => FieldType,
    temp: true
  ): this;

  /**
   * Convenience function to repeat reading a given number of times.
   *
   * @param name Packet field name to read into.
   * @param num Number of times to call fn.
   * @param fn Function that reads.
   * @param temp Store in temp instead of packet?
   * @returns Array of results.
   */
  public times(
    name: keyof T | keyof U,
    num: number,
    fn: (n: number) => FieldType,
    temp = false
  ): this {
    return this.#store(name, this.#r.times(num, fn), temp);
  }

  public maybe(doIt: boolean, fn: () => void): this {
    if (doIt) {
      fn.call(this);
    }
    return this;
  }

  public bits(desc: {
    from: keyof T;
    to: keyof T;
  } & StartFinish): this;
  public bits(desc: {
    fromTemp: keyof U;
    to: keyof T;
  } & StartFinish): this;
  public bits(desc: {
    from: keyof T;
    toTemp: keyof U;
  } & StartFinish): this;
  public bits(desc: {
    fromTemp: keyof U;
    toTemp: keyof U;
  } & StartFinish): this;

  /**
   * Copy some of the bits from one existing field to another.  Does
   * not work for fields larger than 53 bits.  For fields larger than
   * 32 bits, use bigints, as returned from u64().  Should only be
   * applied to unsigned from fields.  Bits are numbered with 0 on the
   * right, MSB on the left.  Start and finish can be in either order.
   *
   * @param desc Description of bits to copy.
   * @param desc.from Source field name.
   * @param desc.fromTemp Source field name, from temp storage.
   * @param desc.to Destination field name.
   * @param desc.toTemp Destination field name, from temp storage.
   * @param desc.start Start of bit range.
   * @param desc.finish End of bit range, defaults to start.
   * @returns This, for chaining.
   * @throws {TypeError} If the from field isn't a number.
   */
  public bits(
    {from, to, fromTemp, toTemp, start, finish}:
    {
      from: keyof T;
      fromTemp: keyof U;
      to: keyof T;
      toTemp: keyof U;
    } & StartFinish
  ): this {
    const field = (fromTemp ? this.#temp[fromTemp] : this.#packet[from]) as
      number | bigint;
    finish ??= start;
    const one = (typeof field === 'bigint' ? 1n : 1) as typeof field;

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

    return this.#store(
      toTemp ?? to,
      (start === finish) ? Boolean(tmp) : tmp,
      Boolean(toTemp)
    );
  }

  #store(
    name: keyof T | keyof U,
    value: FieldType,
    temp: boolean
  ): this {
    if (temp) {
      this.#temp[name as keyof U] = value as U[keyof U];
    } else {
      this.#packet[name as keyof T] = value as T[keyof T];
    }
    return this;
  }
}
