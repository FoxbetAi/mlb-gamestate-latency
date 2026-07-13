import { NextResponse } from "next/server";
import { hasRedpandaConfig } from "@/lib/redpanda";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    environment: "development",
    redpandaConfigured: hasRedpandaConfig(),
    demo: process.env.DEMO_MODE === "true" || !hasRedpandaConfig(),
  });
}
