// Synthetic Code 39 bars; contains no real customer's carrier or camera image.
export function code39Bits(text) {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';
  const patterns = [0x034,0x121,0x061,0x160,0x031,0x130,0x070,0x025,0x124,0x064,
    0x109,0x049,0x148,0x019,0x118,0x058,0x00d,0x10c,0x04c,0x01c,
    0x103,0x043,0x142,0x013,0x112,0x052,0x007,0x106,0x046,0x016,
    0x181,0x0c1,0x1c0,0x091,0x190,0x0d0,0x085,0x184,0x0c4,0x0a8,
    0x0a2,0x08a,0x02a];
  return '0'.repeat(20) + [...('*' + text + '*')].map(char => {
    const pattern = char === '*' ? 0x094 : patterns[alphabet.indexOf(char)];
    if (pattern === undefined) throw Error('Unsupported fixture character: ' + char);
    return Array.from({length:9}, (_,i) => (i % 2 ? '0' : '1').repeat(pattern & (1 << (8-i)) ? 3 : 1)).join('') + '0';
  }).join('') + '0'.repeat(20);
}

// The existing product scanner is tested with the retail EAN format it uses.
export function productEANBits() {
  const digits='4006381333931';
  const patterns=['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
  const invert=bits=>[...bits].map(bit=>bit==='0'?'1':'0').join('');
  let bits='101';
  for(let i=1;i<7;i++)bits+='LGLLGG'[i-1]==='L'?patterns[Number(digits[i])]:[...invert(patterns[Number(digits[i])])].reverse().join('');
  bits+='01010';for(let i=7;i<13;i++)bits+=invert(patterns[Number(digits[i])]);
  return '0'.repeat(20)+bits+'101'+'0'.repeat(20);
}
