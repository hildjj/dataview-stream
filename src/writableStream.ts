import {DataViewWriter, type WriterOptions} from './writer.ts';

export class DataViewWritableStream extends WritableStream<Uint8Array> {
  #dvw: DataViewWriter;

  public constructor(opts?: WriterOptions) {
    const dvw = new DataViewWriter(opts);
    super({
      write(chunk: Uint8Array): void {
        dvw.write(chunk);
      },
    });
    this.#dvw = dvw;
  }

  public read(): Uint8Array {
    return this.#dvw.read();
  }
}
