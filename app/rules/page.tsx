import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Award, Calendar, ChevronRight, Crown, Dices, Gavel, Layers, Repeat, Star, TrendingUp, Trophy, Users, Zap } from "lucide-react";
import {
  BUDGET,
  FREE_TRANSFERS_PER_WEEK,
  LINEUP_LOCK_SUMMARY,
  LINEUP_LOCK_SUMMARY_SHORT,
  MAX_BANKED_FREE_TRANSFERS,
  POINTS_PER_EXTRA_TRANSFER,
  ROLE_LABEL,
  SQUAD_ROLES,
  SQUAD_SIZE,
} from "@/lib/leagueConfig";

export const metadata = {
  title: "How to Play — Nondies Fantasy League",
  description: "Points system, rules, and tips for Nondies Fantasy League.",
};

function Section({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      {children}
    </section>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-600/15 ring-1 ring-red-500/30 text-red-300">
        {icon}
      </div>
      <h2 className="text-xl font-bold tracking-tight text-white">{children}</h2>
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div className="overflow-hidden rounded-2xl ring-1 ring-white/10">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-black/40">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/8 bg-zinc-950/40">
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 text-zinc-200">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl bg-zinc-900/60 ring-1 ring-white/10 p-5 ${className}`}>
      {children}
    </div>
  );
}

