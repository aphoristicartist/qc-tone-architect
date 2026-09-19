const TRAILER_SIZE = 8;

export class QCMessageEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QCMessageEnvelopeError";
  }
}

export interface QCProtocolMessage {
  messageType: number;
  payload: Buffer;
  /** Device-populated trailer bytes whose meaning is not yet known. */
  metadata: Buffer;
}

/** Encodes the confirmed `protobuf ++ 8-byte trailer` message envelope. */
export function encodeProtocolMessage(
  messageType: number,
  protobufPayload: Uint8Array,
): Buffer {
  if (
    !Number.isSafeInteger(messageType) ||
    messageType < 0 ||
    messageType > 0xffff
  ) {
    throw new QCMessageEnvelopeError(
      "Message type must be an unsigned 16-bit integer",
    );
  }

  const trailer = Buffer.alloc(TRAILER_SIZE);
  trailer.writeUInt16LE(messageType, 0);
  return Buffer.concat([Buffer.from(protobufPayload), trailer]);
}

/** Decodes a complete reassembled message without interpreting its protobuf. */
export function decodeProtocolMessage(message: Uint8Array): QCProtocolMessage {
  if (message.byteLength < TRAILER_SIZE) {
    throw new QCMessageEnvelopeError(
      `Protocol message is shorter than its ${TRAILER_SIZE}-byte trailer`,
    );
  }

  const buffer = Buffer.from(message);
  const trailerOffset = buffer.byteLength - TRAILER_SIZE;
  return {
    messageType: buffer.readUInt16LE(trailerOffset),
    payload: Buffer.from(buffer.subarray(0, trailerOffset)),
    metadata: Buffer.from(buffer.subarray(trailerOffset + 2)),
  };
}
