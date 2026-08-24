---
name: ble-protocol
description: The PhoneBox BLE GATT wire contract between the app and the box firmware -- characteristic UUIDs, payload shapes, and where the firmware mirror lives. Load this before touching app/src/ble/** or explaining/changing anything that crosses the BLE link.
disable-model-invocation: false
user-invocable: false
---

# PhoneBox BLE protocol

The contract lives in **two places that must stay in lockstep**:

- App side: [app/src/ble/protocol.ts](../../../app/src/ble/protocol.ts)
- Firmware side: `Box-code/lib/lock_config.py` (UUIDs), `Box-code/lib/lock_ble.py` / `lock_controller.py` (payload handling)

If you change a UUID, a JSON key, or a value's meaning on one side, you **must** change the other. There is no version negotiation -- a mismatch just silently fails to parse.

## Service and characteristics

`SERVICE_UUID = 6b9a7e00-4c2a-4f8e-9b21-9d7a5e3c0001`

| Characteristic | Direction | Purpose |
|---|---|---|
| `status` | box -> app (READ/NOTIFY) | live box state (`Status`) |
| `history` | box -> app (READ/NOTIFY) | queued session log (`HistoryEntry[]`) |
| `command` | app -> box (WRITE) | opcodes: `start:`, `dur:`, `lock`, `unlock`, `historyAck:` |
| `settings` | round-trip (READ/WRITE) | `Settings` JSON |
| `timeSync` | app -> box (WRITE) | epoch seconds, plain string |
| `alert` | app -> box (WRITE) | incoming-call label, `nonce\|label` |
| `labels` | app -> box (WRITE) | custom label catalog JSON |

## Payload shapes

All box->app and settings payloads are compact-key JSON (short keys to save BLE bytes). Parsers in `protocol.ts` (`parseStatus`, `parseHistoryEntries`, `parseSettings`) are defensive: the radio can hand back partial/garbled JSON, so every field has a fallback and a bad parse returns `null`/`[]`, never throws.

Key shapes:
- `Status`: `st` (idle/closed/running/done), `rem`, `set`, `bat` (-1 = unavailable), `tp` (topic id, echoed only if chosen on-box), `fw`.
- `HistoryEntry`: `p` planned seconds, `a` actual seconds, `c` (1=completed, 0=ended early), `t` epoch or -1 if never time-synced. The box holds these in RAM only (no SD/NVM) -- the app is the durable copy, and must ack via `cmdHistoryAck(seq)` once persisted.
- `Settings`: `ovr`, `auto`, `sleep`, `bright`, `unlk` (remote unlock, opt-in), `ucal` (unlock-when-called, opt-in, fires from the alert path not a deliberate tap -- distinct from `unlk`), `thm` (phone is authoritative, box's echo is not read back), `acc` (accent index, box applies it to decorative UI only, never to lock/closed/unlocked status indicators).

## Encoders (app -> box)

`cmdStart`, `cmdSetDuration`, `cmdLock`, `cmdUnlock` clamp numeric input (`Math.max(0, Math.floor(...))`). `encodeSettings` also clamps every numeric field defensively -- this is deliberate belt-and-suspenders on top of firmware-side clamping in `lock_controller.py`, not redundant: an unclamped `NaN`/`Infinity` would serialize to an invalid JSON token and abort the box's parse of the *entire* settings write with no diagnostic.

`cmdSetLabels` / `BLE_LABEL_MAX_COUNT` (8) / `BLE_LABEL_NAME_MAX_LEN` (12) mirror `lock_config.py`'s `BLE_LABEL_MAX_COUNT`/`BLE_LABEL_NAME_MAX_LEN` exactly, and write `CHAR.labels` directly rather than going through the `command` opcode path.

## When editing this contract

1. Change `protocol.ts` and the matching `Box-code/lib/lock_*.py` file in the same change.
2. Preserve the defensive-parsing style -- never let a malformed BLE payload throw.
3. Update [protocol.test.ts](../../../app/src/ble/protocol.test.ts) alongside any shape change.
4. If you add a characteristic, check whether `security-reviewer` (see `.claude/agents/security-reviewer.md`) needs to review it for replay/spoofing risk.
