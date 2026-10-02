These two immutable ZXing modules are copied byte-for-byte from the deployed V19
artifact. Keep them available for registers opened before V20; those tabs still
import these exact URLs when starting their camera. V20+ uses the independent
`/pos/barcode-decoder.js` asset and does not request these compatibility modules.
Do not regenerate these hashes with new content or remove them during a build.
