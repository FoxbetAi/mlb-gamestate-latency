import { randomUUID } from "node:crypto";
import { SchemaRegistry } from "@kafkajs/confluent-schema-registry";
import { Kafka, logLevel, type Consumer, type SASLOptions } from "kafkajs";
import type { Middleware } from "mappersmith";
import { decodeProtobufWithWellKnownTypes, schemaIdFromConfluentBuffer } from "./protobufFallback";
import { getRedpandaCloudToken, hasCloudOidcConfig } from "./redpandaOauth";
import { TOPICS } from "./topics";

type SaslMechanism = "plain" | "scram-sha-256" | "scram-sha-512";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

export function hasRedpandaConfig() {
  const hasEndpoints = Boolean(process.env.REDPANDA_BROKERS?.trim() && process.env.SCHEMA_REGISTRY_URL?.trim());
  const hasStaticAuth = Boolean(process.env.REDPANDA_USERNAME?.trim() && process.env.REDPANDA_PASSWORD?.trim());
  return hasEndpoints && (hasCloudOidcConfig() || hasStaticAuth);
}

export function createRegistry() {
  const username = process.env.SCHEMA_REGISTRY_USERNAME?.trim();
  const password = process.env.SCHEMA_REGISTRY_PASSWORD?.trim();
  const cloudOidcMiddleware: Middleware = () => ({
    async prepareRequest(next) {
      const request = await next();
      return request.enhance({ headers: { Authorization: `Bearer ${await getRedpandaCloudToken()}` } });
    },
  });
  const registry = new SchemaRegistry({
    host: required("SCHEMA_REGISTRY_URL"),
    ...(username && password ? { auth: { username, password } } : {}),
    ...(hasCloudOidcConfig() ? { middlewares: [cloudOidcMiddleware] } : {}),
    retry: { retries: 4, initialRetryTimeInSecs: 0.2, maxRetryTimeInSecs: 6, factor: 0.2, multiplier: 2 },
  });
  const fallbackSchemas = new Map<number, Promise<string>>();

  const fetchSchema = (id: number) => {
    const cached = fallbackSchemas.get(id);
    if (cached) return cached;
    const pending = (async () => {
      const headers: Record<string, string> = {};
      if (hasCloudOidcConfig()) {
        headers.Authorization = `Bearer ${await getRedpandaCloudToken()}`;
      } else if (username && password) {
        headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
      }
      const host = required("SCHEMA_REGISTRY_URL").replace(/\/$/, "");
      const response = await fetch(`${host}/schemas/ids/${id}`, { headers, cache: "no-store" });
      if (!response.ok) throw new Error(`Schema Registry returned HTTP ${response.status} for schema ${id}`);
      const body = await response.json() as { schema?: unknown; schemaType?: unknown };
      if (body.schemaType !== "PROTOBUF" || typeof body.schema !== "string") {
        throw new Error(`Schema ${id} is not a Protobuf schema`);
      }
      return body.schema;
    })();
    fallbackSchemas.set(id, pending);
    pending.catch(() => fallbackSchemas.delete(id));
    return pending;
  };

  return {
    async decode(buffer: Buffer) {
      try {
        return await registry.decode(buffer);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!message.includes("google.protobuf.")) throw error;
        const id = schemaIdFromConfluentBuffer(buffer);
        return decodeProtobufWithWellKnownTypes(buffer, await fetchSchema(id));
      }
    },
  };
}

export function createConsumer(): Consumer {
  let sasl: SASLOptions;
  if (hasCloudOidcConfig()) {
    sasl = { mechanism: "oauthbearer", oauthBearerProvider: async () => ({ value: await getRedpandaCloudToken() }) };
  } else {
    const mechanism = (process.env.REDPANDA_SASL_MECHANISM?.trim() || "scram-sha-256") as SaslMechanism;
    const username = required("REDPANDA_USERNAME");
    const password = required("REDPANDA_PASSWORD");
    sasl = mechanism === "plain"
      ? { mechanism: "plain", username, password }
      : mechanism === "scram-sha-512"
        ? { mechanism: "scram-sha-512", username, password }
        : { mechanism: "scram-sha-256", username, password };
  }
  const kafka = new Kafka({
    clientId: "mlb-gamestate-latency",
    brokers: required("REDPANDA_BROKERS").split(",").map((broker) => broker.trim()).filter(Boolean),
    ssl: process.env.REDPANDA_TLS !== "false",
    sasl,
    connectionTimeout: 10_000,
    requestTimeout: 30_000,
    logLevel: logLevel.ERROR,
  });
  return kafka.consumer({
    groupId: `mlb-latency-${Date.now()}-${randomUUID()}`,
    sessionTimeout: 30_000,
    heartbeatInterval: 3_000,
    allowAutoTopicCreation: false,
  });
}

export const MLB_TOPICS = TOPICS.map((definition) => definition.topic);
