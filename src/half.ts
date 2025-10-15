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

/**
 * Return a big-endian unsigned integer that has the same internal layout
 * as the given number as a float16, if it fits.  Otherwise returns null.
 *
 * @param half The number to convert to a half-precision float.  Must fit into
 *   at least a float32.
 * @returns Number on success, otherwise null.  Make sure to check with
 *   `=== null`, in case this returns 0, which is valid.
 */
export function halfToUint(half: number): number | null {
  // Translation of cn-cbor's C code (from Carsten Borman):
  if (!Object.is(Math.fround(half), half)) {
    return null; // Needs an f64
  }
  const dvu32 = new DataView(new ArrayBuffer(4));
  dvu32.setFloat32(0, half, false);
  const u = dvu32.getUint32(0, false);

  // If the lower 13 bits aren't 0,
  // we will lose precision in the conversion.
  // mant32 = 24bits, mant16 = 11bits, 24-11 = 13
  if ((u & 0x1FFF) !== 0) {
    return null;
  }

  let s16 = (u >> 16) & 0x8000; // Top bit is sign
  const exp = (u >> 23) & 0xff; // Then 8 bits of exponent
  const mant = u & 0x7fffff; // Then 23 bits of mantissa

  if ((exp === 0) && (mant === 0)) {
    // No-op.  Sign already in s16.  -0 or 0.
  } else if ((exp >= 113) && (exp <= 142)) {
    // Normal number.  Shift the exponent and mantissa to fit.
    s16 += ((exp - 112) << 10) + (mant >> 13);
  } else if ((exp >= 103) && (exp < 113)) {
    // Denormalized numbers.
    if (mant & ((1 << (126 - exp)) - 1)) {
      // Loses precision further.
      return null;
    }
    s16 += ((mant + 0x800000) >> (126 - exp));
  } else if (exp === 255) {
    // NaN and Infinities.
    s16 |= 0x7c00;
    s16 |= mant >> 13;
  } else {
    // Outside of half range.
    return null;
  }

  return s16;
}

/**
 * Will this number fit into a float51 without losing precision?
 *
 * @param n Number to check.
 * @returns True if this is an eligible f16.
 */
export function isF16(n: number): boolean {
  if (Math.f16round) {
    // Should work for -0, NaN, Infinities
    return Object.is(n, Math.f16round(n));
  }
  return halfToUint(n) !== null;
}
