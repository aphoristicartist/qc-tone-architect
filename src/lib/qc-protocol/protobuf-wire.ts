export class QCProtobufError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QCProtobufError";
  }
}

export type QCProtobufField =
  | { wireType: 0; value: bigint }
  | { wireType: 1 | 2 | 5; value: Buffer };

export type QCProtobufFields = ReadonlyMap<
  number,
  readonly QCProtobufField[]
>;

const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);
const MAX_UINT64 = (BIGINT_ONE << BigInt(64)) - BIGINT_ONE;

function checkedUnsigned(value: number | bigint): bigint {
  const integer = typeof value === "bigint" ? value : BigInt(value);
  if (
    (typeof value === "number" && !Number.isSafeInteger(value)) ||
    integer < BIGINT_ZERO ||
    integer > MAX_UINT64
  ) {
    throw new QCProtobufError("Varint value must be an unsigned 64-bit integer");
  }
  return integer;
}

export function encodeVarint(value: number | bigint): Buffer {
  let remaining = checkedUnsigned(value);
  const bytes: number[] = [];
  do {
    let byte = Number(remaining & BigInt(0x7f));
    remaining >>= BigInt(7);
    if (remaining !== BIGINT_ZERO) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== BIGINT_ZERO);
  return Buffer.from(bytes);
}

function fieldKey(fieldNumber: number, wireType: number): Buffer {
  if (!Number.isSafeInteger(fieldNumber) || fieldNumber < 1) {
    throw new QCProtobufError("Field number must be a positive integer");
  }
  return encodeVarint(
    BigInt(fieldNumber) * BigInt(8) + BigInt(wireType),
  );
}

export function encodeVarintField(
  fieldNumber: number,
  value: number | bigint | boolean,
): Buffer {
  return Buffer.concat([
    fieldKey(fieldNumber, 0),
    encodeVarint(typeof value === "boolean" ? Number(value) : value),
  ]);
}

export function encodeInt32Field(fieldNumber: number, value: number): Buffer {
  if (!Number.isInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff) {
    throw new QCProtobufError("int32 field value is out of range");
  }
  return Buffer.concat([
    fieldKey(fieldNumber, 0),
    encodeVarint(BigInt.asUintN(64, BigInt(value))),
  ]);
}

export function encodeBytesField(
  fieldNumber: number,
  value: Uint8Array,
): Buffer {
  const bytes = Buffer.from(value);
  return Buffer.concat([
    fieldKey(fieldNumber, 2),
    encodeVarint(bytes.byteLength),
    bytes,
  ]);
}

export function encodeStringField(fieldNumber: number, value: string): Buffer {
  return encodeBytesField(fieldNumber, Buffer.from(value, "utf8"));
}

export function encodeFloatField(fieldNumber: number, value: number): Buffer {
  if (!Number.isFinite(value)) {
    throw new QCProtobufError("Float field value must be finite");
  }
  const bytes = Buffer.alloc(4);
  bytes.writeFloatLE(value);
  return Buffer.concat([fieldKey(fieldNumber, 5), bytes]);
}

interface DecodedVarint {
  value: bigint;
  offset: number;
}

function decodeVarint(buffer: Buffer, offset: number): DecodedVarint {
  let value = BIGINT_ZERO;
  for (let index = 0; index < 10; index += 1) {
    if (offset >= buffer.byteLength) {
      throw new QCProtobufError("Truncated protobuf varint");
    }
    const byte = buffer[offset];
    offset += 1;
    value |= BigInt(byte & 0x7f) << BigInt(index * 7);
    if ((byte & 0x80) === 0) {
      if (index === 9 && byte > 1) {
        throw new QCProtobufError("Protobuf varint exceeds 64 bits");
      }
      return { value, offset };
    }
  }
  throw new QCProtobufError("Protobuf varint exceeds 10 bytes");
}

function safeLength(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new QCProtobufError("Protobuf length exceeds the safe integer range");
  }
  return Number(value);
}

export function decodeProtobufFields(payload: Uint8Array): QCProtobufFields {
  const buffer = Buffer.from(payload);
  const fields = new Map<number, QCProtobufField[]>();
  let offset = 0;

  while (offset < buffer.byteLength) {
    const key = decodeVarint(buffer, offset);
    offset = key.offset;
    const fieldNumber = Number(key.value >> BigInt(3));
    const wireType = Number(key.value & BigInt(7));
    if (!Number.isSafeInteger(fieldNumber) || fieldNumber < 1) {
      throw new QCProtobufError("Invalid protobuf field number");
    }

    let field: QCProtobufField;
    if (wireType === 0) {
      const decoded = decodeVarint(buffer, offset);
      offset = decoded.offset;
      field = { wireType, value: decoded.value };
    } else if (wireType === 1 || wireType === 5) {
      const width = wireType === 1 ? 8 : 4;
      if (offset + width > buffer.byteLength) {
        throw new QCProtobufError("Truncated fixed-width protobuf field");
      }
      field = {
        wireType,
        value: Buffer.from(buffer.subarray(offset, offset + width)),
      };
      offset += width;
    } else if (wireType === 2) {
      const decodedLength = decodeVarint(buffer, offset);
      offset = decodedLength.offset;
      const length = safeLength(decodedLength.value);
      if (length > buffer.byteLength - offset) {
        throw new QCProtobufError("Truncated length-delimited protobuf field");
      }
      field = {
        wireType,
        value: Buffer.from(buffer.subarray(offset, offset + length)),
      };
      offset += length;
    } else {
      throw new QCProtobufError(`Unsupported protobuf wire type ${wireType}`);
    }

    const occurrences = fields.get(fieldNumber) ?? [];
    occurrences.push(field);
    fields.set(fieldNumber, occurrences);
  }

  return fields;
}

export function firstVarint(
  fields: QCProtobufFields,
  fieldNumber: number,
): bigint | undefined {
  const field = fields.get(fieldNumber)?.[0];
  return field?.wireType === 0 ? field.value : undefined;
}

export function firstBytes(
  fields: QCProtobufFields,
  fieldNumber: number,
): Buffer | undefined {
  const field = fields.get(fieldNumber)?.[0];
  return field?.wireType === 2 ? Buffer.from(field.value) : undefined;
}

export function firstString(
  fields: QCProtobufFields,
  fieldNumber: number,
): string | undefined {
  return firstBytes(fields, fieldNumber)?.toString("utf8");
}

export function allBytes(
  fields: QCProtobufFields,
  fieldNumber: number,
): Buffer[] {
  return (fields.get(fieldNumber) ?? []).flatMap((field) =>
    field.wireType === 2 ? [Buffer.from(field.value)] : [],
  );
}

export function firstFloat(
  fields: QCProtobufFields,
  fieldNumber: number,
): number | undefined {
  const field = fields.get(fieldNumber)?.[0];
  return field?.wireType === 5 ? field.value.readFloatLE(0) : undefined;
}
