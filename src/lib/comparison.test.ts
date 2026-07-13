import { describe, expect, it } from "vitest";
import { comparePairs, deriveTransitions, MIN_SAMPLES } from "./comparison";
import type { GameState, SourceId, Transition } from "./types";

const state = (overrides: Partial<GameState> = {}): GameState => ({
  inning: 1,
  half: "top",
  balls: 0,
  strikes: 0,
  outs: 0,
  awayScore: 0,
  homeScore: 0,
  live: true,
  ...overrides,
});

const transition = (signature: string, source: SourceId, observedAt: number): Transition => ({
  id: `${signature}:${source}`,
  signature,
  kind: "count",
  label: signature,
  source,
  observedAt,
  sourceAt: null,
});

describe("deriveTransitions", () => {
  it("uses the first observation only as a baseline", () => {
    expect(deriveTransitions(undefined, state(), "statsapi", 100, null)).toEqual([]);
  });

  it("emits aligned signatures for count, out, score, and inning changes", () => {
    const next = state({ inning: 2, half: "bottom", balls: 1, strikes: 1, outs: 1, awayScore: 1 });
    const result = deriveTransitions(state(), next, "statsapi", 200, null);
    expect(result.map((item) => item.kind)).toEqual(["inning", "score", "outs", "count"]);
    expect(result[0].signature).toBe("inning:2:bottom");
  });
});

describe("comparePairs", () => {
  it("does not declare a winner below the minimum sample count", () => {
    const rows = Array.from({ length: MIN_SAMPLES - 1 }, (_, index) => [
      transition(`count:1:top:${index}`, "statsapi", 1_000 + index * 100),
      transition(`count:1:top:${index}`, "espn", 1_050 + index * 100),
    ]).flat();
    const pair = comparePairs(rows).find((item) => item.a === "statsapi" && item.b === "espn");
    expect(pair?.verdict).toBe("insufficient");
  });

  it("declares a consistent signed winner", () => {
    const rows = Array.from({ length: MIN_SAMPLES }, (_, index) => [
      transition(`count:1:top:${index}`, "statsapi", 1_000 + index * 100),
      transition(`count:1:top:${index}`, "espn", 1_080 + index * 100),
    ]).flat();
    const pair = comparePairs(rows).find((item) => item.a === "statsapi" && item.b === "espn");
    expect(pair?.verdict).toBe("faster");
    expect(pair?.faster).toBe("statsapi");
    expect(pair?.medianMs).toBe(-80);
  });

  it("reports ambiguity when direction is inconsistent", () => {
    const deltas = [-80, -75, -70, 90, 95];
    const rows = deltas.flatMap((delta, index) => [
      transition(`count:1:top:${index}`, "statsapi", 1_000 + index * 200),
      transition(`count:1:top:${index}`, "espn", 1_000 + index * 200 - delta),
    ]);
    const pair = comparePairs(rows).find((item) => item.a === "statsapi" && item.b === "espn");
    expect(pair?.verdict).toBe("ambiguous");
  });
});
