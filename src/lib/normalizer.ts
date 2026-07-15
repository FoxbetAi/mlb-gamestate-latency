import { applyPatch } from "fast-json-patch";
import { SOURCE_ORDER, TOPIC_BY_NAME } from "./topics";
import type { Game, GameState, Observation, SourceId } from "./types";

// market.game.test.events.v1 is a shared multi-producer comparison lane keyed
// "<source_id>|<f_event_id>" (upstream: libs/topics/topics.go, universal-mapping
// produce.go). One-topic-one-source does NOT survive it — GamestateEvent has no
// provenance field, so the key prefix is the only provenance.
const SHARED_LANE_TOPIC = "market.game.test.events.v1";

const KNOWN_SOURCES = new Set<string>(SOURCE_ORDER);

// Split "<source_id>|<f_event_id>" on the first "|". Records without a "|" keep
// the whole key as identity and carry no source token.
const splitSharedLaneKey = (key: string): { sourceToken: string; fEventId: string } => {
  const index = key.indexOf("|");
  if (index < 0) return { sourceToken: "", fEventId: key };
  return { sourceToken: key.slice(0, index), fEventId: key.slice(index + 1) };
};

const resolveSource = (token: string): SourceId | null => (KNOWN_SOURCES.has(token) ? (token as SourceId) : null);

type UnknownRecord = Record<string, unknown>;

const EMPTY_STATE: GameState = { inning: null, half: null, balls: null, strikes: null, outs: null, awayScore: null, homeScore: null, live: null };

const isRecord = (value: unknown): value is UnknownRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const read = (record: UnknownRecord, ...keys: string[]) => keys.map((key) => record[key]).find((value) => value !== undefined);
const asString = (value: unknown) => value === null || value === undefined ? "" : String(value);
const jsonText = (value: unknown) => {
  try {
    return JSON.stringify(value, (_key, child) => typeof child === "bigint" ? child.toString() : child);
  } catch {
    return "";
  }
};
const asNumber = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const inningNumber = (value: unknown): number | null => {
  const direct = asNumber(value);
  if (direct !== null) return direct;
  const match = asString(value).match(/\d+/);
  return match ? Number(match[0]) : null;
};
const at = (value: unknown, ...keys: string[]): unknown => {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
};

const recursiveFind = (value: unknown, names: string[], depth = 0): unknown => {
  if (depth > 7 || !value) return undefined;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = recursiveFind(child, names, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const name of names) if (value[name] !== undefined) return value[name];
  for (const child of Object.values(value)) {
    const found = recursiveFind(child, names, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
};

const dataPayload = (value: UnknownRecord) => read(value, "data_json", "dataJson") ?? value;

const parseBody = (value: UnknownRecord) => {
  const body = read(value, "body");
  if (!body) return dataPayload(value);
  try {
    if (typeof body === "string") return JSON.parse(body);
    if (body instanceof Uint8Array || Buffer.isBuffer(body)) return JSON.parse(Buffer.from(body).toString("utf8"));
    if (isRecord(body) && Array.isArray(body.data)) return JSON.parse(Buffer.from(body.data as number[]).toString("utf8"));
  } catch {
    return dataPayload(value);
  }
  return dataPayload(value);
};

const normalizeHalf = (value: unknown): GameState["half"] => {
  if (value === 1 || value === "TOP") return "top";
  if (value === 2 || value === "BOTTOM") return "bottom";
  const text = asString(value).toLowerCase();
  if (text.includes("top") || text === "away" || text.includes("upper")) return "top";
  if (text.includes("bot") || text === "home" || text.includes("lower")) return "bottom";
  return null;
};

const normalizeBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  const text = asString(value).toLowerCase();
  if (["live", "in progress", "inprogress", "in_progress", "true", "1"].includes(text)) return true;
  if (["final", "completed", "false", "0", "scheduled", "unplayed"].includes(text)) return false;
  return null;
};

const findTeamScore = (payload: unknown, side: "home" | "away") => {
  const direct = recursiveFind(payload, [`${side}_score`, `${side}Score`]);
  if (direct !== undefined) return asNumber(direct);
  const teams = recursiveFind(payload, ["teams"]);
  if (isRecord(teams) && isRecord(teams[side])) return asNumber(read(teams[side] as UnknownRecord, "runs", "score", "points"));
  return null;
};

// BasketballGamestate.Period enum (sharpapi_game_events.proto). The Confluent
// Schema Registry decoder emits protobuf enums as their numeric tag; the
// well-known-type fallback path emits the enum name string. Handle both.
const BASKETBALL_PERIODS: Record<number, string> = {
  1: "Q1", 2: "Q2", 3: "Q3", 4: "Q4",
  5: "END_Q1", 6: "END_Q2", 7: "END_Q3", 8: "END_Q4",
  9: "HALFTIME", 10: "OVERTIME", 11: "END_OVERTIME", 12: "FINAL",
};

const basketballPeriodLabel = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") return BASKETBALL_PERIODS[value] ?? null;
  const text = asString(value);
  return text === "" || text === "PERIOD_UNSPECIFIED" ? null : text;
};

