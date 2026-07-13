import { describe, expect, it } from "vitest";
import { normalizeObservation, type FoldState } from "./normalizer";

const foldState = (): FoldState => ({ espnDocuments: new Map() });

describe("normalizeObservation", () => {
  it("uses the authoritative StatsAPI linescore instead of older nested innings", () => {
    const observation = normalizeObservation("statsapi.game.events.v1", "824251", {
      t_ns: 1_700_000_000_000_000_000,
      game_pk: "824251",
      data_json: {
        oldPlay: { inning: 1 },
        gameData: { status: { detailedState: "In Progress" } },
        liveData: { linescore: { currentInning: 5, inningState: "Bottom", balls: 2, strikes: 1, outs: 1, teams: { away: { runs: 1 }, home: { runs: 2 } } } },
      },
    }, 2_000, foldState());
    expect(observation?.state).toMatchObject({ inning: 5, half: "bottom", balls: 2, strikes: 1, outs: 1, awayScore: 1, homeScore: 2, live: true });
  });

  it("reads OpticOdds from data.score.in_play and score.scores", () => {
    const observation = normalizeObservation("opticodds.game.events.v1", "FX1", {
      fixture_id: "FX1",
      data_json: { data: { status: "live", score: { in_play: { period: "3", clock: "Top", balls: 1, strikes: 2, outs: 1 }, scores: { away: { total: 2 }, home: { total: 4 } } } } },
    }, 2_000, foldState());
    expect(observation?.state).toMatchObject({ inning: 3, half: "top", balls: 1, strikes: 2, outs: 1, awayScore: 2, homeScore: 4, live: true });
  });

  it("parses sportsbook ordinal innings and suppresses the three-out sentinel", () => {
    const observation = normalizeObservation("scrape.game.events.v1", "draftkings", {
      period: "7th",
      at_bat: "away",
      away_score: 3,
      home_score: 2,
      live: true,
      count: { balls: -1, strikes: -1, outs: 3 },
    }, 2_000, foldState());
    expect(observation?.state).toMatchObject({ inning: 7, half: null, balls: null, strikes: null, outs: null, awayScore: 3, homeScore: 2 });
  });
});
