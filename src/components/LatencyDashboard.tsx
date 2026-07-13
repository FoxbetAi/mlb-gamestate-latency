"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { comparePairs, deriveTransitions, MIN_SAMPLES, NOISE_FLOOR_MS, SIGN_CONSISTENCY, sourceMedianBehind } from "@/lib/comparison";
import { SOURCE_ORDER, TOPICS } from "@/lib/topics";
import type { Game, GameState, Observation, SourceId, StreamMessage, Transition } from "@/lib/types";

type Connection = "connecting" | "live" | "reconnecting" | "error";
type SourceRuntime = { lastSeen: number | null; observations: number; state?: GameState; identity?: string; frameType?: string };

const sourceName = (source: SourceId) => TOPICS.find((topic) => topic.id === source)?.shortLabel ?? source;
const formatMs = (value: number | null) => value === null ? "—" : value < 1 ? "<1 ms" : `${Math.round(value)} ms`;
const formatClock = (value: number) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(value);
const inningText = (state?: GameState) => state?.inning && state.half ? `${state.half === "top" ? "▲" : "▼"} ${state.inning}` : "Awaiting state";

const gameLabel = (game: Game) => {
  const date = new Date(game.gameDate);
  return `${game.awayAbbr} at ${game.homeAbbr} · ${new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date)}`;
};

function useGameStream(game: Game | null) {
  const [connection, setConnection] = useState<Connection>("connecting");
  const [demo, setDemo] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [sources, setSources] = useState<Record<SourceId, SourceRuntime>>(() => Object.fromEntries(SOURCE_ORDER.map((source) => [source, { lastSeen: null, observations: 0 }])) as Record<SourceId, SourceRuntime>);
  const previousRef = useRef(new Map<SourceId, GameState>());

  const reset = useCallback(() => {
    previousRef.current.clear();
    setConnection("connecting");
    setTransitions([]);
    setWarning(null);
    setSources(Object.fromEntries(SOURCE_ORDER.map((source) => [source, { lastSeen: null, observations: 0 }])) as Record<SourceId, SourceRuntime>);
  }, []);

  useEffect(() => {
    if (!game) return;
    const params = new URLSearchParams(Object.entries(game));
    const stream = new EventSource(`/api/stream?${params.toString()}`);

    stream.onmessage = (event) => {
      const message = JSON.parse(event.data) as StreamMessage;
      if (message.type === "ready") {
        setDemo(message.demo);
        setConnection("live");
        return;
      }
      if (message.type === "warning") {
        setWarning(message.topic ? `${sourceName(TOPICS.find((topic) => topic.topic === message.topic)?.id ?? "market")}: ${message.message}` : message.message);
        return;
      }
      if (message.type !== "observation") return;

      const observation: Observation = message.observation;
      const previous = previousRef.current.get(observation.source);
      const nextTransitions = deriveTransitions(previous, observation.state, observation.source, observation.observedAt, observation.sourceAt);
      previousRef.current.set(observation.source, observation.state);
      if (nextTransitions.length) setTransitions((current) => [...current, ...nextTransitions].slice(-2_000));
      setSources((current) => ({
        ...current,
        [observation.source]: {
          lastSeen: observation.observedAt,
          observations: current[observation.source].observations + 1,
          state: observation.state,
          identity: observation.sourceIdentity,
          frameType: observation.frameType,
        },
      }));
    };
    stream.onerror = () => {
      setConnection((current) => current === "live" ? "reconnecting" : "error");
    };
    stream.onopen = () => setConnection("connecting");

    return () => stream.close();
  }, [game]);

  return { connection, demo, warning, transitions, sources, reset };
}

