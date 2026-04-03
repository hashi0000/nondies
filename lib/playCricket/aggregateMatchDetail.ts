import { normalizePlayCricketName } from "./names";

export type AggregatedRow = {
  runs: number;
  wickets: number;
  catches: number;
  wkCatches: number;
  stumpings: number;
  runOuts: number;
};

function emptyRow(): AggregatedRow {
  return { runs: 0, wickets: 0, catches: 0, wkCatches: 0, stumpings: 0, runOuts: 0 };
}

function getRow(map: Map<string, AggregatedRow>, displayName: string): AggregatedRow | null {
  const k = normalizePlayCricketName(displayName);
  if (!k) return null;
  let row = map.get(k);
  if (!row) {
    row = emptyRow();
    map.set(k, row);
  }
  return row;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Best-effort fielding from dismissal text when `fielder_name` is empty. */
function creditFieldingFromHowOut(howOut: string, map: Map<string, AggregatedRow>) {
  const h = howOut.trim();
  if (!h || /not out|did not bat|retired/i.test(h)) return;

  const low = h.toLowerCase();

  // Stumped: "st Name b Bowler" or "stumped by Name"
  const stMatch = low.match(/\bst\s+([^b]+?)\s+b\s+/i) ?? low.match(/stumped\s+(?:by\s+)?([^(]+)/i);
  if (stMatch) {
    const r = getRow(map, stMatch[1]!.trim());
    if (r) r.stumpings += 1;
    return;
  }

  // Caught: "c Name b Bowler", "c sub b", "c & b"
  const cMatch = low.match(/^c\s+(.+?)\s+b\s+/i) ?? low.match(/^c\s+([^&]+)\s*&\s*b\s+/i);
  if (cMatch) {
    const fielder = cMatch[1]!.trim();
    if (fielder.toLowerCase() === "sub") return;
    const r = getRow(map, fielder);
    if (r) r.catches += 1;
    return;
  }

  // Run out — credit involved fielders (often "run out (A/B)" or "run out (A)")
  if (low.includes("run out")) {
    const paren = h.match(/\(([^)]+)\)/);
    if (paren) {
      const parts = paren[1]!.split(/[/,]+/).map((s) => s.trim()).filter(Boolean);
      for (const p of parts) {
        if (/^\d+$/.test(p)) continue;
        const r = getRow(map, p);
        if (r) r.runOuts += 1;
      }
    }
  }
}

function addBatRow(map: Map<string, AggregatedRow>, row: Record<string, unknown>) {
  const batsman = String(row.batsman_name ?? "").trim();
  if (!batsman) return;

  const br = getRow(map, batsman);
  if (br) br.runs += Math.max(0, Math.floor(num(row.runs)));

  const howOut = String(row.how_out ?? "");
  const fielderRaw = String(row.fielder_name ?? "").trim();

  if (fielderRaw) {
    const fr = getRow(map, fielderRaw);
    if (fr) {
      const low = howOut.toLowerCase();
      if (low.includes("stump") || /^st\s/i.test(low.trim())) {
        fr.stumpings += 1;
      } else if (/run out/i.test(low)) {
        fr.runOuts += 1;
      } else if (!/not out|did not bat|retired/i.test(low)) {
        fr.catches += 1;
      }
    }
  } else {
    creditFieldingFromHowOut(howOut, map);
  }
}

function addBowlRow(map: Map<string, AggregatedRow>, row: Record<string, unknown>) {
  const bowler = String(row.bowler_name ?? "").trim();
  if (!bowler) return;
  const w = Math.max(0, Math.floor(num(row.wickets)));
  if (w === 0) return;
  const br = getRow(map, bowler);
  if (br) br.wickets += w;
}

function asObjArray(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Record<string, unknown> => x !== null && typeof x === "object");
}

function matchRoot(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const md = d.match_details;
  if (Array.isArray(md) && md[0] && typeof md[0] === "object") {
    return md[0] as Record<string, unknown>;
  }
  return null;
}

export function aggregatePlayCricketMatchDetail(json: unknown): {
  matchTitle: string;
  byNormalizedName: Map<string, AggregatedRow>;
} {
  const root = matchRoot(json);
  if (!root) {
    throw new Error("Unrecognised Play Cricket response (missing match_details).");
  }

  const home = String(root.home_club_name ?? root.home_team_name ?? "").trim();
  const away = String(root.away_club_name ?? root.away_team_name ?? "").trim();
  const matchTitle = [home, away].filter(Boolean).join(" vs ") || "Match";

  const map = new Map<string, AggregatedRow>();
  const innings = asObjArray(root.innings);

  for (const inn of innings) {
    for (const row of asObjArray(inn.bat)) {
      addBatRow(map, row);
    }
    for (const row of asObjArray(inn.bowl)) {
      addBowlRow(map, row);
    }
  }

  return { matchTitle, byNormalizedName: map };
}
