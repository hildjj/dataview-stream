/**
 * Run these tests with the new float16 support disabled, to simulate
 * older node versions.
 *
 * @param f Test function.
 */
export function withNo16(f: () => void): void {
  const {getFloat16} = DataView.prototype;
  const {f16round} = Math;

  // @ts-expect-error Hack.
  delete DataView.prototype.getFloat16;
  // @ts-expect-error Hack.
  delete Math.f16round;

  f();

  // eslint-disable-next-line no-extend-native
  DataView.prototype.getFloat16 = getFloat16;
  Math.f16round = f16round;
}
