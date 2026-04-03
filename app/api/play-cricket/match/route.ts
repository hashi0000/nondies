import { NextRequest, NextResponse } from "next/server";
import { aggregatePlayCricketMatchDetail } from "@/lib/playCricket/aggregateMatchDetail";
import type { AggregatedRow } from "@/lib/playCricket/aggregateMatchDetail";

export async function GET(req: NextRequest) {
  const token = process.env.PLAY_CRICKET_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "Server missing PLAY_CRICKET_API_TOKEN. Add it to .env.local (server-only, not NEXT_PUBLIC_)." },
      { status: 500 },
    );
  }

  const matchId = req.nextUrl.searchParams.get("matchId");
  if (!matchId || !/^\d+$/.test(matchId)) {
    return NextResponse.json({ error: "Query ?matchId= must be a numeric Play Cricket match id." }, { status: 400 });
  }

  const url = `https://play-cricket.com/api/v2/match_detail.json?match_id=${matchId}&api_token=${encodeURIComponent(token)}`;
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Network error calling Play Cricket: ${msg}` }, { status: 502 });
  }

  if (!res.ok) {
    const detail = await res.text();
    return NextResponse.json(
      { error: `Play Cricket HTTP ${res.status}`, detail: detail.slice(0, 800) },
      { status: 502 },
    );
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return NextResponse.json({ error: "Play Cricket returned non-JSON." }, { status: 502 });
  }

  try {
    const { matchTitle, byNormalizedName } = aggregatePlayCricketMatchDetail(json);
    const players: Record<string, AggregatedRow> = {};
    for (const [k, v] of byNormalizedName) {
      players[k] = v;
    }
    return NextResponse.json({ matchId, matchTitle, players });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to parse match";
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
