"""Generate the strict CP950 encoder table; no WHATWG/HKSCS substitutions."""
import json
from pathlib import Path

mapping = {}
for codepoint in range(128, 65536):
    character = chr(codepoint)
    try:
        encoded = character.encode('cp950', errors='strict')
    except UnicodeEncodeError:
        continue
    if len(encoded) == 2:
        mapping[str(ord(character))] = int.from_bytes(encoded, 'big')
target = Path(__file__).resolve().parent.parent / 'lib' / 'cp950-map.json'
target.write_text(json.dumps(mapping, separators=(',', ':')) + '\n', encoding='utf-8')
print(f'Generated {len(mapping)} CP950 characters')
