# Quad Cortex Protocol - Reverse Engineered

## Overview

The Neural DSP Quad Cortex communicates with Cortex Control over **USB HID** using
**Protocol Buffers v2** (`cortex_protobuf_v2`).

Reverse engineered from Cortex Control v4.0.1 (macOS arm64/x86_64 universal binary).

## USB Connection

| Property | Value |
|----------|-------|
| Vendor ID | `0x152a` (Neural DSP) |
| Product ID | `0x880a` (Quad Cortex) |
| Transport | USB 2.0 HID |
| Speed | 480 Mb/s |

## Architecture

```
┌──────────────┐     USB HID      ┌──────────────┐
│ Cortex       │◄────protobuf────►│ Quad Cortex  │
│ Control      │    messages       │ (CorOS)      │
│ (JUCE C++)   │                   │              │
└──────────────┘                   └──────────────┘
       │
       ├── neural::cortex::usb::Communicator
       │   ├── HidConnectionThread (connection management)
       │   └── HidDataHandler
       │       ├── HidSenderThread (outgoing messages)
       │       └── HidReceiverThread (incoming messages)
       │
       └── MessageSender classes (one per CortexMessageType)
           ├── GridMessageSender        → GridMessage
           ├── RecallPresetMessageSender → RecallPresetMessage
           ├── SceneMessageSender       → SceneMessage
           ├── GridMoveMessageSender    → GridMoveMessage
           ├── FileMessageSender        → FileMessage
           └── ... (54 message types total)
```

## Message Protocol

### HID report framing (confirmed for Cortex Control / CorOS 4.0.1)

Each complete message is split into 129-byte HID reports:

```
[report_id][payload_length: 0-126][flags][payload][padding]
```

- `0x40` in `flags` marks the first report.
- `0x80` in `flags` marks the final report.
- A single-report message uses both flags (`0xC0`).
- Continuation reports use neither flag; their final report uses `0x80`.
- Host-to-device reports use ID `0x02`; device-to-host reports use ID `0x01`.
- Host padding is zero. Device padding may be stale and must be ignored.
- The implementation and boundary tests live in `hid-framing.ts`.

CorOS 4.0.1 consumes output reports but deliberately stalls the HID control
transfer status stage. HID libraries therefore report every write as failed,
including the official client. A response timeout, not the write return value,
is the only reliable failure signal.

### Message envelope (confirmed for CorOS 4.0.1)

A reassembled message is:

```
[serialized protobuf][message type: uint16 little-endian][six trailer bytes]
```

The host sends six zero trailer bytes. The device sometimes populates the last
two; their meaning is unknown and they are preserved but ignored. There is no
total-length field. The implementation lives in `message-envelope.ts`.

Most protobuf messages include a MessageAction field
(CREATE/UPDATE/DELETE/READ/MOVE/COPY/UPLOAD/DOWNLOAD/SWAP). The message type is
not part of the protobuf; it is in the trailer.

The protocol is unversioned. These findings must be compatibility-gated and
reverified after any CorOS update. Captured frame fixtures and live hardware
findings are also documented by the MIT-licensed
[`pyquadcortex`](https://github.com/stokes-audio/pyquadcortex) project.

### Key Message Types for Preset Automation

| Type ID | Name | Purpose |
|---------|------|---------|
| 1 | Grid | Read/update the signal chain grid (contains full BinaryPreset) |
| 4 | File | Create/read/update/delete presets, captures, IRs |
| 12 | GridMove | Move blocks within the grid |
| 13 | Scene | Select/switch scenes |
| 15 | RecallPreset | Load a preset by position |
| 19 | DefaultParameters | Set default model parameters |
| 22 | SceneCopy | Copy scene settings |
| 23 | SceneLabel | Set scene names |
| 48 | SceneColor | Set scene colors |
| 51 | ModelRepo | Browse available models/effects |

### BinaryPreset Structure

```
BinaryPreset
├── name, author_name, author_id, date, tempo
├── volume, pan, default_scene
├── chains[] (4 rows = 4 chains)
│   ├── row, in_portid, out_portid
│   ├── models[] (blocks in this row)
│   │   ├── hash (model identifier - e.g., amp, effect)
│   │   ├── column (position 0-7)
│   │   └── params[]
│   │       ├── index
│   │       ├── param_values[] (8 values = 8 scenes)
│   │       │   ├── int_value
│   │       │   ├── float_value
│   │       │   └── string_value
│   │       ├── expression (pedal assignment)
│   │       └── scene_mode (per-scene params)
│   ├── splitter[], mixer[], input_control[], output_control[]
│   └── split_control_points
├── bypass[] (per-row, per-column, per-scene bypass states)
├── scene_labels[] (8 scene names)
├── scene_colors[] (8 scene colors)
├── scene_tempo[] (per-scene tempo)
├── tags[]
└── stomp_mode_assignments[]
```

## Model lookup

The `Model.hash` field is a uint32 model ID. The typed session reads ModelRepo
message 51, safely extracts its gzip/tar XML, and builds an immutable live
catalog. Generated devices use firmware-backed factory IDs; each ID and exact
control name must also resolve uniquely in the live catalog before a transfer.

## Files

- `preset.proto` - BinaryPreset and related message definitions
- `messages.proto` - CortexMessageType, communication messages, I/O settings

## Implemented safety boundary

1. The typed session performs reset, version negotiation, ModelRepo loading,
   connection announcement, subscriptions, keepalive, request correlation, and
   clean disconnect.
2. The browser requests a read-only firmware/catalog/grid preflight before it
   displays write confirmation. The mutating transaction repeats that preflight
   to prevent stale readiness from bypassing safety checks.
3. Transfer requires the target cells to be empty, so rollback can remove only
   blocks inserted by this transaction and never guess how to reconstruct user
   content.
4. Parameter values use the device's normalized 0.0-1.0 scale. Scene parameters
   are promoted with the flag in its own message, then written against the
   active scene.
5. Scene-specific bypass is not generated: firmware does not allow the host to
   enable bypass scene mode on a newly placed block. Wet-effect scenes vary an
   existing `MIX` control instead.
6. CorOS 4.0.1 / app `d14e` and CorOS 4.1.0 / app `d14e` have completed the
   opt-in mutation, read-back, rollback, and restoration HIL flow. Every other
   firmware pair remains write-blocked until it completes the same process.
