import { randomUUID } from "node:crypto";
import { SchemaRegistry } from "@kafkajs/confluent-schema-registry";
import { Kafka, logLevel, type Consumer, type SASLOptions } from "kafkajs";
import { TOPICS } from "./topics";

type SaslMechanism = "plain" | "scram-sha-256" | "scram-sha-512";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

export function hasRedpandaConfig() {
  return Boolean(process.env.REDPANDA_BROKERS && process.env.REDPANDA_USERNAME && process.env.REDPANDA_PASSWORD && process.env.SCHEMA_REGISTRY_URL);
}

export function createRegistry() {
  const username = process.env.SCHEMA_REGISTRY_USERNAME?.trim();
  const password = process.env.SCHEMA_REGISTRY_PASSWORD?.trim();
  return new SchemaRegistry({
    host: required("SCHEMA_REGISTRY_URL"),
    ...(username && password ? { auth: { username, password } } : {}),
    retry: { retries: 4, initialRetryTimeInSecs: 0.2, maxRetryTimeInSecs: 6, factor: 0.2, multiplier: 2 },
  });
}

export function createConsumer(): Consumer {
  const mechanism = (process.env.REDPANDA_SASL_MECHANISM?.trim() || "scram-sha-256") as SaslMechanism;
  const username = required("REDPANDA_USERNAME");
  const password = required("REDPANDA_PASSWORD");
  const sasl: SASLOptions = mechanism === "plain"
    ? { mechanism: "plain", username, password }
    : mechanism === "scram-sha-512"
      ? { mechanism: "scram-sha-512", username, password }
      : { mechanism: "scram-sha-256", username, password };
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
