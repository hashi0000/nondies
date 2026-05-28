"use client";

import React, { useMemo, useState } from "react";
import { LineChart } from "lucide-react";
import {
  buildPlayerSeries,
  COMPARE_METRIC_LABEL,
  type CompareMetric,
  type PlayerForChart,
  weeksForPlayers,
} from "@/lib/playerWeeklySeries";

const MAX_COMPARE = 4;

const LINE_COLORS = [
  { stroke: "#f87171", fill: "#f87171" },
  { stroke: "#38bdf8", fill: "#38bdf8" },
  { stroke: "#fbbf24", fill: "#fbbf24" },
  { stroke: "#34d399", fill: "#34d399" },
] as const;

const CHART_W = 720;
const CHART_H = 300;
const PAD = { l: 52, r: 20, t: 20, b: 40 };

function niceMax(n: number): number {
  if (n <= 0) return 10;
  const mag = 10 ** Math.floor(Math.log10(n));
  const norm = n / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

type PlayerCompareChartsProps = {
  players: PlayerForChart[];
  currentGameweek: number;
};

export function PlayerCompareCharts({ players, currentGameweek }: PlayerCompareChartsProps) {
  const [metric, setMetric] = useState<CompareMetric>("points");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");

  const playersWithData = useMemo(
    () =>
      players.filter(
        (p) =>
          (p.history?.length ?? 0) > 0 ||
          p.runs > 0 ||
          p.wickets > 0 ||
          p.catches > 0 ||
          p.wkCatches > 0 ||
          p.stumpings > 0 ||
          p.runOuts > 0 ||
          Boolean(p.didNotBat),
      ),
    [players],
  );

  const topBySeason = useMemo(() => {
    return [...playersWithData]
      .map((p) => {
        let total = 0;
        for (const h of p.history ?? []) total += Number(h.points) || 0;
        return { id: p.id, total };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, MAX_COMPARE)
      .map((x) => x.id);
  }, [playersWithData]);

  const weeks = useMemo(
    () => weeksForPlayers(playersWithData, currentGameweek),
    [playersWithData, currentGameweek],
  );

  const series = useMemo(() => {
    const picked = playersWithData.filter((p) => selectedIds.includes(p.id));
    return picked.map((p) => buildPlayerSeries(p, weeks, metric, currentGameweek));
  }, [playersWithData, selectedIds, weeks, metric, currentGameweek]);

  const chart = useMemo(() => {
    const plotW = CHART_W - PAD.l - PAD.r;
    const plotH = CHART_H - PAD.t - PAD.b;
    const allValues = series.flatMap((s) => s.points.map((pt) => pt.value));
    const yMax = niceMax(Math.max(...allValues, 1));
    const yMin = 0;

    const xForWeek = (week: number) => {
      if (weeks.length <= 1) return PAD.l + plotW / 2;
      const i = weeks.indexOf(week);
      return PAD.l + (i / (weeks.length - 1)) * plotW;
    };
    const yForValue = (v: number) => PAD.t + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(yMin + t * (yMax - yMin)));

    const paths = series.map((s, idx) => {
      const color = LINE_COLORS[idx % LINE_COLORS.length];
      if (s.points.length === 0) return null;
      const d = s.points
        .map((pt, i) => `${i === 0 ? "M" : "L"} ${xForWeek(pt.week).toFixed(1)} ${yForValue(pt.value).toFixed(1)}`)
        .join(" ");
      const dots = s.points.map((pt) => (
        <circle
          key={`${s.playerId}-${pt.week}`}
          cx={xForWeek(pt.week)}
          cy={yForValue(pt.value)}
          r={4}
          fill={color.fill}
          stroke="#09090b"
          strokeWidth={1.5}
        >
          <title>{`${s.name} · GW${pt.week}: ${pt.value}`}</title>
        </circle>
      ));
      return (
        <g key={s.playerId}>
          <path d={d} fill="none" stroke={color.stroke} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          {dots}
        </g>
      );
    });

    return { paths, yTicks, yForValue, xForWeek, yMax, plotW, plotH };
  }, [series, weeks]);

  const togglePlayer = (id: number) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_COMPARE) return [...prev.slice(1), id];
      return [...prev, id];
    });
  };

  const filteredPicker = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = [...playersWithData].sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return list;
    return list.filter((p) => p.name.toLowerCase().includes(q));
  }, [playersWithData, search]);

  const noWeeks = weeks.length === 0;

  return (
    <div className="mb-6 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-600/15 ring-1 ring-red-500/30">
            <LineChart className="h-5 w-5 text-red-300" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Compare form</h3>
            <p className="mt-0.5 text-xs text-zinc-400">
              Pick up to {MAX_COMPARE} players and track gameweek trends. Includes the current GW when stats are on the board.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as CompareMetric)}
            className="rounded-xl bg-zinc-950/80 px-3 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-red-500/60"
            aria-label="Chart metric"
          >
            {(Object.keys(COMPARE_METRIC_LABEL) as CompareMetric[]).map((k) => (
              <option key={k} value={k}>
                {COMPARE_METRIC_LABEL[k]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setSelectedIds(topBySeason)}
            className="rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 ring-1 ring-white/10 hover:bg-white/10"
          >
            Top {MAX_COMPARE} (season pts)
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds([])}
            className="rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-400 ring-1 ring-white/10 hover:bg-white/10 hover:text-zinc-200"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          className="rounded-full bg-red-600/20 px-3 py-1.5 text-xs font-semibold text-red-100 ring-1 ring-red-500/40 hover:bg-red-600/30"
        >
          {pickerOpen ? "Hide player list" : "Add players"}
        </button>
        {selectedIds.length === 0 ? (
          <span className="text-xs text-zinc-500">No players selected — use Add players or Top {MAX_COMPARE}.</span>
        ) : (
          series.map((s, idx) => {
            const color = LINE_COLORS[idx % LINE_COLORS.length];
            return (
              <button
                key={s.playerId}
                type="button"
                onClick={() => togglePlayer(s.playerId)}
                className="inline-flex items-center gap-2 rounded-full bg-zinc-950/80 py-1 pl-2 pr-2.5 text-xs font-medium text-zinc-200 ring-1 ring-white/10 hover:bg-zinc-900"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color.fill }} />
                {s.name}
                <span className="text-zinc-500">×</span>
              </button>
            );
          })
        )}
      </div>

      {pickerOpen ? (
        <div className="mt-3 rounded-xl bg-zinc-950/60 p-3 ring-1 ring-white/10">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search players…"
            className="mb-2 w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-500 ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-red-500/60"
          />
          <div className="max-h-40 overflow-y-auto">
            <div className="flex flex-wrap gap-2">
              {filteredPicker.map((p) => {
                const on = selectedIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePlayer(p.id)}
                    disabled={!on && selectedIds.length >= MAX_COMPARE}
                    className={[
                      "rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition",
                      on
                        ? "bg-red-600/25 text-red-100 ring-red-500/40"
                        : "bg-white/5 text-zinc-300 ring-white/10 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40",
                    ].join(" ")}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        {noWeeks ? (
          <p className="py-8 text-center text-sm text-zinc-500">No completed gameweeks yet — charts appear after GW stats are saved.</p>
        ) : selectedIds.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">Select players above to draw the comparison chart.</p>
        ) : (
          <svg
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            className="mx-auto w-full min-w-[320px] max-w-4xl"
            role="img"
            aria-label="Player performance comparison chart"
          >
            {chart.yTicks.map((tick) => {
              const y = chart.yForValue(tick);
              return (
                <g key={tick}>
                  <line x1={PAD.l} x2={CHART_W - PAD.r} y1={y} y2={y} stroke="rgba(255,255,255,0.08)" />
                  <text x={PAD.l - 8} y={y + 4} textAnchor="end" className="fill-zinc-500 text-[10px]">
                    {tick}
                  </text>
                </g>
              );
            })}
            {weeks.map((week) => {
              const x = chart.xForWeek(week);
              const isLive = week === currentGameweek;
              return (
                <text
                  key={week}
                  x={x}
                  y={CHART_H - 12}
                  textAnchor="middle"
                  className={isLive ? "fill-red-300 text-[10px] font-semibold" : "fill-zinc-500 text-[10px]"}
                >
                  GW{week}
                  {isLive ? "*" : ""}
                </text>
              );
            })}
            <text x={CHART_W / 2} y={CHART_H - 2} textAnchor="middle" className="fill-zinc-600 text-[9px]">
              {COMPARE_METRIC_LABEL[metric]}
              {weeks.includes(currentGameweek) ? " · * = includes current gameweek (live stats)" : ""}
            </text>
            {chart.paths}
          </svg>
        )}
      </div>
    </div>
  );
}