// HaltSignal.LIVE (enum tag 1) — the only value that means in-play. Decoded as
// numeric 1 (schema-registry path) or "LIVE" (well-known-type path); anything
// else is halted.
const haltIsLive = (value: unknown): boolean | null => {
  if (value === undefined || value === null) return null;
  const text = asString(value).toUpperCase();
  return text === "LIVE" || text === "1";
};

// A canonical sharpv1.GamestateEvent carries exactly one sport oneof. These two
// decoders read whichever is present; both the market.game.events.v1 topic and
// the shared comparison lane reuse them.
const baseballState = (decoded: UnknownRecord): GameState | null => {
  const baseball = read(decoded, "baseball");
  if (!isRecord(baseball)) return null;
  const inning = at(baseball, "inning");
  const inPlay = at(baseball, "in_play") ?? at(baseball, "inPlay");
  return {
    inning: inningNumber(at(inning, "number")),
    half: normalizeHalf(at(inning, "half")),
    balls: asNumber(at(inPlay, "balls")),
    strikes: asNumber(at(inPlay, "strikes")),
    outs: asNumber(at(inPlay, "outs")),
    awayScore: asNumber(read(decoded, "away_score", "awayScore")),
    homeScore: asNumber(read(decoded, "home_score", "homeScore")),
    live: normalizeBoolean(read(decoded, "halt_signal", "haltSignal")),
  };
};

const basketballState = (decoded: UnknownRecord): GameState | null => {
  const basketball = read(decoded, "basketball");
  if (!isRecord(basketball)) return null;
  return {
    inning: null, // basketball has no innings; period/clock carry the phase
    half: null,
    balls: null,
    strikes: null,
    outs: null,
    awayScore: asNumber(read(decoded, "away_score", "awayScore")),
    homeScore: asNumber(read(decoded, "home_score", "homeScore")),
    live: haltIsLive(read(decoded, "halt_signal", "haltSignal")),
    period: basketballPeriodLabel(read(basketball, "period")),
    clockSeconds: asNumber(read(basketball, "clock_seconds_remaining", "clockSecondsRemaining")),
  };
};

const exactState = (topic: string, decoded: UnknownRecord, payload: unknown): GameState | null => {
  if (topic === "statsapi.game.events.v1") {
    const linescore = at(payload, "liveData", "linescore");
    if (!isRecord(linescore)) return null;
    return {
      inning: inningNumber(read(linescore, "currentInning")),
      half: normalizeHalf(read(linescore, "inningState")),
      balls: asNumber(read(linescore, "balls")),
      strikes: asNumber(read(linescore, "strikes")),
      outs: asNumber(read(linescore, "outs")),
      awayScore: asNumber(at(linescore, "teams", "away", "runs")),
      homeScore: asNumber(at(linescore, "teams", "home", "runs")),
      live: normalizeBoolean(at(payload, "gameData", "status", "detailedState")),
    };
  }

  if (topic === "opticodds.game.events.v1") {
    const result = isRecord(at(payload, "data")) ? at(payload, "data") : payload;
    const inPlay = at(result, "score", "in_play");
    const scores = at(result, "score", "scores");
    if (!isRecord(inPlay) && !isRecord(scores)) return null;
    const rawOuts = asNumber(at(inPlay, "outs"));
    return {
      inning: inningNumber(at(inPlay, "period")),
      half: normalizeHalf(at(inPlay, "clock")),
      balls: asNumber(at(inPlay, "balls")),
      strikes: asNumber(at(inPlay, "strikes")),
      outs: rawOuts !== null && rawOuts < 3 ? rawOuts : null,
      awayScore: asNumber(at(scores, "away", "total")),
      homeScore: asNumber(at(scores, "home", "total")),
      live: normalizeBoolean(read(result as UnknownRecord, "is_live", "status")),
    };
  }

  if (topic === "scrape.game.events.v1") {
    const count = read(decoded, "count");
    const rawOuts = asNumber(at(count, "outs"));
    const rawBalls = asNumber(at(count, "balls"));
    const rawStrikes = asNumber(at(count, "strikes"));
    return {
      inning: inningNumber(read(decoded, "period")),
      half: rawOuts !== null && rawOuts >= 3 ? null : normalizeHalf(read(decoded, "at_bat", "atBat")),
      balls: rawBalls !== null && rawBalls >= 0 ? rawBalls : null,
      strikes: rawStrikes !== null && rawStrikes >= 0 ? rawStrikes : null,
      outs: rawOuts !== null && rawOuts < 3 ? rawOuts : null,
      awayScore: asNumber(read(decoded, "away_score", "awayScore")),
      homeScore: asNumber(read(decoded, "home_score", "homeScore")),
      live: normalizeBoolean(read(decoded, "live")),
    };
  }

  if (topic === "market.game.events.v1") {
    return baseballState(decoded);
  }

  if (topic === SHARED_LANE_TOPIC) {
    // Same sharpv1.GamestateEvent message as market.game.events.v1, but this is a
    // shared lane multiplexing several feeds and both sports — decode whichever
    // sport oneof the record carries (basketball `= 40` or baseball `= 30`).
    // Neither present → null, which falls through to the heuristic below.
    return basketballState(decoded) ?? baseballState(decoded);
  }
  return null;
};

