import protobuf from "protobufjs";

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const unwrapValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(unwrapValue);
  if (!isRecord(value)) return value;

  if ("nullValue" in value) return null;
  if ("numberValue" in value) return value.numberValue;
  if ("stringValue" in value) return value.stringValue;
  if ("boolValue" in value) return value.boolValue;
  if (isRecord(value.structValue) && isRecord(value.structValue.fields)) {
    return Object.fromEntries(Object.entries(value.structValue.fields).map(([key, child]) => [key, unwrapValue(child)]));
  }
  if (isRecord(value.listValue) && Array.isArray(value.listValue.values)) {
    return value.listValue.values.map(unwrapValue);
  }

  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, unwrapValue(child)]));
};

const topLevelMessageName = (schema: string) => {
  const match = schema.match(/^\s*message\s+([A-Za-z_]\w*)/m);
  if (!match) throw new Error("Protobuf schema has no top-level message");
  return match[1];
};

export const schemaIdFromConfluentBuffer = (buffer: Buffer) => {
  if (buffer.length < 6 || buffer[0] !== 0) throw new Error("Invalid Confluent Protobuf message");
  return buffer.readUInt32BE(1);
};

export function decodeProtobufWithWellKnownTypes(buffer: Buffer, schema: string): unknown {
  schemaIdFromConfluentBuffer(buffer);
  const structDefinition = protobuf.common.get("google/protobuf/struct.proto");
  if (!structDefinition) throw new Error("protobufjs struct definitions are unavailable");

  const root = protobuf.Root.fromJSON(structDefinition);
  const parsed = protobuf.parse(schema, root);
  const messageName = topLevelMessageName(schema);
  const qualifiedName = parsed.package ? `${parsed.package}.${messageName}` : messageName;
  const messageType = root.lookupType(qualifiedName);

  // The schemas in these topics use the first top-level message, whose
  // Confluent message-index path is the single-byte zero optimization.
  let payloadOffset = 5;
  while (payloadOffset < buffer.length && buffer[payloadOffset] === 0) payloadOffset += 1;
  const decoded = messageType.decode(buffer.subarray(payloadOffset));
  const plain = messageType.toObject(decoded, { longs: Number, enums: String, bytes: Buffer });
  return unwrapValue(plain);
}
