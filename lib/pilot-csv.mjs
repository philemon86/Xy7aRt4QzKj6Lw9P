import cp950 from './cp950-map.json' with { type: 'json' };

export const PILOT_FILENAMES = Object.freeze({
  stkSale1: 'STKSALE1.csv',
  stkSale2: 'STKSALE2.csv',
  vchrplus: 'VCHRPLUS_SALE1.csv',
});

// Encoding happens before any download. Unrepresentable text must be corrected
// explicitly, never silently replaced with '?' or a different Chinese character.
export function encodePilotCsv(rows, filename = 'PILOT.csv') {
  const chunks = [];
  let length = 0;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const bytes = [];
    rows[rowIndex].forEach((value, column) => {
      if (column) bytes.push(44);
      bytes.push(34);
      const text = String(value ?? '');
      for (const char of text) {
        const code = char.codePointAt(0);
        if (code < 128) {
          bytes.push(code);
          if (code === 34) bytes.push(34);
        } else {
          const encoded = cp950[code];
          if (encoded === undefined)
            throw Error(
              `${filename} 第 ${rowIndex + 1} 列 ${rows[0][column]} 無法以 Big5 / CP950 編碼：${JSON.stringify(text)}（字元 ${char}）`,
            );
          bytes.push(encoded >> 8, encoded & 255);
        }
      }
      bytes.push(34);
    });
    bytes.push(13, 10);
    const chunk = Uint8Array.from(bytes);
    chunks.push(chunk);
    length += chunk.length;
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export function encodePilotFiles(rows) {
  return Object.fromEntries(
    Object.entries(PILOT_FILENAMES).map(([key, filename]) => [
      key,
      encodePilotCsv(rows[key], filename),
    ]),
  );
}

export function pilotFilesBase64(rows) {
  const encoded = encodePilotFiles(rows);
  return Object.fromEntries(
    Object.entries(encoded).map(([key, bytes]) => {
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return [key, btoa(binary)];
    }),
  );
}
