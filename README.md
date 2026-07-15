# Cubs Feed Race

A Vercel-hosted, read-only observer for comparing the arrival time of equivalent MLB gamestate transitions across the development Redpanda cluster.

## Streams

The app subscribes from the latest offset to every currently MLB-capable gamestate topic:

- `opticodds.game.events.v1`
- `statsapi.game.events.v1`
- `draftkings.game.events.v1`
- `polymarket.gamestate.events.v1`
- `espn.game.events.v1`
- `scrape.game.events.v1`
- `market.game.events.v1`
- `market.game.test.events.v1`

`kalshi.game.events.v1` is intentionally excluded: its checked-in contract is NBA Summer League basketball only.

## What “latency” means

The app compares when the Vercel observer receives equivalent transitions: inning/half, score, outs, and count. It does not rank feeds by their own wall clocks because those clocks may have different synchronization and semantics.

Pairwise results use signed differences. A winner requires:

- at least 5 shared transitions;
- median magnitude greater than the 12 ms observer noise floor; and
- the same direction in at least 70% of non-tied observations.

Anything weaker is labeled `tie`, `ambiguous`, or `insufficient`.

## Local setup

```sh
cp .env.example .env.local
npm install
npm run dev
```

Without credentials, the app automatically runs in deterministic demo mode. Open [http://localhost:3000](http://localhost:3000).

The development serverless cluster uses Redpanda Cloud OIDC. Configure `REDPANDA_CLOUD_CLIENT_ID` and `REDPANDA_CLOUD_CLIENT_SECRET`; the server exchanges them for short-lived bearer tokens for both Kafka and Schema Registry. Static SASL/basic credentials remain supported as a fallback because topic values use Schema Registry-framed Protobuf.

For sources whose native event identifier cannot be inferred from Cubs/opponent names, set explicit aliases:

```json
{
  "777001": {
    "espn.game.events.v1": "401881840",
    "opticodds.game.events.v1": "fixture-id"
  }
}
```

Put that JSON on one line in `GAME_SOURCE_IDS`.

## Vercel deployment

1. Create a Vercel project from this repo.
2. Enable Vercel Deployment Protection (or put the project behind equivalent organization authentication) before adding dev-cluster credentials. The UI exposes internal feed telemetry and must not be a public deployment.
3. Add the variables from `.env.example` to the Vercel project. Do not prefix credentials with `NEXT_PUBLIC_`.
4. Confirm Vercel egress can reach both the Redpanda Kafka API and Schema Registry.
5. The `/api/stream` function runs in 300-second segments, the Vercel Hobby maximum. EventSource reconnects automatically between segments.

The browser reconnects the SSE stream automatically. Comparison history lives in the browser for the duration of the page session, while every new server stream uses a unique, read-only Kafka consumer group and starts at the latest offsets.

## Checks

```sh
npm test
npm run lint
npm run build
```
