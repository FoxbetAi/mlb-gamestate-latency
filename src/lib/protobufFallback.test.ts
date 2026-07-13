import { describe, expect, it } from "vitest";
import protobuf from "protobufjs";
import { decodeProtobufWithWellKnownTypes, schemaIdFromConfluentBuffer } from "./protobufFallback";

const schema = `
syntax = "proto3";
package foxbetai.trading.v1;
import "google/protobuf/struct.proto";
message ExampleFrame {
  string source = 1;
  google.protobuf.Value data_json = 2;
}
`;

describe("well-known Protobuf fallback", () => {
  it("decodes Confluent messages and unwraps google.protobuf.Value", () => {
    const structDefinition = protobuf.common.get("google/protobuf/struct.proto");
    if (!structDefinition) throw new Error("missing struct definitions");
    const root = protobuf.Root.fromJSON(structDefinition);
    protobuf.parse(schema, root);
    const type = root.lookupType("foxbetai.trading.v1.ExampleFrame");
    const payload = type.encode(type.create({
      source: "polymarket",
      dataJson: {
        structValue: {
          fields: {
            inning: { numberValue: 7 },
            live: { boolValue: true },
            teams: { listValue: { values: [{ stringValue: "Cubs" }, { stringValue: "Twins" }] } },
          },
        },
      },
    })).finish();
    const wire = Buffer.concat([Buffer.from([0, 0, 0, 0, 42, 0]), Buffer.from(payload)]);

    expect(schemaIdFromConfluentBuffer(wire)).toBe(42);
    expect(decodeProtobufWithWellKnownTypes(wire, schema)).toEqual({
      source: "polymarket",
      dataJson: { inning: 7, live: true, teams: ["Cubs", "Twins"] },
    });
  });
});
