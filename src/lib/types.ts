export type SourceId =
  | "opticodds"
  | "statsapi"
  | "draftkings"
  | "polymarket"
  | "espn"
  | "scrape"
  | "market";

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
