// bleUuids.test.js -- the BLE service/characteristic uuids exist twice, in two
// languages, in two runtimes that never import from each other:
// Box-code/lib/lock_config.py (CircuitPython, on the box) and
// app/src/ble/protocol.ts (TypeScript, in a React Native bundle). Both files
// say to keep them in step by hand. Nothing checked that anyone had.
//
// A drift here does not fail loudly, which is exactly why it is worth a test.
// The app scans BY the service uuid, so a changed service uuid means the box
// simply never appears -- indistinguishable from a box that is off, out of
// range, or flat. A changed CHARACTERISTIC uuid is worse: the connection
// succeeds and only the one feature behind that characteristic goes quiet (no
// status ticks, or history that never drains, or a settings write that lands
// nowhere), which reads as a flaky box rather than a broken build.
//
// Lives at the repo root, not in either sub-project, because it belongs to
// neither: it is a claim ABOUT the pair. Both sides are read as TEXT rather
// than imported -- one of them is Python, and the other pulls in React Native
// the moment it is imported. That also keeps app/tsconfig.json's deliberate
// exclusion of Node globals from app code intact (see its own comment).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..', '..');

const firmware = readFileSync(path.join(repoRoot, 'Box-code', 'lib', 'lock_config.py'), 'utf8');
const appProtocol = readFileSync(path.join(repoRoot, 'app', 'src', 'ble', 'protocol.ts'), 'utf8');

/** `NAME = "uuid"` in lock_config.py. */
function firmwareUuid(name) {
  const m = new RegExp(`^${name}\\s*=\\s*"([0-9a-fA-F-]+)"`, 'm').exec(firmware);
  return m ? m[1] : undefined;
}

/** `export const SERVICE_UUID = '...'` in protocol.ts. */
function appServiceUuid() {
  const m = /export const SERVICE_UUID\s*=\s*'([0-9a-fA-F-]+)'/.exec(appProtocol);
  return m ? m[1] : undefined;
}

/** One `key: '...'` entry of protocol.ts's CHAR map. */
function appCharUuid(key) {
  const block = /export const CHAR = \{([\s\S]*?)\}/.exec(appProtocol);
  if (!block) return undefined;
  const m = new RegExp(`\\b${key}\\s*:\\s*'([0-9a-fA-F-]+)'`).exec(block[1]);
  return m ? m[1] : undefined;
}

/** Every characteristic key protocol.ts declares, so a new one added there
 * without a line in the table below fails rather than going unchecked. */
function appCharKeys() {
  const block = /export const CHAR = \{([\s\S]*?)\}/.exec(appProtocol);
  return block ? [...block[1].matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]).sort() : [];
}

// firmware constant -> protocol.ts CHAR key
const CHARACTERISTICS = [
  ['BLE_UUID_STATUS', 'status'],
  ['BLE_UUID_HISTORY', 'history'],
  ['BLE_UUID_COMMAND', 'command'],
  ['BLE_UUID_SETTINGS', 'settings'],
  ['BLE_UUID_TIME', 'timeSync'],
  ['BLE_UUID_ALERT', 'alert'],
  ['BLE_UUID_LABELS', 'labels'],
  ['BLE_UUID_PENDING_TOPIC', 'pendingTopic'],
];

describe('BLE uuids are the same on the box and in the app', () => {
  // Guards every case below against passing vacuously: both sides are parsed
  // out of source text, so a rename or a reformat that defeats a regex must
  // fail here rather than quietly comparing undefined to undefined.
  it('finds both sides of the contract', () => {
    assert.ok(firmware.includes('BLE_SERVICE_UUID'), 'lock_config.py no longer declares BLE_SERVICE_UUID');
    assert.match(appServiceUuid() ?? '', /^[0-9a-f-]{36}$/, 'protocol.ts no longer declares SERVICE_UUID');
    for (const [firmwareName, key] of CHARACTERISTICS) {
      assert.match(firmwareUuid(firmwareName) ?? '', /^[0-9a-f-]{36}$/, `lock_config.py: ${firmwareName} not found`);
      assert.match(appCharUuid(key) ?? '', /^[0-9a-f-]{36}$/, `protocol.ts: CHAR.${key} not found`);
    }
  });

  it('agrees on the service uuid the app scans for', () => {
    assert.equal(appServiceUuid(), firmwareUuid('BLE_SERVICE_UUID'));
  });

  for (const [firmwareName, key] of CHARACTERISTICS) {
    it(`agrees on the ${key} characteristic`, () => {
      assert.equal(appCharUuid(key), firmwareUuid(firmwareName));
    });
  }

  it('checks every characteristic the app declares', () => {
    assert.deepEqual(appCharKeys(), CHARACTERISTICS.map(([, key]) => key).sort());
  });

  it('gives every characteristic a distinct uuid', () => {
    // A copy-paste that points two characteristics at one uuid would leave
    // both sides "in step" and the box still broken.
    const all = [appServiceUuid(), ...CHARACTERISTICS.map(([, key]) => appCharUuid(key))];
    assert.equal(new Set(all).size, all.length);
  });
});
