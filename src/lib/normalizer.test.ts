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

  // Payload transcribed from a live dev record on market.game.test.events.v1
  // (offset 11306, key srlmt|nba_sl_260714_sac_bkn) decoded field-by-field
  // against sharpapi_game_events.proto. Enums shown as their numeric tags —
  // how the Confluent Schema Registry protobuf decoder returns them.
  const srBasketballFrame = {
    t_ns: 1_784_070_993_237_000_000,
    home_score: 73,
    away_score: 41,
    source: 2, // UPDATE
    source_t_ns: 1_784_070_993_200_000_000,
    f_event_id: "nba_sl_260714_sac_bkn",
    sport_kind: 3, // SPORT_BASKETBALL
    league_code: 3, // LEAGUE_NBA_SL
    halt_signal: 1, // LIVE
    f_home_team_id: "nba_sl_bkn",
    f_away_team_id: "nba_sl_sac",
    basketball: { period: 3 /* Q3 */, clock_seconds_remaining: 293 },
  };

  it("decodes an SR basketball GamestateEvent from the shared lane, keyed by the srlmt| prefix", () => {
    const observation = normalizeObservation(
      "market.game.test.events.v1",
      "srlmt|nba_sl_260714_sac_bkn",
      srBasketballFrame,
      2_000,
      foldState(),
    );
    // Provenance and identity come from the key prefix, not the topic.
    expect(observation?.source).toBe("srlmt");
    expect(observation?.recordKey).toBe("nba_sl_260714_sac_bkn");
    expect(observation?.sourceIdentity).toBe("nba_sl_260714_sac_bkn");
    // Real basketball decode — not the heuristic fallback (which would guess null period/clock).
    expect(observation?.state).toMatchObject({
      inning: null,
      half: null,
      awayScore: 41,
      homeScore: 73,
      live: true,
      period: "Q3",
      clockSeconds: 293,
    });
    expect(observation?.sourceAt).toBeGreaterThan(0);
  });

  it("maps a halted basketball frame to live=false and decodes the enum-name (fallback) period form", () => {
    const observation = normalizeObservation(
      "market.game.test.events.v1",
      "srlmt|nba_sl_260714_mem_gsw",
      { ...srBasketballFrame, halt_signal: "HALTED_NOT_LIVE", basketball: { period: "HALFTIME", clock_seconds_remaining: 0 } },
      2_000,
      foldState(),
    );
    expect(observation?.source).toBe("srlmt");
    expect(observation?.state).toMatchObject({ live: false, period: "HALFTIME", clockSeconds: 0 });
  });
});
