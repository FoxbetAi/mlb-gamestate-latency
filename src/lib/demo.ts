import { TOPICS } from "./topics";
import type { Game, GameState, Observation } from "./types";

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

const offsets = [42, 110, 18, 280, 75, 155, 95];

export function demoObservations(step: number, baseline: number): Observation[] {
  const state = STATES[step % STATES.length];
  return TOPICS.map((topic, index) => ({
    id: `demo:${step}:${topic.id}`,
    source: topic.id,
    topic: topic.topic,
    observedAt: baseline + offsets[index] + ((step * 17 + index * 11) % 21),
    sourceAt: baseline - 25,
    recordKey: DEMO_GAME.gamePk,
    sourceIdentity: `${topic.id}-demo`,
    frameType: step === 0 ? "snapshot" : "update",
    state,
  }));
}
