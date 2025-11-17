/**
 * This has to be run on node 24+, to generate f16.json, which can be used
 * for testing on any version.
 */

/* eslint-disable no-console */
const u16 = new Uint8Array(2);
const dv = new DataView(u16.buffer);

function q(n) {
  if (Object.is(n, -0)) {
    return '-0';
  }
  return String(n);
}
console.log('{');
for (let i = 0; i <= 0xffff; i++) {
  dv.setUint16(0, i);
  const n = dv.getFloat16(0);
  console.log(`  "${i.toString(16).padStart(4, '0')}": "${q(n)}"${i === 0xffff ? '' : ','}`);
}
console.log('}');
