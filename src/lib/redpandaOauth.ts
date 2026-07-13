const TOKEN_URL = "https://auth.prd.cloud.redpanda.com/oauth/token";
const TOKEN_AUDIENCE = "cloudv2-production.redpanda.cloud";

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
};

let cached: { value: string; expiresAt: number } | null = null;

export function hasCloudOidcConfig() {
  return Boolean(process.env.REDPANDA_CLOUD_CLIENT_ID?.trim() && process.env.REDPANDA_CLOUD_CLIENT_SECRET?.trim());
}

export async function getRedpandaCloudToken() {
  if (cached && cached.expiresAt - Date.now() > 60_000) return cached.value;

  const clientId = process.env.REDPANDA_CLOUD_CLIENT_ID?.trim();
  const clientSecret = process.env.REDPANDA_CLOUD_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("Redpanda Cloud client credentials are required");

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    audience: TOKEN_AUDIENCE,
  });
  const response = await fetch(process.env.REDPANDA_OAUTH_TOKEN_URL?.trim() || TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Redpanda OAuth token request failed (${response.status})`);
  const payload = await response.json() as TokenResponse;
  if (!payload.access_token) throw new Error("Redpanda OAuth response did not include an access token");

  cached = {
    value: payload.access_token,
    expiresAt: Date.now() + Math.max(120, payload.expires_in ?? 3_600) * 1_000,
  };
  return cached.value;
}
