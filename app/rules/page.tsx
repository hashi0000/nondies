import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Award, Calendar, ChevronRight, Crown, Dices, Star, TrendingUp, Trophy, Users, Zap } from "lucide-react";

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
  { id: "team",        label: "Building your team" },
  { id: "points",      label: "Points system" },
  { id: "roles",       label: "Captain & vice-captain" },
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
            </div>
          </div>

          <p className="mt-5 text-base leading-relaxed text-zinc-400 max-w-2xl">
            Pick your best XI from the Oxford &amp; Bletchingdon Nondescripts squad, assign your captain and vice-captain,
            and earn points based on real match performances every weekend.
          </p>
        </div>

        {/* Quick stats */}
        <div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard value="11" label="Players per team" sub="1 captain · 1 VC · 1 WK" />
          <StatCard value="£100" label="Budget" sub="Spread it wisely" />
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
                  Nondies Fantasy League is a weekly pick&apos;em game built around the club&apos;s actual match
                  performances. Before each match, you select a squad of <strong className="text-white">11 players</strong>{" "}
                  from the available pool within a <strong className="text-white">£100 budget</strong>. When the match is
                  played, the admin enters real stats (runs, wickets, catches) and your team earns points based on
                  how those players performed.
                </p>
                <p className="mt-3 text-sm leading-relaxed text-zinc-300">
                  Points <strong className="text-white">accumulate across every gameweek</strong> — so consistent
                  pickers who spot in-form players early will climb the overall leaderboard over the season.
                </p>
              </Card>
            </Section>

            {/* Building your team */}
            <Section id="team">
              <SectionTitle icon={<Users className="h-5 w-5" />}>Building your team</SectionTitle>
              <div className="grid gap-3">
                <Card>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">Rules</div>
                      <ul className="grid gap-2 text-sm text-zinc-300">
                        <li className="flex items-start gap-2">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-600/20 text-xs font-bold text-red-300">1</span>
                          Pick exactly <strong className="text-white ml-1">11 players</strong>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-600/20 text-xs font-bold text-red-300">2</span>
                          Stay within the <strong className="text-white ml-1">£100 budget</strong> — each player has a price
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-600/20 text-xs font-bold text-red-300">3</span>
                          Only pick <strong className="text-white ml-1">available players</strong> — the admin marks who is playing
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-600/20 text-xs font-bold text-red-300">4</span>
                          Assign a <strong className="text-white ml-1">Captain (C)</strong>, <strong className="text-white">Vice-Captain (VC)</strong> and <strong className="text-white">Wicketkeeper (WK)</strong>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-600/20 text-xs font-bold text-red-300">5</span>
                          <strong className="text-white">Save your team</strong> before the Friday 23:59 lock
                        </li>
                      </ul>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">Each week</div>
                      <ul className="grid gap-2 text-sm text-zinc-300">
                        <li className="flex items-start gap-2"><span className="text-red-400 mt-0.5">→</span> You can change your entire XI each gameweek</li>
                        <li className="flex items-start gap-2"><span className="text-red-400 mt-0.5">→</span> Your <strong className="text-white">previous points are kept</strong> — the leaderboard is cumulative</li>
                        <li className="flex items-start gap-2"><span className="text-red-400 mt-0.5">→</span> The admin ends the gameweek after the match, locking in that week&apos;s points</li>
                        <li className="flex items-start gap-2"><span className="text-red-400 mt-0.5">→</span> Player prices may change between gameweeks to reflect form</li>
                      </ul>
                    </div>
                  </div>
                </Card>

                {/* Price bands */}
                <Card>
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-3">Typical price bands</div>
                  <Table
                    headers={["Price range", "Tier"]}
                    rows={[
                      ["£13–£15", <span key="a" className="font-semibold text-amber-300">Elite — star all-rounders &amp; top batters</span>],
                      ["£9–£12", <span key="b" className="font-semibold text-zinc-200">Solid — reliable contributors</span>],
                      ["£6–£8",  <span key="c" className="text-zinc-300">Mid-tier — useful bits &amp; pieces</span>],
                      ["£5",     <span key="d" className="text-zinc-500">Budget — fill your XI cheaply</span>],
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
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-3">Base points</div>
                  <Table
                    headers={["Action", "Points"]}
                    rows={[
                      ["1 run scored",    <span key="r" className="font-bold text-white">+1 pt</span>],
                      ["1 wicket taken",  <span key="w" className="font-bold text-white">+16 pts</span>],
                      ["1 catch taken",   <span key="c" className="font-bold text-white">+8 pts</span>],
                    ]}
                  />
                </Card>

                <Card>
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">Run milestone bonuses</div>
                  <p className="text-xs text-zinc-500 mb-3">Added on top of base run points. Only the highest milestone applies.</p>
                  <Table
                    headers={["Milestone", "Bonus", "Example (50 runs)"]}
                    rows={[
                      ["25+ runs",  <span key="a" className="font-bold text-white">+5 pts</span>,  ""],
                      ["50+ runs",  <span key="b" className="font-bold text-white">+10 pts</span>, <span key="c" className="text-zinc-300">50 base + 10 bonus = <strong className="text-white">60 pts</strong></span>],
                      ["75+ runs",  <span key="d" className="font-bold text-white">+15 pts</span>, ""],
                      ["100+ runs", <span key="e" className="font-bold text-white">+25 pts</span>, <span key="f" className="text-zinc-300">100 base + 25 bonus = <strong className="text-white">125 pts</strong></span>],
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
              <SectionTitle icon={<Crown className="h-5 w-5" />}>Captain &amp; Vice-Captain</SectionTitle>
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
                    <span className="font-semibold text-white">Wicketkeeper dismissals</span>
                  </div>
                  <p className="text-sm text-zinc-400">
                    You must designate one player as your wicketkeeper. They still earn all normal batting points, but their
                    keeping dismissals score extra: wicketkeeping catches, stumpings and run-outs are all worth bonus points on top of
                    standard fielding. A keeper who bats, keeps tidily and is involved in dismissals can rack up very big scores.
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
                          { day: "Mon–Thu", text: "Select or update your XI. You can change it as many times as you like before the lock." },
                          { day: "Fri 23:59", text: "Selection locks. No more changes until after the match.", highlight: true },
                          { day: "Weekend", text: "The match is played. Real performances recorded by the club." },
                          { day: "Post-match", text: "Admin enters stats. Points calculated and added to the leaderboard." },
                          { day: "Next week", text: "Admin ends the gameweek. Points carry over. New week opens for selection." },
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
                  Your own entry is highlighted in red so you can find it quickly.
                  The leaderboard updates in real-time as the admin enters stats.
                </p>
              </Card>
            </Section>

            {/* Tips */}
            <Section id="tips">
              <SectionTitle icon={<Award className="h-5 w-5" />}>Tips for winning</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  {
                    title: "Captain the batter, not the bowler",
                    body: "A century scores 125 pts and gets doubled to 250 with the captain bonus. Three wickets is 48 pts × 2 = 96. Back the top-order bat for your armband.",
                  },
                  {
                    title: "Watch ownership",
                    body: "The draft pool shows how many teams have picked each player. If everyone has the same XI, you need differential picks to climb the table.",
                  },
                  {
                    title: "Check availability early",
                    body: "Only available players can be picked. Check the draft pool on match day to make sure none of your XI has been marked unavailable by the admin.",
                  },
                  {
                    title: "Form dots don&apos;t lie",
                    body: "Five green dots = pick them. Five grey dots = probably skip unless they&apos;re underpriced. The form guide is your single best tool before lock.",
                  },
                  {
                    title: "Don&apos;t overspend on one player",
                    body: "Spending £15 on one elite player leaves you scraping the barrel. A balanced squad with two or three £9–11 players often outperforms.",
                  },
                  {
                    title: "Consistent > lucky",
                    body: "One big week won&apos;t win the season. Two or three reliable picks who score 40–60 pts every week will rack up more total points than gambling on a ton that may not come.",
                  },
                ].map((tip) => (
                  <Card key={tip.title}>
                    <div className="mb-1 flex items-center gap-2">
                      <Star className="h-4 w-4 text-amber-400 shrink-0" />
                      <div className="font-semibold text-sm text-white">{tip.title}</div>
                    </div>
                    <p className="text-sm text-zinc-400 leading-relaxed" dangerouslySetInnerHTML={{ __html: tip.body }} />
                  </Card>
                ))}
              </div>
            </Section>

            {/* CTA */}
            <div className="rounded-2xl bg-red-600/10 ring-1 ring-red-500/20 p-6 text-center">
              <div className="text-xl font-bold text-white mb-1">Ready to play?</div>
              <p className="text-sm text-zinc-400 mb-4">Pick your XI and lock it in before Friday 23:59.</p>
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