export function LatencyDashboard() {
  const [games, setGames] = useState<Game[]>([]);
  const [gamePk, setGamePk] = useState("");
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [methodOpen, setMethodOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const game = games.find((candidate) => candidate.gamePk === gamePk) ?? null;
  const { connection, demo, warning, transitions, sources, reset } = useGameStream(game);

  useEffect(() => {
    void fetch("/api/games", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { games?: Game[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Could not load Cubs schedule");
        const nextGames = payload.games ?? [];
        setGames(nextGames);
        if (nextGames.length) {
          const live = nextGames.find((candidate) => /live|progress|warmup/i.test(candidate.status));
          const upcoming = nextGames.find((candidate) => new Date(candidate.gameDate).getTime() >= Date.now() - 4 * 60 * 60 * 1000);
          setGamePk((live ?? upcoming ?? nextGames[0]).gamePk);
        }
      })
      .catch((error: Error) => setScheduleError(error.message));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const selectGame = (nextGamePk: string) => {
    reset();
    setGamePk(nextGamePk);
  };

  const comparisons = useMemo(() => comparePairs(transitions), [transitions]);
  const meaningfulPairs = comparisons.filter((pair) => pair.samples > 0).sort((a, b) => b.samples - a.samples);
  const matchedSignatures = useMemo(() => {
    const groups = new Map<string, Set<SourceId>>();
    for (const transition of transitions) {
      const group = groups.get(transition.signature) ?? new Set<SourceId>();
      group.add(transition.source);
      groups.set(transition.signature, group);
    }
    return [...groups.values()].filter((group) => group.size > 1).length;
  }, [transitions]);
  const latestState = Object.values(sources).filter((source) => source.state).sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0))[0]?.state;
  const activeSources = Object.values(sources).filter((source) => source.lastSeen).length;

  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <span className="brandMark" aria-hidden="true">C</span>
          <div>
            <h1>Cubs Feed Race</h1>
            <p>MLB gamestate latency observer</p>
          </div>
        </div>
        <div className="statusCluster">
          <span className="envBadge">DEV</span>
          {demo && <span className="demoBadge">DEMO DATA</span>}
          <span className={`connection connection--${connection}`}><span aria-hidden="true" />{connection}</span>
        </div>
      </header>

      <section className="gameBar" aria-labelledby="game-heading">
        <div className="gameSelect">
          <label htmlFor="game" id="game-heading">Cubs game</label>
          <select id="game" value={gamePk} onChange={(event) => selectGame(event.target.value)} disabled={!games.length}>
            {!games.length && <option>Loading schedule…</option>}
            {games.map((candidate) => <option key={candidate.gamePk} value={candidate.gamePk}>{gameLabel(candidate)}</option>)}
          </select>
          {scheduleError && <p className="inlineError" role="alert">{scheduleError}</p>}
        </div>
        {game && (
          <div className="scoreline">
            <div><span>{game.awayAbbr}</span><strong>{latestState?.awayScore ?? "–"}</strong></div>
            <div className="gameState"><strong>{inningText(latestState)}</strong><span>{game.status} · {game.venue}</span></div>
            <div><strong>{latestState?.homeScore ?? "–"}</strong><span>{game.homeAbbr}</span></div>
          </div>
        )}
        <button type="button" className="resetButton" onClick={reset} disabled={!transitions.length}>Reset sample</button>
      </section>

      {(warning || demo) && (
        <aside className={warning ? "notice notice--warning" : "notice"} role={warning ? "alert" : "status"}>
          <span aria-hidden="true">{warning ? "!" : "i"}</span>
          <p>{warning ?? "Demo mode is generating deterministic feed arrivals. Add Redpanda and Schema Registry credentials to observe the live dev topics."}</p>
        </aside>
      )}

      <section className="summary" aria-label="Session summary">
        <div><span>Streams seen</span><strong>{activeSources}<small>/7</small></strong></div>
        <div><span>Matched transitions</span><strong>{matchedSignatures}</strong></div>
        <div><span>Pair verdicts ready</span><strong>{comparisons.filter((pair) => pair.verdict !== "insufficient").length}</strong></div>
        <div><span>Evidence window</span><strong>{transitions.length ? `${Math.max(1, Math.round((now - transitions[0].observedAt) / 60_000))}m` : "—"}</strong></div>
      </section>

      <section className="section" aria-labelledby="race-heading">
        <div className="sectionHeading">
          <div><h2 id="race-heading">Race board</h2><p>Median delay from the first stream to report the same transition.</p></div>
          <span className="liveReadout">{connection === "live" ? "Receiving live" : "Waiting for stream"}</span>
        </div>
        <div className="sourceTable" role="table" aria-label="Gamestate source latency">
          <div className="sourceHeader" role="row">
            <span role="columnheader">Feed</span><span role="columnheader">Current state</span><span role="columnheader">Frames</span><span role="columnheader">Median behind</span><span role="columnheader">Last seen</span>
          </div>
          {TOPICS.map((topic) => {
            const runtime = sources[topic.id];
            const delay = sourceMedianBehind(transitions, topic.id);
            const stale = runtime.lastSeen !== null && now - runtime.lastSeen > 20_000;
            return (
              <div className="sourceRow" role="row" key={topic.id}>
                <span className="sourceIdentity" role="cell"><i className={`sourceDot sourceDot--${topic.id}`} aria-hidden="true" /><span><strong>{topic.shortLabel}</strong><small>{topic.cadence}</small></span></span>
                <span role="cell" data-label="State"><strong>{inningText(runtime.state)}</strong><small>{runtime.state?.balls ?? "–"}–{runtime.state?.strikes ?? "–"}, {runtime.state?.outs ?? "–"} out</small></span>
                <span role="cell" data-label="Frames" className="numeric">{runtime.observations || "—"}</span>
                <span role="cell" data-label="Median behind" className={`numeric delay ${delay === 0 ? "delay--leader" : ""}`}>{formatMs(delay)}</span>
                <span role="cell" data-label="Last seen" className={stale ? "stale" : ""}>{runtime.lastSeen ? `${Math.max(0, Math.round((now - runtime.lastSeen) / 1000))}s ago` : "Not matched"}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="section" aria-labelledby="pairwise-heading">
        <div className="sectionHeading">
          <div><h2 id="pairwise-heading">Pairwise evidence</h2><p>Signed comparisons only. A lower median alone never declares a winner.</p></div>
          <button className="textButton" type="button" onClick={() => setMethodOpen((open) => !open)} aria-expanded={methodOpen}>How verdicts work</button>
        </div>
        {methodOpen && (
          <div className="methodPanel">
            <p>A verdict requires at least <strong>{MIN_SAMPLES} matched transitions</strong>, a median outside the <strong>±{NOISE_FLOOR_MS} ms noise floor</strong>, and the same direction in at least <strong>{Math.round(SIGN_CONSISTENCY * 100)}%</strong> of non-tied samples. Otherwise the result remains tied, ambiguous, or insufficient.</p>
          </div>
        )}
        {meaningfulPairs.length ? (
          <div className="pairTable" role="table" aria-label="Pairwise feed comparisons">
            <div className="pairHeader" role="row"><span>Feeds</span><span>Samples</span><span>Signed split</span><span>Median A − B</span><span>Verdict</span></div>
            {meaningfulPairs.map((pair) => (
              <div className="pairRow" role="row" key={`${pair.a}-${pair.b}`}>
                <span className="pairNames"><strong>{sourceName(pair.a)}</strong><span>vs</span><strong>{sourceName(pair.b)}</strong></span>
                <span data-label="Samples" className="numeric">{pair.samples}</span>
                <span data-label="Signed split" className="split">{pair.aEarlier} A <i>·</i> {pair.bEarlier} B <i>·</i> {pair.ties} tie</span>
                <span data-label="Median A − B" className="numeric">{pair.medianMs === null ? "—" : `${pair.medianMs > 0 ? "+" : ""}${Math.round(pair.medianMs)} ms`}</span>
                <span data-label="Verdict"><Verdict pair={pair} /></span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Establishing shared transitions" body="Each source needs an initial state, then two or more feeds must report the same change. Keep this page open through live play." />
        )}
      </section>

      <section className="section" aria-labelledby="tape-heading">
        <div className="sectionHeading"><div><h2 id="tape-heading">Transition tape</h2><p>Latest aligned evidence, newest first.</p></div><span>{transitions.length} observations</span></div>
        {transitions.length ? (
          <ol className="tape">
            {[...transitions].reverse().slice(0, 28).map((transition) => (
              <li key={transition.id}>
                <time dateTime={new Date(transition.observedAt).toISOString()}>{formatClock(transition.observedAt)}</time>
                <i className={`sourceDot sourceDot--${transition.source}`} aria-hidden="true" />
                <strong>{sourceName(transition.source)}</strong>
                <span>{transition.label}</span>
                <small>{transition.kind}</small>
              </li>
            ))}
          </ol>
        ) : <EmptyState title="No transitions yet" body="The first frame establishes each feed’s baseline. Changes after that point appear here." />}
      </section>

      <footer>
        <p>Development Redpanda · Read-only observer · Arrival times measured at this Vercel stream</p>
        <p>Source clocks are supporting telemetry, not used for winner selection.</p>
      </footer>
    </main>
  );
}

function Verdict({ pair }: { pair: ReturnType<typeof comparePairs>[number] }) {
  const label = pair.verdict === "faster" && pair.faster ? `${sourceName(pair.faster)} faster` : pair.verdict;
  return <span className={`verdict verdict--${pair.verdict}`}>{label}</span>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="emptyState"><span aria-hidden="true">↔</span><div><strong>{title}</strong><p>{body}</p></div></div>;
}
