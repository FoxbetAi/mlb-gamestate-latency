import { SOURCES, TOPICS } from "./topics";
import type { Game, GameState, Observation, SourceId } from "./types";

export const DEMO_GAME: Game = {
  gamePk: "demo-cubs",
  gameDate: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  awayName: "Chicago Cubs",
  awayAbbr: "CHC",
  homeName: "Milwaukee Brewers",
  homeAbbr: "MIL",
  venue: "American Family Field",
  status: "Warmup",
};

const STATES: GameState[] = [
  { inning: 1, half: "top", balls: 0, strikes: 0, outs: 0, awayScore: 0, homeScore: 0, live: true },
  { inning: 1, half: "top", balls: 1, strikes: 0, outs: 0, awayScore: 0, homeScore: 0, live: true },
  { inning: 1, half: "top", balls: 1, strikes: 1, outs: 0, awayScore: 0, homeScore: 0, live: true },
  { inning: 1, half: "top", balls: 1, strikes: 2, outs: 1, awayScore: 0, homeScore: 0, live: true },
  { inning: 1, half: "top", balls: 0, strikes: 0, outs: 2, awayScore: 0, homeScore: 0, live: true },
  { inning: 1, half: "bottom", balls: 0, strikes: 0, outs: 0, awayScore: 1, homeScore: 0, live: true },
];

const offsets = [42, 110, 18, 280, 75, 155, 95, 130];

// A source's demo records need a topic to sit on: its dedicated topic, or the
// shared comparison lane for feeds that ride it.
const topicForSource = (source: SourceId) =>
  TOPICS.find((topic) => topic.source === source)?.topic ?? "market.game.test.events.v1";

export function demoObservations(step: number, baseline: number): Observation[] {
  const state = STATES[step % STATES.length];
  return SOURCES.map((feed, index) => ({
    id: `demo:${step}:${feed.id}`,
    source: feed.id,
    topic: topicForSource(feed.id),
    observedAt: baseline + offsets[index % offsets.length] + ((step * 17 + index * 11) % 21),
    sourceAt: baseline - 25,
    recordKey: DEMO_GAME.gamePk,
    sourceIdentity: `${feed.id}-demo`,
    frameType: step === 0 ? "snapshot" : "update",
    state,
  }));
}