export type FoldState = { espnDocuments: Map<string, unknown> };

const foldEspn = (value: UnknownRecord, foldState: FoldState) => {
  const eventId = asString(read(value, "espn_event_id", "espnEventId"));
  const frameType = asString(read(value, "frame_type", "frameType"));
  const data = dataPayload(value);
  if (frameType === "checkpoint") {
    foldState.espnDocuments.set(eventId, data);
    return data;
  }
  if (frameType === "patch" && Array.isArray(data)) {
    const previous = foldState.espnDocuments.get(eventId);
    if (!previous) return data;
    try {
      const next = applyPatch(structuredClone(previous), data as never[], false, false).newDocument;
      foldState.espnDocuments.set(eventId, next);
      return next;
    } catch {
      return previous;
    }
  }
  return data;
};

export function gameMatches(topic: string, key: string, decoded: UnknownRecord, game: Game, aliases: Record<string, string>): boolean {
  if (topic === "statsapi.game.events.v1") return key === game.gamePk || asString(read(decoded, "game_pk", "gamePk")) === game.gamePk;
  // Shared lane: identity is the f_event_id after the "<source>|" prefix, not
  // the raw Kafka key.
  const matchKey = topic === SHARED_LANE_TOPIC ? splitSharedLaneKey(key).fEventId : key;
  const explicit = aliases[topic];
  if (explicit) {
    const identity = jsonText(decoded);
    return matchKey === explicit || identity.includes(explicit);
  }
  const haystack = jsonText(decoded).toLowerCase();
  const cubsTokens = ["chicago cubs", "cubs", "chc"];
  const opponentTokens = [game.homeName, game.awayName, game.homeAbbr, game.awayAbbr]
    .filter((name) => !name.toLowerCase().includes("cubs") && name.toLowerCase() !== "chc")
    .map((name) => name.toLowerCase());
  return cubsTokens.some((token) => haystack.includes(token)) && (opponentTokens.length === 0 || opponentTokens.some((token) => haystack.includes(token)));
}

export function normalizeObservation(topic: string, key: string, decoded: unknown, observedAt: number, foldState: FoldState): Observation | null {
  if (!isRecord(decoded)) return null;
  const definition = TOPIC_BY_NAME.get(topic);
  if (!definition) return null;
  const payload = topic === "espn.game.events.v1" ? foldEspn(decoded, foldState) : parseBody(decoded);
  const count = recursiveFind(payload, ["count"]);
  const countRecord = isRecord(count) ? count : undefined;
  const state: GameState = exactState(topic, decoded, payload) ?? {
    ...EMPTY_STATE,
    inning: inningNumber(recursiveFind(payload, ["currentInning", "current_inning", "inning", "period"])),
    half: normalizeHalf(recursiveFind(payload, ["inningHalf", "inning_half", "half", "at_bat", "atBat"])),
    balls: asNumber(countRecord ? read(countRecord, "balls") : recursiveFind(payload, ["balls"])),
    strikes: asNumber(countRecord ? read(countRecord, "strikes") : recursiveFind(payload, ["strikes"])),
    outs: asNumber(countRecord ? read(countRecord, "outs") : recursiveFind(payload, ["outs"])),
    awayScore: findTeamScore(payload, "away") ?? asNumber(read(decoded, "away_score", "awayScore")),
    homeScore: findTeamScore(payload, "home") ?? asNumber(read(decoded, "home_score", "homeScore")),
    live: normalizeBoolean(recursiveFind(payload, ["live", "isLive", "is_live", "status", "gameStatus"])),
  };

  const rawTNs = asNumber(read(decoded, "t_ns", "tNs"));
  const sourceTNs = asNumber(read(decoded, "source_t_ns", "sourceTNs"));
  const sourceAt = sourceTNs && sourceTNs > 0 ? sourceTNs / 1e6 : rawTNs && rawTNs > 0 ? rawTNs / 1e6 : null;
  const identityKeys = ["game_pk", "gamePk", "fixture_id", "fixtureId", "sr_match_id", "srMatchId", "game_id", "gameId", "espn_event_id", "espnEventId", "source_event_id", "sourceEventId", "event_id", "eventId"];
  const frameType = asString(read(decoded, "frame_type", "frameType", "source", "book"));

  // Shared lane: provenance and record identity come from the "<source>|<f_event_id>"
  // key prefix, not the topic. A record whose prefix names no known source is
  // DROPPED rather than mislabeled. Dedicated topics use their 1:1 source.
  const shared = topic === SHARED_LANE_TOPIC ? splitSharedLaneKey(key) : null;
  const source = shared ? resolveSource(shared.sourceToken) : (definition.source ?? null);
  if (source === null) return null;
  const recordKey = shared ? shared.fEventId : key;
  const sourceIdentity = shared ? shared.fEventId : asString(read(decoded, ...identityKeys)) || key;

  return {
    id: `${topic}:${key}:${observedAt}`,
    source,
    topic,
    observedAt,
    sourceAt,
    recordKey,
    sourceIdentity,
    frameType,
    state,
  };
}
