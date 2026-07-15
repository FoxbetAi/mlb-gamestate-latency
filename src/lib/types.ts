export type SourceId =
  | "opticodds"
  | "statsapi"
  | "draftkings"
  | "polymarket"
  | "espn"
  | "scrape"
  | "market"
  // A feed carried on the shared market.game.test.events.v1 comparison lane,
  // identified per-record by a "srlmt|" key prefix the upstream producer stamps
  // (universal-mapping SourceSrlmt) — the token is a load-bearing wire contract.
  // The lane is a transport, not dedicated to this feed (see topics.ts).
  | "srlmt";

export type Game = {
  gamePk: string;
  gameDate: string;
  awayName: string;
  awayAbbr: string;
  homeName: string;
  homeAbbr: string;
  venue: string;
  status: string;
};

export type GameState = {
  inning: number | null;
  half: "top" | "bottom" | null;
  balls: number | null;
  strikes: number | null;
  outs: number | null;
  awayScore: number | null;
  homeScore: number | null;
  live: boolean | null;
  // Basketball projections. Optional and absent on baseball states; baseball has
  // no period label / game clock and these stay undefined there.
  period?: string | null; // typed period label, e.g. "Q3", "HALFTIME", "END_Q2"
  clockSeconds?: number | null; // seconds remaining in the current period
};

export type Observation = {
  id: string;
  source: SourceId;
  topic: string;
  observedAt: number;
  sourceAt: number | null;
  recordKey: string;
  sourceIdentity: string;
  frameType: string;
  state: GameState;
};

export type TransitionKind = "inning" | "score" | "outs" | "count";

export type Transition = {
  id: string;
  signature: string;
  kind: TransitionKind;
  label: string;
  source: SourceId;
  observedAt: number;
  sourceAt: number | null;
};

export type PairVerdict = "faster" | "tie" | "ambiguous" | "insufficient";

export type PairComparison = {
  a: SourceId;
  b: SourceId;
  samples: number;
  aEarlier: number;
  bEarlier: number;
  ties: number;
  medianMs: number | null;
  consistency: number | null;
  verdict: PairVerdict;
  faster: SourceId | null;
};

export type StreamMessage =
  | { type: "ready"; at: number; topics: string[]; demo: boolean }
  | { type: "observation"; observation: Observation }
  | { type: "warning"; message: string; topic?: string }
  | { type: "heartbeat"; at: number };