function StatCard({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-zinc-900/60 ring-1 ring-white/10 p-4 text-center">
      <div className="text-3xl font-black tracking-tight text-white">{value}</div>
      <div className="mt-1 text-sm font-semibold text-zinc-300">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

const TOC = [
  { id: "overview",    label: "Overview" },
  { id: "regulations", label: "League regulations" },
  { id: "team",        label: "Building your team" },
  { id: "transfers",   label: "Transfers" },
  { id: "squads",      label: "1st XI & 2nd XI" },
  { id: "points",      label: "Points system" },
  { id: "roles",       label: "Captain, VC & WK" },
  { id: "gameweeks",   label: "Gameweeks & locks" },
  { id: "form",        label: "Form & history" },
  { id: "leaderboard", label: "Leaderboard" },
  { id: "tips",        label: "Tips" },
];

export default function RulesPage() {
  return (
    <div className="min-h-screen bg-[#080808] text-white">
      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-0 -translate-x-1/2 h-[500px] w-[700px] rounded-full bg-red-800/8 blur-[130px]" />
      </div>

      <div className="relative mx-auto max-w-4xl px-4 pb-20 pt-8 sm:px-6">

        {/* Header */}
        <div className="mb-10">
          <Link href="/"
            className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm font-medium text-zinc-300 ring-1 ring-white/10 hover:bg-white/10 hover:text-white transition mb-6">
            <ArrowLeft className="h-4 w-4" />
            Back to game
          </Link>

          <div className="flex items-center gap-4">
            <div className="relative h-14 w-14 shrink-0 drop-shadow-xl">
              <Image src="/logo.png" alt="Nondies CC" fill className="object-contain" priority />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight sm:text-4xl">How to Play</h1>
              <p className="mt-1 text-sm font-medium uppercase tracking-[0.16em] text-zinc-500">
                Nondies Fantasy League
              </p>
              <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-600">
                Made by <span className="font-semibold text-red-400">Hashim</span>
              </p>
            </div>
          </div>

          <p className="mt-5 text-base leading-relaxed text-zinc-400 max-w-2xl">
            Sign in (Google or email), then pick <strong className="text-zinc-200">{SQUAD_SIZE} players</strong> from the club list within a{" "}
            <strong className="text-zinc-200">£{BUDGET}</strong> squad cap (compact squads — same spirit as larger fantasy games that use £55m for 11 or £35m for 6).
            Players are tagged <strong className="text-zinc-200">1st XI</strong> or <strong className="text-zinc-200">2nd XI</strong> with different price bands so you must mix tiers.
            Assign captain, vice-captain and wicketkeeper, save to Firebase, and earn points from stats the admin records each gameweek.{" "}
            <strong className="text-zinc-300">Transfers:</strong>{" "}
            <strong className="text-zinc-200">{FREE_TRANSFERS_PER_WEEK}</strong> free change per gameweek (up to{" "}
            <strong className="text-zinc-200">{MAX_BANKED_FREE_TRANSFERS}</strong> banked); each extra change is planned at{" "}
            <strong className="text-zinc-200">−{POINTS_PER_EXTRA_TRANSFER}</strong> league points — see <a href="#transfers" className="font-medium text-red-400 underline decoration-red-500/50 underline-offset-2 hover:text-red-300">Transfers</a> below.
          </p>
        </div>

        {/* Quick stats */}
        <div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard value={String(SQUAD_SIZE)} label="Players per squad" sub="1 captain · 1 VC · 1 WK" />
          <StatCard value={`£${BUDGET}`} label="Squad cap" sub="1st XI + 2nd XI mix" />
          <StatCard value={`−${POINTS_PER_EXTRA_TRANSFER}`} label="Extra transfer" sub={`${FREE_TRANSFERS_PER_WEEK} free/wk · ${MAX_BANKED_FREE_TRANSFERS} max banked`} />
          <StatCard value="2×" label="Captain bonus" sub="VC gets 1.5×" />
          <StatCard value="∞" label="Gameweeks" sub="Points carry over" />
        </div>

        <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">

          {/* Table of contents — sticky on desktop */}
          <aside className="shrink-0 lg:w-52">
            <div className="sticky top-8 rounded-2xl bg-zinc-900/60 ring-1 ring-white/10 p-4">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Contents</div>
              <nav className="grid gap-1">
                {TOC.map((item) => (
                  <a key={item.id} href={`#${item.id}`}
                    className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-zinc-400 hover:bg-white/5 hover:text-white transition">
                    <ChevronRight className="h-3 w-3 shrink-0 text-zinc-600" />
                    {item.label}
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          {/* Main content */}
          <div className="min-w-0 grid gap-8 flex-1">

            {/* Overview */}
            <Section id="overview">
              <SectionTitle icon={<Dices className="h-5 w-5" />}>Overview</SectionTitle>
              <Card>
                <p className="text-sm leading-relaxed text-zinc-300">
                  Nondies Fantasy League runs in the browser against <strong className="text-white">Firebase</strong> (Firestore).
                  Each signed-in account has <strong className="text-white">one saved team</strong>. You pick{" "}
                  <strong className="text-white">{SQUAD_SIZE} players</strong> from the pool within <strong className="text-white">£{BUDGET}</strong>,
                  choose a <strong className="text-white">captain</strong> (2× points), <strong className="text-white">vice-captain</strong> (1.5×) and a{" "}
                  <strong className="text-white">wicketkeeper</strong> (required to save), then save. The app locks line-ups after{" "}
                  <strong className="text-white">{LINEUP_LOCK_SUMMARY}</strong> (local time) each week.
                </p>
                <p className="mt-3 text-sm leading-relaxed text-zinc-300">
                  After matches, league admins update each player&apos;s stats in the app (by hand or using the{" "}
                  <strong className="text-white">Play Cricket</strong> import where configured). Points for that gameweek are calculated from those numbers.
                  Your <strong className="text-white">leaderboard total is cumulative</strong> across the season; when the admin ends a gameweek,
                  weekly stats reset to zero for the next round while your running total stays on your team.{" "}
                  <strong className="text-zinc-300">Scoring:</strong> a player&apos;s draft role (batter, bowler, etc.) does not limit their points — if a batter bowls
                  (or a bowler bats), you get runs, wickets, catches and milestones from whatever the admin enters on their row, same formula for everyone.
                </p>
              </Card>
            </Section>

            {/* League regulations — constitution-style; some items are policy vs in-app enforcement */}
            <Section id="regulations">
              <SectionTitle icon={<Gavel className="h-5 w-5" />}>League regulations</SectionTitle>
              <div className="grid gap-3">
                <Card>
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">Accounts &amp; entries</div>
                  <ul className="grid gap-2 text-sm text-zinc-300 list-disc pl-4">
                    <li><strong className="text-white">One team per registered user.</strong> The app enforces a single Firestore document per account.</li>
                    <li>
                      <strong className="text-white">Squad value cap:</strong> in the app, <strong className="text-white">{SQUAD_SIZE} players</strong> and{" "}
                      <strong className="text-white">£{BUDGET}</strong> maximum spend (scaled from a traditional £100 cap for 11 players). In a larger ruleset this
                      corresponds to ideas like <strong className="text-white">£55m for 11</strong> or <strong className="text-white">£35m for 6</strong> — here we use a smaller squad and simple £ prices.
                    </li>
                    <li>
                      <strong className="text-white">When scoring starts:</strong> league policy is that teams must be submitted before the season (or first gameweek) opens
                      to score from GW1; late entries start from the gameweek after they joined, with <strong className="text-white">no backdated points</strong>. The app does not yet
                      auto-enforce entry dates — the committee should apply this when reading the leaderboard.
                    </li>
                  </ul>
                </Card>
                <Card>
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">Transfers &amp; captain</div>
                  <ul className="grid gap-2 text-sm text-zinc-300 list-disc pl-4">
                    <li>
                      <strong className="text-white">Transfer allowance (league defaults):</strong>{" "}
                      <strong className="text-white">{FREE_TRANSFERS_PER_WEEK}</strong> free player change per gameweek. Unused free transfers roll over so you can have up to{" "}
                      <strong className="text-white">{MAX_BANKED_FREE_TRANSFERS}</strong> free changes banked for a busy week. Each change beyond that costs{" "}
                      <strong className="text-white">{POINTS_PER_EXTRA_TRANSFER} points</strong> off your league total (committee can retune anytime in{" "}
                      <code className="rounded bg-black/40 px-1 font-mono text-[11px] text-zinc-200">lib/leagueConfig.ts</code> as <code className="rounded bg-black/40 px-1 font-mono text-[11px]">POINTS_PER_EXTRA_TRANSFER</code>).
                      Changes are meant to apply from the <strong className="text-white">following</strong> gameweek. If you transfer the captain out, pick a new captain.
                    </li>
                    <li>
                      <strong className="text-white">GW1 pre-lock window:</strong> unlimited free changes until the first lock at <strong className="text-white">{LINEUP_LOCK_SUMMARY}</strong> (local time).
                    </li>
                    <li>
                      <strong className="text-white">Wildcard:</strong> once per season, one gameweek of unlimited free transfers (league-operated).
                    </li>
                    <li>
                      <strong className="text-white">What the app enforces:</strong> while selections are unlocked you may edit your squad; on <strong className="text-white">Save</strong>, player changes vs your
                      gameweek baseline are counted. Free transfers roll over when the admin <strong className="text-white">ends a gameweek</strong> (capped as above); extra changes deduct{" "}
                      <strong className="text-white">{POINTS_PER_EXTRA_TRANSFER}</strong> league points per change from your cumulative total. Wildcard / &quot;next GW only&quot; queue / separate transfer budget are{" "}
                      <strong className="text-white">not</strong> implemented.
                    </li>
                    <li>
                      <strong className="text-white">Price rises &amp; falls:</strong> full rules may award extra transfer budget when a player you own rises in price, and claw back budget on falls.
                      The app <strong className="text-white">does not</strong> track purchase price or a separate transfer budget — only the fixed £{BUDGET} cap when saving.
                    </li>
                  </ul>
                </Card>
                <Card>
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">Squad composition (enforced in app)</div>
                  <p className="text-sm text-zinc-400 mb-3">
                    Each saved squad must have exactly <strong className="text-white">{SQUAD_ROLES.bat} {ROLE_LABEL.bat}s</strong>,{" "}
                    <strong className="text-white">{SQUAD_ROLES.ar} {ROLE_LABEL.ar}s</strong>, <strong className="text-white">{SQUAD_ROLES.bowl} {ROLE_LABEL.bowl}s</strong>, and{" "}
                    <strong className="text-white">{SQUAD_ROLES.wk} {ROLE_LABEL.wk}</strong> ({SQUAD_SIZE} players total, £{BUDGET} cap). The draft pool shows each player&apos;s role; you cannot add another player
                    once that role slot is full. Only a <strong className="text-white">WK-listed</strong> player can receive the WK button — your designated keeper must be that player.
                  </p>
                  <p className="text-sm text-zinc-400">
                    Admins set or correct roles under <strong className="text-white">Admin → Player stats</strong>. New players default to batter until changed.
                  </p>
                </Card>
                <Card>
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">Captain boosts (league policy)</div>
                  <ul className="grid gap-2 text-sm text-zinc-300 list-disc pl-4">
                    <li><strong className="text-white">In the app:</strong> captain <strong className="text-white">2×</strong>, vice-captain <strong className="text-white">1.5×</strong> each gameweek; you may change them whenever the squad is unlocked.</li>
                    <li>
                      <strong className="text-white">Triple captain chip:</strong> league rules may allow <strong className="text-white">one week per season</strong> at 3× on the captain.
                      <strong className="text-white"> Not implemented</strong> in software yet.
                    </li>
                  </ul>
                </Card>
              </div>
            </Section>

            {/* Building your team */}
            <Section id="team">
              <SectionTitle icon={<Users className="h-5 w-5" />}>Building your team</SectionTitle>
              <div className="grid gap-3">
                <Card>
                  <div className="mb-6 rounded-xl bg-white/[0.04] px-4 py-3.5 ring-1 ring-white/10">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Squad shape (enforced in the app)</div>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-200">
                      <strong className="text-white">{SQUAD_ROLES.bat}</strong> batters ·{" "}
                      <strong className="text-white">{SQUAD_ROLES.ar}</strong> all-rounders ·{" "}
                      <strong className="text-white">{SQUAD_ROLES.bowl}</strong> bowlers ·{" "}
                      <strong className="text-white">{SQUAD_ROLES.wk}</strong> wicketkeeper
                      <span className="text-zinc-500"> ({SQUAD_SIZE} picks, </span>
                      <strong className="text-white">£{BUDGET}</strong>
                      <span className="text-zinc-500"> cap). WK only on WK-listed players.</span>
                    </p>
                  </div>

                  <div className="grid gap-8 lg:grid-cols-2 lg:gap-10">
                    <div className="min-w-0">
                      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Checklist — before you save</h3>
                      <ol className="space-y-4 text-sm text-zinc-300">
                        {[
                          { n: "1", title: <>Pick exactly <strong className="text-white">{SQUAD_SIZE} players</strong>.</> },
                          {
                            n: "2",
                            title: <>Stay under the <strong className="text-white">£{BUDGET}</strong> squad cap.</>,
                            note: "Each player has a listed price; your total spend cannot exceed the cap.",
                          },
                          {
                            n: "3",
                            title: <>Only <strong className="text-white">available</strong> players.</>,
                            note: "The admin toggles who is selectable for the match.",
                          },
                          {
                            n: "4",
                            title: <>Assign <strong className="text-white">Captain (C)</strong>, <strong className="text-white">Vice-captain (VC)</strong>, and <strong className="text-white">Wicketkeeper (WK)</strong>.</>,
                            note: "WK must be the player tagged WK in the pool.",
                          },
                          {
                            n: "5",
                            title: <><strong className="text-white">Save</strong> to Firestore before {LINEUP_LOCK_SUMMARY} (your time).</>,
                            note: "After lock you cannot edit until the gameweek is processed.",
                          },
                        ].map((row) => (
                          <li key={row.n} className="flex gap-3">
                            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-600/25 text-xs font-bold text-red-200 ring-1 ring-red-500/35">
                              {row.n}
                            </span>
                            <div className="min-w-0 pt-0.5 leading-relaxed">
                              <div>{row.title}</div>
                              {"note" in row && row.note ? (
                                <div className="mt-1 text-xs leading-relaxed text-zinc-500">{row.note}</div>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ol>
                    </div>

                    <div className="min-w-0 border-t border-white/10 pt-8 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-10">
                      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">How the season flows</h3>
                      <ul className="space-y-4 text-sm text-zinc-300">
                        {[
                          `You can replace your whole squad any time the draft is unlocked (until ${LINEUP_LOCK_SUMMARY}).`,
                          "Leaderboard totals are cumulative — earlier weeks still count.",
                          "When the admin ends a gameweek, that week’s points are banked and the next gameweek opens.",
                          "Player prices and 1st XI / 2nd XI tags change only when an admin saves them — never automatically.",
                          "On the Draft tab, use All squads, 1st XI only, or 2nd XI only to filter the pool.",
                        ].map((text) => (
                          <li key={text} className="flex gap-3">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500/80" aria-hidden />
                            <span className="min-w-0 leading-relaxed">{text}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </Card>
              </div>
            </Section>

            <Section id="transfers">
              <SectionTitle icon={<Repeat className="h-5 w-5" />}>Transfers</SectionTitle>
              <Card>
                <ul className="space-y-3 text-sm leading-relaxed text-zinc-300">
                  <li className="flex gap-3">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500/80" aria-hidden />
                    <span>
                      <strong className="text-white">GW1 special:</strong> unlimited free changes up to the first weekly lock ({LINEUP_LOCK_SUMMARY} local time).
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500/80" aria-hidden />
                    <span>
                      <strong className="text-white">{FREE_TRANSFERS_PER_WEEK} free transfer</strong> per gameweek. Unused frees can{" "}
                      <strong className="text-white">bank</strong> up to <strong className="text-white">{MAX_BANKED_FREE_TRANSFERS}</strong> for later weeks (they do not stack beyond that cap).
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500/80" aria-hidden />
                    <span>
                      Each change beyond your free allowance (after bank is used) costs{" "}
                      <strong className="text-white">−{POINTS_PER_EXTRA_TRANSFER}</strong> points deducted from your{" "}
                      <strong className="text-white">cumulative league total</strong> for that gameweek (same scale as match points).
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500/80" aria-hidden />
                    <span className="text-zinc-400">
                      The app applies this on save and rolls free transfers forward when an admin ends the gameweek. Tunables live in{" "}
                      <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-zinc-200">lib/leagueConfig.ts</code>.
                    </span>
                  </li>
                </ul>
              </Card>
            </Section>

            {/* 1st XI & 2nd XI — matches app squad tiers */}
            <Section id="squads">
              <SectionTitle icon={<Layers className="h-5 w-5" />}>1st XI &amp; 2nd XI</SectionTitle>
              <div className="grid gap-3">
                <Card>
                  <p className="text-sm leading-relaxed text-zinc-300">
                    Every player has a <strong className="text-white">squad tier</strong> shown in the draft pool: <strong className="text-white">1st XI</strong> (first-team squad)
                    or <strong className="text-white">2nd XI</strong> (second-team / value). The seeded roster uses higher prices for 1st XI and lower for 2nd XI so you{" "}
                    <strong className="text-white">cannot</strong> afford {SQUAD_SIZE} cheapest 1st XI picks within £{BUDGET} — you must blend both tiers.
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-zinc-300">
                    Default seeding in the app: roughly <strong className="text-white">18</strong> players as 1st XI and <strong className="text-white">17</strong> as 2nd XI.
                    Admins can change tier and price per player in <strong className="text-white">Admin → Player stats</strong> (saved to Firestore).
                  </p>
                </Card>
                <Card>
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-3">Price bands (as shipped in the seed data)</div>
                  <Table
                    headers={["Squad", "Typical price range", "Purpose"]}
                    rows={[
                      [
                        <span key="t1" className="font-semibold text-sky-300">1st XI</span>,
                        "£12 – £18",
                        <span key="d1" className="text-zinc-300">Premium picks — high floor so a full 1st XI squad is over budget</span>,
                      ],
                      [
                        <span key="t2" className="font-semibold text-zinc-200">2nd XI</span>,
                        "£5 – £8",
                        <span key="d2" className="text-zinc-300">{`Value picks — mix with 1st XI to finish under £${BUDGET}`}</span>,
                      ],
                    ]}
                  />
                </Card>
              </div>
            </Section>

            {/* Points system */}
            <Section id="points">
              <SectionTitle icon={<Zap className="h-5 w-5" />}>Points system</SectionTitle>
              <div className="grid gap-3">
                <Card>
                  <p className="text-xs text-zinc-500 mb-3">
                    Scoring matches the app&apos;s calculator: run points plus a single run-milestone bonus, then wickets, outfield catches, and keeper-related bonuses.
                    The draft list role (batter vs bowler, etc.) is only for squad composition — if a batter takes wickets or a bowler scores runs in real life, you get those stats as entered.
                  </p>
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-3">Batting &amp; bowling</div>
                  <Table
                    headers={["Stat", "Points"]}
                    rows={[
                      ["1 run scored", <span key="r" className="font-bold text-white">+1 pt</span>],
                      ["1 wicket taken", <span key="w" className="font-bold text-white">+16 pts</span>],
                    ]}
                  />
                </Card>

                <Card>
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">Run milestone bonuses</div>
                  <p className="text-xs text-zinc-500 mb-3">Added on top of run points. <strong className="text-zinc-400">Only the highest milestone applies</strong> (same as the code: 100+ beats 75+ beats 50+, etc.).</p>
                  <Table
                    headers={["Milestone", "Bonus", "Example"]}
                    rows={[
                      ["25+ runs",  <span key="a" className="font-bold text-white">+5 pts</span>,  ""],
                      ["50+ runs",  <span key="b" className="font-bold text-white">+10 pts</span>, <span key="c" className="text-zinc-300">50 runs → 50 + 10 = <strong className="text-white">60 pts</strong> (before C/VC)</span>],
                      ["75+ runs",  <span key="d" className="font-bold text-white">+15 pts</span>, ""],
                      ["100+ runs", <span key="e" className="font-bold text-white">+25 pts</span>, <span key="f" className="text-zinc-300">100 runs → 100 + 25 = <strong className="text-white">125 pts</strong></span>],
                    ]}
                  />
                </Card>

                <Card>
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">Fielding &amp; wicketkeeping</div>
                  <p className="text-xs text-zinc-500 mb-3">
                    <strong className="text-zinc-400">Outfield catches</strong> use the &quot;catches&quot; total minus wicketkeeping catches. WK catches, stumpings and run-outs are scored separately (how the admin enters the row).
                  </p>
                  <Table
                    headers={["Action", "Points"]}
                    rows={[
                      ["Outfield catch (each)", <span key="oc" className="font-bold text-white">+8 pts</span>],
                      ["Wicketkeeping catch (each)", <span key="wk" className="font-bold text-white">+10 pts</span>],
                      ["Stumping (each)", <span key="st" className="font-bold text-white">+12 pts</span>],
                      ["Run-out involvement (each)", <span key="ro" className="font-bold text-white">+10 pts</span>],
                    ]}
                  />
                </Card>

                {/* Worked examples */}
                <Card>
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-3">Worked examples</div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {[
                      {
                        label: "Batter",
                        stats: "64 runs, 1 catch",
                        calc: "64 + 10 (50 bonus) + 8 (catch)",
                        total: "82 pts",
                      },
                      {
                        label: "Bowler",
                        stats: "3 wickets, 0 runs",
                        calc: "3 × 16",
                        total: "48 pts",
                      },
                      {
                        label: "All-rounder",
                        stats: "45 runs, 2 wickets",
                        calc: "45 + 5 (25 bonus) + 2 × 16",
                        total: "82 pts",
                      },
                    ].map((ex) => (
                      <div key={ex.label} className="rounded-xl bg-white/5 p-3 ring-1 ring-white/8">
                        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">{ex.label}</div>
                        <div className="text-xs text-zinc-400">{ex.stats}</div>
                        <div className="mt-1 text-xs text-zinc-500">{ex.calc}</div>
                        <div className="mt-2 text-xl font-black text-white">{ex.total}</div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </Section>

            {/* Captain & VC */}
            <Section id="roles">
              <SectionTitle icon={<Crown className="h-5 w-5" />}>Captain, vice-captain &amp; wicketkeeper</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2">
                <Card>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="rounded-md bg-red-600/20 px-2 py-0.5 text-xs font-black text-red-300 ring-1 ring-red-500/30">C</span>
                    <span className="font-semibold text-white">Captain — 2× multiplier</span>
                  </div>
                  <p className="text-sm text-zinc-400">
                    Your captain&apos;s points are <strong className="text-white">doubled</strong>. If they score
                    80 pts, you get 160. Pick your captain wisely — they are your biggest lever each week.
                  </p>
                  <div className="mt-3 rounded-xl bg-red-600/10 p-3 ring-1 ring-red-500/20">
                    <div className="text-xs text-zinc-400">Example</div>
                    <div className="text-sm text-zinc-200 mt-1">80 base pts × 2 = <strong className="text-white">160 pts</strong></div>
                  </div>
                </Card>
                <Card>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="rounded-md bg-amber-500/20 px-2 py-0.5 text-xs font-black text-amber-300 ring-1 ring-amber-500/30">VC</span>
                    <span className="font-semibold text-white">Vice-Captain — 1.5× multiplier</span>
                  </div>
                  <p className="text-sm text-zinc-400">
                    Your vice-captain&apos;s points are multiplied by <strong className="text-white">1.5×</strong>. A
                    solid back-up to your captain choice — great for reliable mid-price players.
                  </p>
                  <div className="mt-3 rounded-xl bg-amber-500/10 p-3 ring-1 ring-amber-500/20">
                    <div className="text-xs text-zinc-400">Example</div>
                    <div className="text-sm text-zinc-200 mt-1">60 base pts × 1.5 = <strong className="text-white">90 pts</strong></div>
                  </div>
                </Card>
                <Card className="sm:col-span-2">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="rounded-md bg-sky-500/20 px-2 py-0.5 text-xs font-bold text-sky-300 ring-1 ring-sky-500/30">WK</span>
                    <span className="font-semibold text-white">Wicketkeeper (required)</span>
                  </div>
                  <p className="text-sm text-zinc-400">
                    The app requires you to tap <strong className="text-white">WK</strong> on one of your {SQUAD_SIZE} players before you can save.
                    Points are <strong className="text-white">not</strong> boosted just because someone is your WK — the same formula applies to everyone.
                    Wicketkeeping catches, stumpings and run-outs in the <strong className="text-white">player stats table</strong> are what add the keeper bonuses;
                    the admin should enter those on the player who actually kept or was credited on the scorecard.
                  </p>
                </Card>
              </div>
            </Section>

            {/* Gameweeks */}
            <Section id="gameweeks">
              <SectionTitle icon={<Calendar className="h-5 w-5" />}>Gameweeks &amp; locks</SectionTitle>
              <div className="grid gap-3">
                <Card>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-3">Weekly timeline</div>
                      <ol className="relative border-l border-white/10 ml-2 grid gap-5">
                        {[
                          { day: "Mon–Fri", text: "Select or update your squad. You can change it as many times as you like until the weekly lock." },
                          { day: LINEUP_LOCK_SUMMARY_SHORT, text: "Selection locks. No more changes until the admin ends the gameweek.", highlight: true },
                          { day: "Weekend", text: "The match is played. Real performances recorded by the club." },
                          { day: "Post-match", text: "Admin updates stats (manually or via Play Cricket match import). Points for the week are computed from those numbers." },
                          { day: "End GW", text: "Admin ends the gameweek: each team’s cumulative total increases by that week’s score; player weekly stats reset to zero for the next round." },
                        ].map((step) => (
                          <li key={step.day} className="ml-5">
                            <span className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full bg-zinc-700 ring-2 ring-[#080808]" />
                            <div className={`text-xs font-semibold mb-0.5 ${step.highlight ? "text-amber-400" : "text-zinc-400"}`}>
                              {step.day}
                            </div>
                            <div className="text-sm text-zinc-300">{step.text}</div>
                          </li>
                        ))}
                      </ol>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-3">Cumulative points</div>
                      <p className="text-sm text-zinc-400 leading-relaxed">
                        Unlike a single-week competition, this league runs across the <strong className="text-white">entire season</strong>.
                        Your points from every gameweek are added together. The leaderboard shows both your{" "}
                        <strong className="text-white">current week&apos;s score</strong> and your{" "}
                        <strong className="text-white">all-time total</strong>.
                      </p>
                      <div className="mt-4 rounded-xl bg-white/5 p-3 ring-1 ring-white/10 text-sm">
                        <div className="text-xs font-semibold text-zinc-500 mb-2">Example season</div>
                        <div className="grid gap-1.5 text-zinc-300">
                          <div className="flex justify-between"><span>GW1</span><span className="font-bold text-white">+342 pts</span></div>
                          <div className="flex justify-between"><span>GW2</span><span className="font-bold text-white">+289 pts</span></div>
                          <div className="flex justify-between"><span>GW3</span><span className="font-bold text-white">+415 pts</span></div>
                          <div className="mt-1 border-t border-white/10 pt-1 flex justify-between">
                            <span className="font-semibold text-white">Total</span>
                            <span className="font-black text-white">1,046 pts</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            </Section>

            {/* Form */}
            <Section id="form">
              <SectionTitle icon={<TrendingUp className="h-5 w-5" />}>Form &amp; history</SectionTitle>
              <Card>
                <p className="text-sm leading-relaxed text-zinc-300 mb-4">
                  Each player&apos;s last 5 gameweeks are shown as coloured dots on their card in the draft pool.
                  Use these to spot who is in form and who has gone cold before you commit your captain pick.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-3">Dot colours</div>
                    <div className="grid gap-2">
                      {[
                        { color: "bg-emerald-400", label: "60+ pts", desc: "Excellent performance" },
                        { color: "bg-amber-400",   label: "30–59 pts", desc: "Good performance" },
                        { color: "bg-orange-500",  label: "1–29 pts", desc: "Below average" },
                        { color: "bg-zinc-600",    label: "0 pts",    desc: "Did not contribute" },
                        { color: "bg-white/10",    label: "No data",  desc: "Did not play / new player" },
                      ].map((d) => (
                        <div key={d.label} className="flex items-center gap-3 text-sm">
                          <span className={`h-3 w-3 rounded-full shrink-0 ${d.color}`} />
                          <span className="font-medium text-zinc-200 w-16">{d.label}</span>
                          <span className="text-zinc-500">{d.desc}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                    <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">Reading the dots</div>
                    <p className="text-sm text-zinc-400 leading-relaxed">
                      Dots run <strong className="text-white">oldest → newest</strong> (left to right).
                      A player with five green dots is in excellent form. A player with a mix of orange and grey
                      may be struggling — worth a cheaper pick this week.
                    </p>
                    <div className="mt-3 flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-zinc-600" />
                      <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                      <span className="ml-2 text-xs text-zinc-400">Coming into form nicely</span>
                    </div>
                  </div>
                </div>
              </Card>
            </Section>

            {/* Leaderboard */}
            <Section id="leaderboard">
              <SectionTitle icon={<Trophy className="h-5 w-5" />}>Leaderboard</SectionTitle>
              <Card>
                <p className="text-sm leading-relaxed text-zinc-300 mb-4">
                  The leaderboard shows every player&apos;s team and their scores. Each entry displays two numbers:
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                    <div className="text-2xl font-black text-zinc-200">This week</div>
                    <p className="mt-1 text-sm text-zinc-400">
                      Points earned from this gameweek&apos;s performances only, including captain and VC multipliers.
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                    <div className="text-2xl font-black text-white">Total</div>
                    <p className="mt-1 text-sm text-zinc-400">
                      Cumulative points across the entire season. This is the number that determines your overall
                      position in the league.
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-sm text-zinc-500">
                  Your own entry is highlighted so you can find it quickly. The list syncs live from Firestore as teams and stats change.
                  Tap <strong className="text-zinc-400">View squad</strong> to see another manager&apos;s picks, prices, squad tier (1st / 2nd XI) and base points for that week.
                </p>
              </Card>
            </Section>

            {/* Tips */}
            <Section id="tips">
              <SectionTitle icon={<Award className="h-5 w-5" />}>Tips for winning</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  {
                    title: "Mix 1st XI and 2nd XI",
                    body: "The economy is built so you need value picks. Plan a few premium 1st XI stars, then fill the rest with 2nd XI players who still score if they play.",
                  },
                  {
                    title: "Captain the batter, not the bowler",
                    body: "A century is 125 base pts before multipliers — doubled as captain that is huge. Three wickets is 48 base pts × 2 = 96. Batsmen often win the armband race.",
                  },
                  {
                    title: "Watch ownership",
                    body: "The draft pool shows how many teams picked each player. Same XI as everyone else caps your upside; differentials matter.",
                  },
                  {
                    title: "Check availability early",
                    body: "Only players marked available can be in a saved team. If the admin toggles someone off before lock, swap them out or your save will fail validation.",
                  },
                  {
                    title: "Form dots do not lie",
                    body: "Green dots (60+ in a past week) mean big returns; greys mean no or little history. Oldest dot is on the left, newest on the right.",
                  },
                  {
                    title: "Spread the budget",
                    body: `Several mid-priced picks plus one or two punts often beats blowing most of the £${BUDGET} cap on a handful of 1st XI premiums with weak fillers.`,
                  },
                  {
                    title: "Consistency beats one miracle week",
                    body: "The leaderboard is cumulative. Reliable 40–60 pt weeks add up across the season more than banking everything on one monster score.",
                  },
                ].map((tip) => (
                  <Card key={tip.title}>
                    <div className="mb-1 flex items-center gap-2">
                      <Star className="h-4 w-4 text-amber-400 shrink-0" />
                      <div className="font-semibold text-sm text-white">{tip.title}</div>
                    </div>
                    <p className="text-sm text-zinc-400 leading-relaxed">{tip.body}</p>
                  </Card>
                ))}
              </div>
            </Section>

            {/* CTA */}
            <div className="rounded-2xl bg-red-600/10 ring-1 ring-red-500/20 p-6 text-center">
              <div className="text-xl font-bold text-white mb-1">Ready to play?</div>
              <p className="text-sm text-zinc-400 mb-4">Pick your squad and lock it in before {LINEUP_LOCK_SUMMARY}.</p>
              <Link href="/"
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-3 text-sm font-bold text-white ring-1 ring-red-500/40 hover:bg-red-500 transition">
                Go to Draft
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
