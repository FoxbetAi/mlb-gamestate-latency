import { SOURCE_ORDER } from "./topics";
import type { GameState, PairComparison, SourceId, Transition, TransitionKind } from "./types";

export const MIN_SAMPLES = 5;
export const SIGN_CONSISTENCY = 0.7;
export const NOISE_FLOOR_MS = 12;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const stateContext = (state: GameState) => `${state.inning ?? "?"}:${state.half ?? "?"}`;

export function deriveTransitions(previous: GameState | undefined, next: GameState, source: SourceId, observedAt: number, sourceAt: number | null): Transition[] {
  if (!previous) return [];

  const transitions: Array<{ kind: TransitionKind; signature: string; label: string }> = [];
  const inningChanged = next.inning !== null && next.half !== null && (next.inning !== previous.inning || next.half !== previous.half);
  if (inningChanged) {
    transitions.push({
      kind: "inning",
      signature: `inning:${next.inning}:${next.half}`,
      label: `${next.half === "top" ? "Top" : "Bottom"} ${next.inning}`,
    });
  }

  const scoreChanged = next.awayScore !== null && next.homeScore !== null && (next.awayScore !== previous.awayScore || next.homeScore !== previous.homeScore);
  if (scoreChanged) {
    transitions.push({
      kind: "score",
      signature: `score:${next.awayScore}:${next.homeScore}`,
      label: `Score ${next.awayScore}–${next.homeScore}`,
    });
  }

  if (next.outs !== null && next.outs !== previous.outs) {
    transitions.push({
      kind: "outs",
      signature: `outs:${stateContext(next)}:${next.outs}`,
      label: `${next.outs} out${next.outs === 1 ? "" : "s"}`,
    });
  }

  const countChanged = next.balls !== null && next.strikes !== null && (next.balls !== previous.balls || next.strikes !== previous.strikes);
  if (countChanged) {
    transitions.push({
      kind: "count",
      signature: `count:${stateContext(next)}:${next.balls}:${next.strikes}:${next.outs ?? "?"}`,
      label: `Count ${next.balls}–${next.strikes}`,
    });
  }

  return transitions.map((transition) => ({
    ...transition,
    id: `${transition.signature}:${source}:${observedAt}`,
    source,
    observedAt,
    sourceAt,
  }));
}

export function comparePairs(transitions: Transition[]): PairComparison[] {
  const bySignature = new Map<string, Map<SourceId, Transition>>();
  for (const transition of transitions) {
    const sources = bySignature.get(transition.signature) ?? new Map<SourceId, Transition>();
    const prior = sources.get(transition.source);
    if (!prior || transition.observedAt < prior.observedAt) sources.set(transition.source, transition);
    bySignature.set(transition.signature, sources);
  }

  const comparisons: PairComparison[] = [];
  for (let i = 0; i < SOURCE_ORDER.length; i += 1) {
    for (let j = i + 1; j < SOURCE_ORDER.length; j += 1) {
      const a = SOURCE_ORDER[i];
      const b = SOURCE_ORDER[j];
      const differences: number[] = [];
      for (const sources of bySignature.values()) {
        const aTransition = sources.get(a);
        const bTransition = sources.get(b);
        if (aTransition && bTransition) differences.push(aTransition.observedAt - bTransition.observedAt);
      }

      const aEarlier = differences.filter((value) => value < -NOISE_FLOOR_MS).length;
      const bEarlier = differences.filter((value) => value > NOISE_FLOOR_MS).length;
      const ties = differences.length - aEarlier - bEarlier;
      const signed = aEarlier + bEarlier;
      const direction = signed ? Math.max(aEarlier, bEarlier) / signed : 0;
      const middle = differences.length ? median(differences) : null;
      let verdict: PairComparison["verdict"] = "insufficient";
      let faster: SourceId | null = null;

      if (differences.length >= MIN_SAMPLES && middle !== null) {
        if (Math.abs(middle) <= NOISE_FLOOR_MS) verdict = "tie";
        else if (direction < SIGN_CONSISTENCY) verdict = "ambiguous";
        else {
          verdict = "faster";
          faster = middle < 0 ? a : b;
        }
      }

      comparisons.push({
        a,
        b,
        samples: differences.length,
        aEarlier,
        bEarlier,
        ties,
        medianMs: middle,
        consistency: differences.length ? direction : null,
        verdict,
        faster,
      });
    }
  }
  return comparisons;
}

export function sourceMedianBehind(transitions: Transition[], source: SourceId): number | null {
  const bySignature = new Map<string, Transition[]>();
  for (const transition of transitions) {
    const group = bySignature.get(transition.signature) ?? [];
    group.push(transition);
    bySignature.set(transition.signature, group);
  }

  const delays: number[] = [];
  for (const group of bySignature.values()) {
    const own = group.find((transition) => transition.source === source);
    if (!own || new Set(group.map((transition) => transition.source)).size < 2) continue;
    delays.push(own.observedAt - Math.min(...group.map((transition) => transition.observedAt)));
  }
  return delays.length ? median(delays) : null;
}
