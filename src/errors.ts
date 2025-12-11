/**
 * The input was truncated, compared to the expected size.
 * In other words, an attempt was made to read past the end of the input.
 */
export class TruncationError extends Error {
  public readonly start: number;
  public readonly requested: number;
  public readonly size: number;

  /**
   * Create a truncation error.
   *
   * @param start The starting offset for the read.
   * @param requested The number of bytes requested.
   * @param size The total size of the input.
   */
  public constructor(start: number, requested: number, size: number) {
    super(`Message truncated, ${requested} > ${size} at ${start}`);
    this.start = start;
    this.requested = requested;
    this.size = size;
  }
}

/**
 * The input was longer than expected.
 */
export class ExtraBytesError extends Error {
  public readonly offset: number;
  public readonly size: number;

  public constructor(offset: number, size: number) {
    super(`Message overlong, ${size} > ${offset}`);
    this.offset = offset;
    this.size = size;
  }
}
