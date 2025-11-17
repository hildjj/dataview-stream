import {defineConfig} from 'tsdown';

export default defineConfig({
  clean: true,
  dts: true,
  entry: [
    'src/index.ts',
    'src/reader.ts',
    'src/readableStream.ts',
    'src/writableStream.ts',
    'src/packet.ts',
  ],
  format: 'esm',
  minify: {
    mangle: false,
  },
  outDir: 'lib',
  sourcemap: false,
  splitting: true,
  target: 'es2022',
  unbundle: true,
});
