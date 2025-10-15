// Extracted a few things from @types/node/util.d.ts, so we don't have to
// import the whole thing or actually depend on node.  If we're running in
// node, inspect will work, otherwise the functions will be ignored.

export type Style =
  'special' |
  'number' |
  'bigint' |
  'boolean' |
  'undefined' |
  'null' |
  'string' |
  'symbol' |
  'date' |
  'regexp' |
  'module';

export interface InspectOptions {
  depth?: number | null | undefined;
  colors?: boolean | undefined;
  maxArrayLength?: number | null | undefined;
  stylize(text: string, styleType: Style): string;
}

export type Inspect = (obj: unknown, options: InspectOptions) => string;

/**
 * Convert this Uint8Array to a hex string.
 *
 * @param u8 Array.
 * @returns String.
 */
export function u8toHex(u8: Uint8Array): string {
  return u8.reduce((t, v) => t + v.toString(16).padStart(2, '0'), '0x');
}

export const CUSTOM_INSPECT = Symbol.for('nodejs.util.inspect.custom');
