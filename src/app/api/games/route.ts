import { NextResponse } from "next/server";
import { DEMO_GAME } from "@/lib/demo";
import type { Game } from "@/lib/types";

export const dynamic = "force-dynamic";

const CUBS_TEAM_ID = 112;

type MlbSchedule = {
  dates?: Array<{
    games?: Array<{
      gamePk: number;
      gameDate: string;
      status?: { detailedState?: string };
      venue?: { name?: string };
      teams?: {
        away?: { team?: { name?: string }; teamAbbreviation?: string };
        home?: { team?: { name?: string }; teamAbbreviation?: string };
      };
    }>;
  }>;
};

const date = (value: Date) => value.toISOString().slice(0, 10);

export async function GET() {
  if (process.env.DEMO_MODE === "true" || !process.env.REDPANDA_BROKERS) {
    return NextResponse.json({ games: [DEMO_GAME], demo: true });
  }

  const now = new Date();
  const start = new Date(now.getTime() - 2 * 86_400_000);
  const end = new Date(now.getTime() + 7 * 86_400_000);
  const url = new URL("https://statsapi.mlb.com/api/v1/schedule");
  url.searchParams.set("sportId", "1");
  url.searchParams.set("teamId", String(CUBS_TEAM_ID));
  url.searchParams.set("startDate", date(start));
  url.searchParams.set("endDate", date(end));
  url.searchParams.set("hydrate", "team");

  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`MLB schedule returned ${response.status}`);
    const schedule = await response.json() as MlbSchedule;
    const games: Game[] = (schedule.dates ?? []).flatMap((entry) => entry.games ?? []).map((game) => ({
      gamePk: String(game.gamePk),
      gameDate: game.gameDate,
      awayName: game.teams?.away?.team?.name ?? "Away",
      awayAbbr: game.teams?.away?.teamAbbreviation ?? "AWY",
      homeName: game.teams?.home?.team?.name ?? "Home",
      homeAbbr: game.teams?.home?.teamAbbreviation ?? "HME",
      venue: game.venue?.name ?? "Venue TBD",
      status: game.status?.detailedState ?? "Scheduled",
    }));
    return NextResponse.json({ games, demo: false });
  } catch (error) {
    return NextResponse.json({ games: [], demo: false, error: error instanceof Error ? error.message : "Unable to load Cubs schedule" }, { status: 502 });
  }
}
