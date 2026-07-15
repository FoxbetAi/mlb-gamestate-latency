import type { SourceId } from "./types";

export type TopicDefinition = {
  id: SourceId;
  topic: string;
  label: string;
  shortLabel: string;
  cadence: string;
};

export const TOPICS: TopicDefinition[] = [
  { id: "opticodds", topic: "opticodds.game.events.v1", label: "OpticOdds results", shortLabel: "OpticOdds", cadence: "SSE" },
  { id: "statsapi", topic: "statsapi.game.events.v1", label: "MLB StatsAPI", shortLabel: "StatsAPI", cadence: "1s poll" },
  { id: "draftkings", topic: "draftkings.game.events.v1", label: "DraftKings / SR LMT", shortLabel: "DK / SR", cadence: "WebSocket" },
  { id: "polymarket", topic: "polymarket.gamestate.events.v1", label: "Polymarket sports", shortLabel: "Polymarket", cadence: "WebSocket" },
  { id: "espn", topic: "espn.game.events.v1", label: "ESPN Fastcast", shortLabel: "ESPN", cadence: "WebSocket" },
  { id: "scrape", topic: "scrape.game.events.v1", label: "Sportsbook scrape", shortLabel: "Scrape", cadence: "Change driven" },
  { id: "market", topic: "market.game.events.v1", label: "Normalized market", shortLabel: "Normalized", cadence: "Derived" },
  // Shared comparison lane. Unlike every other topic this is NOT one-to-one with a
  // single source: it multiplexes several decoded feeds, each tagged per-record by
  // a "<source>|" key prefix (see SHARED_LANE_SOURCES). `id` here is only the
  // fallback source for a record whose key carries no recognizable prefix.
  { id: "srlmt", topic: "market.game.test.events.v1", label: "Comparison lane", shortLabel: "Compare", cadence: "WebSocket" },
];

// Feeds multiplexed on the shared comparison lane (market.game.test.events.v1),
// resolved per-record from the key prefix. Extend this as more feeds join the lane.
export const SHARED_LANE_SOURCES: SourceId[] = ["srlmt"];

export const TOPIC_BY_NAME = new Map(TOPICS.map((definition) => [definition.topic, definition]));

// Comparison axes (one tile / matrix row each): dedicated-topic sources plus every
// feed that rides the shared lane. Deduped in case a lane feed also has a topic.
export const SOURCE_ORDER: SourceId[] = Array.from(
  new Set<SourceId>([...TOPICS.map((definition) => definition.id), ...SHARED_LANE_SOURCES]),
);
