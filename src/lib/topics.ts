import type { SourceId } from "./types";

// A comparison source: one Race-board row and one axis of the pairwise matrix.
// Display metadata lives here, keyed by SourceId — NOT on the topic — because
// several sources can share a single Kafka topic (the shared comparison lane).
export type SourceDefinition = {
  id: SourceId;
  label: string;
  shortLabel: string;
  cadence: string;
};

export const SOURCES: SourceDefinition[] = [
  { id: "opticodds", label: "OpticOdds results", shortLabel: "OpticOdds", cadence: "SSE" },
  { id: "statsapi", label: "MLB StatsAPI", shortLabel: "StatsAPI", cadence: "1s poll" },
  { id: "draftkings", label: "DraftKings", shortLabel: "DK", cadence: "WebSocket" },
  { id: "polymarket", label: "Polymarket sports", shortLabel: "Polymarket", cadence: "WebSocket" },
  { id: "espn", label: "ESPN Fastcast", shortLabel: "ESPN", cadence: "WebSocket" },
  { id: "scrape", label: "Sportsbook scrape", shortLabel: "Scrape", cadence: "Change driven" },
  { id: "market", label: "Normalized market", shortLabel: "Normalized", cadence: "Derived" },
  { id: "srlmt", label: "srlmt comparison feed", shortLabel: "srlmt", cadence: "WebSocket" },
];

// A Kafka topic the app subscribes to. `source` is the 1:1 producer for a
// dedicated topic. A shared lane has NO single source (`sharedLane: true`,
// `source` omitted): its records are tagged per-record by a "<source>|" key
// prefix and resolved at decode time.
export type TopicDefinition = {
  topic: string;
  source?: SourceId;
  sharedLane?: boolean;
};

export const TOPICS: TopicDefinition[] = [
  { topic: "opticodds.game.events.v1", source: "opticodds" },
  { topic: "statsapi.game.events.v1", source: "statsapi" },
  { topic: "draftkings.game.events.v1", source: "draftkings" },
  { topic: "polymarket.gamestate.events.v1", source: "polymarket" },
  { topic: "espn.game.events.v1", source: "espn" },
  { topic: "scrape.game.events.v1", source: "scrape" },
  { topic: "market.game.events.v1", source: "market" },
  // Shared comparison lane — carries several feeds (srlmt today, more later),
  // each identified per-record by its "<source>|" key prefix. Deliberately has
  // no `source`: the lane is a transport, not a producer.
  { topic: "market.game.test.events.v1", sharedLane: true },
];

export const SOURCE_ORDER: SourceId[] = SOURCES.map((source) => source.id);
export const SOURCE_BY_ID = new Map(SOURCES.map((source) => [source.id, source]));
export const TOPIC_BY_NAME = new Map(TOPICS.map((definition) => [definition.topic, definition]));
