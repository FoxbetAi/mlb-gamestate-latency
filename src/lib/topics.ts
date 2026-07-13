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
];

export const TOPIC_BY_NAME = new Map(TOPICS.map((definition) => [definition.topic, definition]));
export const SOURCE_ORDER = TOPICS.map((definition) => definition.id);
