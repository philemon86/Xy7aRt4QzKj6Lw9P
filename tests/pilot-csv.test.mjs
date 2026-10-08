import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  encodePilotCsv,
  encodePilotFiles,
  pilotFilesBase64,
} from '../lib/pilot-csv.mjs';
import Pilot from '../lib/pilot-core.mjs';

test('PILOT CSV encodes actual CP950 bytes, quotes every cell, preserves leading zeros and CRLF', () => {
  const rows = [
    ['CUST', 'INVNAME', 'REMARK'],
    ['0002', '書展', '附註「書」,"引號"\r\n第二行'],
  ];
  const bytes = encodePilotCsv(rows, 'STKSALE1.csv');
  assert.deepEqual(Array.from(bytes.subarray(0, 6)), [34, 67, 85, 83, 84, 34]);
  // Independent CP950 byte values for 書展 (not UTF-8).
  assert.ok(Buffer.from(bytes).includes(Buffer.from([0xae, 0xd1, 0xae, 0x69])));
  const text = new TextDecoder('big5').decode(bytes);
  assert.equal(
    text,
    '"CUST","INVNAME","REMARK"\r\n"0002","書展","附註「書」,""引號""\r\n第二行"\r\n',
  );
  assert.equal(text.startsWith('\uFEFF'), false);
});

test('Unsupported characters report filename, field, row and original value before downloading any table', () => {
  assert.throws(
    () => encodePilotCsv([['INVNAME'], ['買受人😀']], 'STKSALE1.csv'),
    /STKSALE1.csv 第 2 列 INVNAME.*買受人😀/,
  );
  const rows = {
    stkSale1: [Pilot.STKSALE1_HEADER],
    stkSale2: [Pilot.STKSALE2_HEADER],
    vchrplus: [Pilot.VCHRPLUS_HEADER],
  };
  rows.stkSale2.push(
    Pilot.STKSALE2_HEADER.map((name) => (name === 'REMARK' ? '不支援😀' : '')),
  );
  assert.throws(() => pilotFilesBase64(rows), /STKSALE2.csv.*REMARK.*不支援😀/);
});

test('Base64 downloads reuse precisely the encoded snapshot without generating identities', () => {
  const rows = {
    stkSale1: [Pilot.STKSALE1_HEADER],
    stkSale2: [Pilot.STKSALE2_HEADER],
    vchrplus: [Pilot.VCHRPLUS_HEADER],
  };
  const before = JSON.stringify(rows),
    encoded = encodePilotFiles(rows);
  const first = pilotFilesBase64(rows),
    second = pilotFilesBase64(rows);
  assert.deepEqual(first, second);
  for (const key of Object.keys(first))
    assert.deepEqual(
      Buffer.from(first[key], 'base64'),
      Buffer.from(encoded[key]),
    );
  assert.equal(JSON.stringify(rows), before);
});

// The supplied reference lives in ignored work/, never published with private
// invoice contents. Run this test when auditing the provided successful files.
test(
  'Re-encoding all supplied successful CSVs reproduces their bytes exactly',
  { skip: !fs.existsSync('work/pilot-reference-rows.json') },
  () => {
    const rows = JSON.parse(
      fs.readFileSync('work/pilot-reference-rows.json', 'utf8'),
    );
    const filenames = {
      stkSale1: 'STKSALE1.csv',
      stkSale2: 'STKSALE2.csv',
      vchrplus: 'VCHRPLUS_SALE1.csv',
    };
    for (const [key, filename] of Object.entries(filenames)) {
      assert.deepEqual(
        rows[key][0],
        {
          stkSale1: Pilot.STKSALE1_HEADER,
          stkSale2: Pilot.STKSALE2_HEADER,
          vchrplus: Pilot.VCHRPLUS_HEADER,
        }[key],
      );
      assert.deepEqual(
        Buffer.from(encodePilotCsv(rows[key], filename)),
        fs.readFileSync('work/pilot-reference/最後成功基準/' + filename),
      );
    }
  },
);
