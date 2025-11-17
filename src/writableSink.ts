import {TruncationError} from './errors.ts';
import {assert} from '@cto.af/utils';

interface Waiting {
  size: number;
  resolve(): void;
  reject(reason?: any): void;
}

const TE = new TextEncoder();

export interface SinkOptions {
  input?: Uint8Array | string;
}

/**
 * Internal class for handling a WritableStream.  Does not do adequate
 * backpressure yet, which could lead to unexpected memory growth.
 */
export class WritableSink implements UnderlyingSink<Uint8Array> {
  #q: Uint8Array[] = [];
  #len = 0;
  #offset = 0;
  #closed = false;
  #waiting: Waiting | undefined = undefined;

  public constructor(opts: SinkOptions) {
    if (opts.input) {
      if (typeof opts.input === 'string') {
        this.#push(TE.encode(opts.input));
      } else if (opts.input instanceof Uint8Array) {
        this.#push(opts.input);
      } else {
        throw new Error('Unknown input type');
      }
    }
  }

  public get length(): number {
    return this.#len;
  }

  public get offset(): number {
    return this.#offset;
  }

  /**
   * An abort was signalled on the stream.  Abort any waiting read.
   *
   * @param reason Often an Error instance.
   */
  public abort(reason?: unknown): void {
    this.#closed = true;
    if (this.#waiting) {
      const {reject} = this.#waiting;
      this.#waiting = undefined;
      reject(reason);
    }
  }

  /**
   * The stream was closed.  If there is a waiting read, it must have failed,
   * or it would have completed by now.
   */
  public close(): void {
    this.#closed = true;
    if (this.#waiting) {
      const {reject, size} = this.#waiting;
      this.#waiting = undefined;
      reject(new TruncationError(this.#offset, size, this.#len));
    }
  }

  // Not needed (yet?)
  // public start(controller: WritableStreamDefaultController): void {
  // }

  /**
   * A new chunk has become available.
   *
   * @param chunk Buffer that was received.
   * @param controller Check that we haven't been aborted.
   */
  public write(
    chunk: Uint8Array,
    controller: WritableStreamDefaultController
  ): void {
    assert(!controller.signal.aborted, 'Unknown state.  Abort should have cancelled write.');

    // TODO (@hildjj): Think more about backpressure, since the HWM
    // doesn't seem to do much.  One approach would be to monitor length,
    // and only fulfill a promise that this method returns when it
    // is less than max(HWM, this.#waiting.size).
    this.#push(chunk);
  }

  /**
   * Wait until at least size bytes are available.
   * @param size Number of bytes.  Must be finite and > 0.
   */
  public waitFor(size: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!Number.isSafeInteger(size) || (size <= 0)) {
        reject(new Error(`Invalid size: "${size}"`));
        return;
      }
      if (this.#waiting) {
        reject(new Error(`Already waiting for ${this.#waiting.size} bytes when ${size} requested`));
        return;
      }
      if (size <= this.#len) {
        resolve();
        return;
      }
      // If we're closed, and we didn't have enough to resolve immediately,
      // we're not going to get any more data.
      if (this.#closed) {
        reject(new TruncationError(this.#offset, size, this.#len));
      }
      this.#waiting = {size, resolve, reject};
    });
  }

  /**
   * Fully read the given number of bytes.
   *
   * @param size Number of bytes.
   * @param target If specified, write into the given array.
   * @returns Promise fulfilled with array of the expected size.
   */
  public async read(size: number, target?: Uint8Array): Promise<Uint8Array> {
    if (size === 0) {
      // This zero-byte Uint8Array totally came from the stream.
      // Prove it didn't.
      return new Uint8Array();
    }
    await this.waitFor(size);
    let ret: Uint8Array | undefined = target;
    if (!ret && (size === this.#q[0].length)) {
      ret = this.#q.shift() as Uint8Array;
    } else if (!ret && (size < this.#q[0].length)) {
      ret = this.#q[0].subarray(0, size);
      this.#q[0] = this.#q[0].subarray(size);
    } else {
      ret ??= new Uint8Array(size);
      let offset = 0;
      while (offset < size) {
        const chunk = this.#q.shift();
        assert(chunk, 'Unknown state, expected more chunks');
        if (chunk.length <= size - offset) {
          ret.set(chunk, offset);
          offset += chunk.length;
        } else {
          const hunk = chunk.subarray(0, size - offset);
          ret.set(hunk, offset);
          this.#q.unshift(chunk.subarray(size - offset));
          offset += hunk.length;
        }
      }
    }
    this.#len -= size;
    this.#offset += size;
    return ret;
  }

  /**
   * Peek at some bytes at the front of the queue.  This will cut the buffers
   * in the queue up, so it's likely to be slightly less performant than
   * reading chunks of the correct size.
   *
   * @param size Number of bytes to peek at.
   * @returns Promise fulfilled with array of the expected size.
   */
  public async peek(size: number): Promise<Uint8Array> {
    const buf = await this.read(size);
    this.#q.unshift(buf);
    this.#len += buf.length;
    this.#offset -= buf.length;
    return buf;
  }

  /**
   * Received a chunk, or processing the initial chunk.
   *
   * @param buf Buffer recevied.
   */
  #push(buf: Uint8Array): void {
    this.#q.push(buf);
    this.#len += buf.length;
    if (this.#waiting) {
      if (this.#waiting.size <= this.#len) {
        const {resolve} = this.#waiting;
        this.#waiting = undefined;
        resolve();
      }
    }
  }
}
