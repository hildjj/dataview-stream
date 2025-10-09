// This code extracted from cbor2.

/**
 * Parse a big endian float16 from a buffer.
 *
 * @param buf Buffer to read from.
 * @param offset Offset into buf to start reading 2 octets.
 * @param littleEndian Bytes swapped?
 * @returns Parsed float.
 */
export function parseHalf(
  buf: Uint8Array,
  offset = 0,
  littleEndian = false
): number {
  const [first, second] = littleEndian ?
    [buf[offset + 1], buf[offset]] :
    [buf[offset], buf[offset + 1]];

  const sign = first & 0x80 ? -1 : 1;
  const exp = (first & 0x7C) >> 2;
  const mant = ((first & 0x03) << 8) | second;
  if (exp === 0) {
    return sign * 5.9604644775390625e-8 * mant;
  } else if (exp === 0x1f) {
    if (mant) {
      // Always simplify NaNs, since non-simple NaNs are different in different
      // JS engines.
      return NaN;
    }
    return sign * Infinity;
  }
  return sign * (2 ** (exp - 25)) * (1024 + mant);
}
