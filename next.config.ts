import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["kafkajs", "@kafkajs/confluent-schema-registry"],
};

export default nextConfig;
