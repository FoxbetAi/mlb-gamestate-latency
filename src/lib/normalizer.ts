import { applyPatch } from "fast-json-patch";
import { TOPIC_BY_NAME } from "./topics";
import type { Game, GameState, Observation } from "./types";

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
    const baseball = read(decoded, "baseball");
    const inning = at(baseball, "inning");
    const inPlay = at(baseball, "in_play") ?? at(baseball, "inPlay");
    if (!isRecord(baseball)) return null;
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
  const explicit = aliases[topic];
  if (explicit) {
    const identity = jsonText(decoded);
    return key === explicit || identity.includes(explicit);
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
  const sourceIdentity = asString(read(decoded, ...identityKeys)) || key;
  const frameType = asString(read(decoded, "frame_type", "frameType", "source", "book"));

  return {
    id: `${topic}:${key}:${observedAt}`,
    source: definition.id,
    topic,
    observedAt,
    sourceAt,
    recordKey: key,
    sourceIdentity,
    frameType,
    state,
  };
}
