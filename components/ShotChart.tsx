"use client";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import type { ProcessedPlay } from "@/lib/spoiler-engine";
import { gameTimeSecsToDisplay } from "@/lib/spoiler-engine";
import type { ESPNCompetitor } from "@/lib/espn";
import { getTeamColor, getTeamSecondary } from "@/lib/teams";
import { getTeamLogoUrl } from "@/lib/espn";
import { hexWithOpacity, cn } from "@/lib/utils";
import type { Shot3DInput } from "./ShotChart3D";
import { DarkSelect, type DarkSelectGroup } from "./DarkSelect";

// Heavy 3D view — only loaded when the user toggles to 3D, so 2D users
// don't pay the three.js bundle cost. ssr:false because R3F can't render
// server-side (uses WebGL + window).
const ShotChart3D = dynamic(() => import("./ShotChart3D"), {
  ssr: false,
  loading: () => (
    <div
      className="w-full rounded-xl flex items-center justify-center text-white/40 text-sm"
      style={{ aspectRatio: "16 / 11", maxHeight: 640, background: "#0a0a14" }}>
      Loading 3D court…
    </div>
  ),
});

interface ShotChartProps {
  plays: ProcessedPlay[];
  home: ESPNCompetitor;
  away: ESPNCompetitor;
  teamMap?: Record<string, "home" | "away">;
  // Optional athlete-id → display-name map (built upstream from the
  // boxscore). Powers the "filter by player" dropdown.
  playerNamesById?: Record<string, string>;
  // Optional athlete-id → jersey-number map (also from boxscore). Used by
  // the 3D view's hover tooltip. Falls back to no jersey if absent.
  playerJerseysById?: Record<string, string>;
  // Optional athlete-id → headshot URL. Used by the 3D shooter figure to
  // sample a skin tone per-player; falls back to a neutral default.
  playerHeadshotsById?: Record<string, string>;
  // Optional athlete-id → height (inches). Used by the 3D shooter figure
  // to scale realistically against the 10 ft rim. Falls back to 6'2" (74).
  playerHeightsById?: Record<string, number>;
  // True while the game's status is "in" (currently being played). Drives
  // the pulsing LIVE indicator on the History toggle in 3D mode.
  isGameLive?: boolean;
  // ESPN game state: "pre" | "in" | "post". Drives the 3D loading overlay
  // copy so we can say "Waiting for Game to begin" / "Live Game has Ended"
  // instead of a generic "Loading…".
  gameState?: string;
  // Live (or delayed) game state — drives the 3D mini-scoreboard above
  // the backboard. All optional so the 2D path doesn't need them.
  homeScore?: string | number;
  awayScore?: string | number;
  liveClock?: string;
  livePeriod?: number;
  gameStateText?: string;       // e.g. "Halftime", "End of 3rd Quarter"
  homeTimeoutsLeft?: number;
  awayTimeoutsLeft?: number;
  maxTimeouts?: number;
}

// ── Half-court geometry (10 px = 1 ft) ─────────────────────────────────────
const W = 500;            // court width  = 50 ft
const H = 470;            // half-court depth = 47 ft
const BX = 250;           // basket center X (court middle)
const BY = 425;           // basket center Y (4.5 ft from baseline)
const BASELINE_Y = 470;
const LANE_W = 160;       // 16 ft
const LANE_H = 190;       // 19 ft
const LANE_X = (W - LANE_W) / 2;
const LANE_TOP_Y = BASELINE_Y - LANE_H;
const FT_R = 60;          // free-throw circle radius (6 ft)
const THREE_R = 221.5;    // WNBA 3-pt radius (22.15 ft) — uniform
const RIM_R = 9;          // 18 in. rim diameter ≈ 1.5 ft

// ESPN uses INT_MIN-ish sentinels for "no coordinate". Anything that absurd
// is invalid; valid shot coords are within the half-court.
function isValidCoord(c: { x: number; y: number } | undefined): c is { x: number; y: number } {
  if (!c) return false;
  if (Math.abs(c.x) > 200 || Math.abs(c.y) > 200) return false;
  if (c.x < 0 || c.y < 0) return false;
  return true;
}

// ── Court SVG ─────────────────────────────────────────────────────────────
function HalfCourt() {
  const line = "rgba(255,255,255,0.18)";
  const lineFaint = "rgba(255,255,255,0.08)";

  return (
    <g>
      {/* Background + border */}
      <rect x={0} y={0} width={W} height={H} rx={10} fill="#0c0c1c" />
      <rect x={1.5} y={1.5} width={W - 3} height={H - 3} rx={9}
        fill="none" stroke={line} strokeWidth={1.5} />

      {/* Mid-court line (top edge) and circle hint */}
      <line x1={0} y1={4} x2={W} y2={4} stroke={lineFaint} strokeWidth={1.5} />
      <path d={`M ${BX - 60} 4 A 60 60 0 0 0 ${BX + 60} 4`}
        fill="none" stroke={lineFaint} strokeWidth={1.2} />

      {/* Lane (key) */}
      <rect x={LANE_X} y={LANE_TOP_Y} width={LANE_W} height={LANE_H}
        fill="rgba(255,255,255,0.025)" stroke={line} strokeWidth={1.5} />

      {/* Free-throw circle — solid top half (in the key), dashed bottom (outside) */}
      <path d={`M ${BX - FT_R} ${LANE_TOP_Y} A ${FT_R} ${FT_R} 0 0 1 ${BX + FT_R} ${LANE_TOP_Y}`}
        fill="none" stroke={line} strokeWidth={1.5} />
      <path d={`M ${BX - FT_R} ${LANE_TOP_Y} A ${FT_R} ${FT_R} 0 0 0 ${BX + FT_R} ${LANE_TOP_Y}`}
        fill="none" stroke={line} strokeWidth={1.2} strokeDasharray="6 5" />

      {/* 3-point arc (uniform 22.15 ft from basket center) */}
      <path d={`M ${BX - THREE_R} ${BY} A ${THREE_R} ${THREE_R} 0 0 1 ${BX + THREE_R} ${BY}`}
        fill="none" stroke={line} strokeWidth={1.8} />

      {/* Restricted area arc (4 ft) */}
      <path d={`M ${BX - 40} ${BY} A 40 40 0 0 1 ${BX + 40} ${BY}`}
        fill="none" stroke={lineFaint} strokeWidth={1} />

      {/* Backboard */}
      <line x1={BX - 30} y1={BY + 12} x2={BX + 30} y2={BY + 12}
        stroke="rgba(255,255,255,0.4)" strokeWidth={3} strokeLinecap="round" />
      {/* Rim */}
      <circle cx={BX} cy={BY} r={RIM_R}
        fill="none" stroke="rgba(252,165,3,0.85)" strokeWidth={2} />
    </g>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────
function detectSide(
  play: ProcessedPlay,
  homeAbbr: string,
  awayAbbr: string,
  homeId: string,
  awayId: string,
  homeName: string,
  awayName: string,
  teamMap: Record<string, "home" | "away">,
): "home" | "away" | null {
  // 1. ESPN puts the acting team's ID directly on the play — the most
  //    reliable signal. This is what was missing before.
  if (play.team?.id) {
    if (play.team.id === homeId) return "home";
    if (play.team.id === awayId) return "away";
    const a = play.team.abbreviation?.toUpperCase();
    if (a === homeAbbr.toUpperCase()) return "home";
    if (a === awayAbbr.toUpperCase()) return "away";
  }

  // 2. Athlete → team map built from boxscore. Try both `participants`
  //    (newer) and `athletes` (older) shapes.
  const athleteId =
    play.participants?.[0]?.athlete?.id ??
    play.athletes?.[0]?.athlete?.id;
  if (athleteId && teamMap[athleteId]) return teamMap[athleteId];

  // 3. Athlete-embedded team (rarely populated, but check anyway)
  const t = play.athletes?.[0]?.athlete?.team;
  if (t) {
    const a = t.abbreviation?.toUpperCase();
    if (a === homeAbbr.toUpperCase()) return "home";
    if (a === awayAbbr.toUpperCase()) return "away";
    if (t.id && t.id === homeId) return "home";
    if (t.id && t.id === awayId) return "away";
  }

  // 4. Last-resort: scan play text for the team's display name
  const txt = (play.text ?? "").toLowerCase();
  if (homeName && txt.includes(homeName.toLowerCase())) return "home";
  if (awayName && txt.includes(awayName.toLowerCase())) return "away";
  return null;
}

interface Shot {
  play: ProcessedPlay;
  svgX: number;
  svgY: number;
  side: "home" | "away" | null;
  made: boolean;
  isThree: boolean;
  period: number;
  distFt: number;
  playerId: string | null;
}

// ── Main ──────────────────────────────────────────────────────────────────
type SideFilter = "all" | "home" | "away";
type ResultFilter = "all" | "made" | "missed";

export default function ShotChart({
  plays,
  home,
  away,
  teamMap = {},
  playerNamesById = {},
  playerJerseysById = {},
  playerHeadshotsById = {},
  playerHeightsById = {},
  isGameLive = false,
  homeScore = "0",
  awayScore = "0",
  liveClock,
  livePeriod,
  gameStateText,
  homeTimeoutsLeft,
  awayTimeoutsLeft,
  maxTimeouts = 7,
  gameState,
}: ShotChartProps) {
  const [sideFilter, setSideFilter] = useState<SideFilter>("all");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [periodFilter, setPeriodFilter] = useState<number | "all">("all");
  const [playerFilter, setPlayerFilter] = useState<string>("all");
  // Defaults when the user opens the Shot Chart tab:
  //   - 3D view (the showcase visualization)
  //   - LIVE mode if the game is currently in progress, otherwise Show
  //     History (with LIVE disabled by the FilterGroup option below).
  // Lazy initializers so we read the live state at mount time only —
  // subsequent prop changes route through the useEffect below.
  const [viewMode, setViewMode] = useState<"2d" | "3d">("3d");
  const [hideHistory, setHideHistory] = useState<boolean>(() => isGameLive);

  // LIVE mode only makes sense while the game is in progress. If the game
  // is pre/post and the user previously had LIVE on, snap back to Show
  // so the user isn't stuck looking at a single replay shot they can't
  // change.
  useEffect(() => {
    if (!isGameLive && hideHistory) queueMicrotask(() => setHideHistory(false));
  }, [isGameLive, hideHistory]);
  const [tooltip, setTooltip] = useState<{
    svgX: number; svgY: number; text: string; color: string; playerId: string | null;
  } | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- referenced via 2D UI + 3D props; eslint may not see all paths
  const homeColor = getTeamColor(home.team.abbreviation) || "#a855f7";
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const awayColor = getTeamColor(away.team.abbreviation) || "#3b82f6";
  const homeSecondary = getTeamSecondary(home.team.abbreviation) || "#1a1a2e";
  const awaySecondary = getTeamSecondary(away.team.abbreviation) || "#1a1a2e";
  const homeLogoUrl = getTeamLogoUrl(home.team) ?? undefined;
  const awayLogoUrl = getTeamLogoUrl(away.team) ?? undefined;

  // Build the canonical shot list. Filter for actual shooting plays.
  // Free throws are included even when ESPN omits a coordinate — they
  // always come from the FT line at court center, so we synthesize a
  // default coord (x=25, y=15) so they render in 2D and 3D alike.
  const allShots: Shot[] = useMemo(() => {
    const isFreeThrow = (p: ProcessedPlay) =>
      /free throw/i.test(p.text ?? "");
    return plays
      .filter(
        (p) =>
          p.shootingPlay === true &&
          (isValidCoord(p.coordinate) || isFreeThrow(p)),
      )
      .map((p) => {
        const ft = isFreeThrow(p);
        // Default FT line: court center x=25, 15 ft from rim toward midcourt
        const c = isValidCoord(p.coordinate)
          ? p.coordinate!
          : ft
            ? { x: 25, y: 15 }
            : { x: 25, y: 0 }; // unreachable due to filter, but keeps TS happy
        const svgX = c.x * 10;
        // ESPN y = distance (ft) from basket toward midcourt; basket sits at SVG cy=BY
        const svgY = BY - c.y * 10;
        // Distance from basket in feet (used for 2pt/3pt classification)
        const dx = c.x - 25;
        const dy = c.y;
        const distFt = Math.sqrt(dx * dx + dy * dy);
        const made = !!p.scoringPlay;
        const isThree =
          distFt > 22.05 || /three|3\s*-?\s*pt|3-point/i.test(p.text ?? "");
        const side = detectSide(
          p,
          home.team.abbreviation,
          away.team.abbreviation,
          home.team.id,
          away.team.id,
          home.team.shortDisplayName ?? home.team.displayName,
          away.team.shortDisplayName ?? away.team.displayName,
          teamMap,
        );
        const playerId =
          p.participants?.[0]?.athlete?.id ??
          p.athletes?.[0]?.athlete?.id ??
          null;
        return {
          play: p,
          svgX,
          svgY,
          side,
          made,
          isThree,
          period: p.period?.number ?? 1,
          distFt,
          playerId,
        };
      });
  }, [plays, home, away, teamMap]);

  // Time scrubber. `null` means "follow the live (veil-respecting) edge"; an
  // explicit number pins the chart to that game-time-seconds value.
  const [scrubSecs, setScrubSecs] = useState<number | null>(null);

  // Live edge = latest game-time among the (already veil-filtered) plays
  // passed in. When new plays roll in, this advances.
  const liveMaxSecs = useMemo(() => {
    if (allShots.length === 0) return 0;
    return Math.max(...allShots.map((s) => s.play.gameTimeSecs ?? 0));
  }, [allShots]);

  // If we were pinned past the live edge (rare — game data shrunk), clamp.
  useEffect(() => {
    if (scrubSecs != null && scrubSecs > liveMaxSecs) queueMicrotask(() => setScrubSecs(null));
  }, [scrubSecs, liveMaxSecs]);

  const effectiveScrub = scrubSecs ?? liveMaxSecs;
  const isLive = scrubSecs === null;

  const scrubLabel = (() => {
    if (liveMaxSecs <= 0) return "—";
    const { periodLabel, clock } = gameTimeSecsToDisplay(effectiveScrub);
    return `${periodLabel} ${clock}`;
  })();

  // Quarter / OT markers along the scrubber. Each marker sits at the start
  // of its period and is clickable to jump there.
  const scrubMarkers = useMemo(() => {
    if (liveMaxSecs <= 0) return [] as { label: string; secs: number; nextSecs: number | null }[];
    const QUARTER = 600;
    const OT = 300;
    const out: { label: string; secs: number; nextSecs: number | null }[] = [];
    for (let q = 1; q <= 4; q++) {
      const start = (q - 1) * QUARTER;
      if (start <= liveMaxSecs) out.push({ label: `Q${q}`, secs: start, nextSecs: null });
    }
    let otIdx = 0;
    let otStart = 4 * QUARTER;
    while (otStart <= liveMaxSecs) {
      otIdx++;
      out.push({ label: otIdx === 1 ? "OT" : `${otIdx}OT`, secs: otStart, nextSecs: null });
      otStart += OT;
    }
    // Wire up nextSecs so we can highlight the active period.
    for (let i = 0; i < out.length - 1; i++) out[i].nextSecs = out[i + 1].secs;
    return out;
  }, [liveMaxSecs]);

  // Apply all filters (team + result + period chip + player + scrubber).
  const visibleShots = useMemo(() => {
    return allShots.filter((s) => {
      if ((s.play.gameTimeSecs ?? 0) > effectiveScrub) return false;
      if (sideFilter !== "all" && s.side !== sideFilter) return false;
      if (resultFilter === "made" && !s.made) return false;
      if (resultFilter === "missed" && s.made) return false;
      if (periodFilter !== "all" && s.period !== periodFilter) return false;
      if (playerFilter !== "all" && s.playerId !== playerFilter) return false;
      return true;
    });
  }, [allShots, effectiveScrub, sideFilter, resultFilter, periodFilter, playerFilter]);

  // Players who actually took a shot, with shot count, sorted by team then
  // most-shots-first within team. Powers the player dropdown.
  const playerOptions = useMemo(() => {
    type Entry = { id: string; name: string; side: "home" | "away" | null; count: number };
    const map = new Map<string, Entry>();
    for (const s of allShots) {
      if (!s.playerId) continue;
      const existing = map.get(s.playerId);
      if (existing) {
        existing.count++;
        if (!existing.side && s.side) existing.side = s.side;
      } else {
        map.set(s.playerId, {
          id: s.playerId,
          name: playerNamesById[s.playerId] ?? `Player ${s.playerId}`,
          side: s.side,
          count: 1,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      // Home team players first, then away, unknown last; within group by name.
      const order = (e: Entry) => (e.side === "home" ? 0 : e.side === "away" ? 1 : 2);
      const o = order(a) - order(b);
      if (o !== 0) return o;
      return a.name.localeCompare(b.name);
    });
  }, [allShots, playerNamesById]);

  // If the active player filter no longer exists in the (rebuilt) options
  // list, drop back to "all". Avoids a frozen empty chart.
  useEffect(() => {
    if (playerFilter === "all") return;
    if (!playerOptions.some((p) => p.id === playerFilter)) queueMicrotask(() => setPlayerFilter("all"));
  }, [playerFilter, playerOptions]);

  // Period chip set is data-driven so we don't show empty quarters
  const periods = useMemo(() => {
    const s = new Set(allShots.map((sh) => sh.period));
    return Array.from(s).sort((a, b) => a - b);
  }, [allShots]);

  if (allShots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-white/25 text-sm gap-2">
        <span className="text-3xl">🏀</span>
        <span>No shot coordinate data available for this game yet.</span>
        <span className="text-[11px] text-white/20">
          ESPN posts coordinates a few minutes after each shot — check back during a live game.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Time scrubber — drag to replay shots up to a moment in game time.
          2D mode only; 3D mode is its own real-time view (the in-world
          jumbotron shows the live clock + period). */}
      {viewMode === "2d" && liveMaxSecs > 0 && (
        <div
          className="px-3 py-2 rounded-xl border"
          style={{
            background: "rgba(255,255,255,0.025)",
            borderColor: "rgba(255,255,255,0.08)",
          }}>
          <div className="flex items-center gap-3">
            <span className="text-[10px] uppercase tracking-widest text-white/40 font-semibold shrink-0">
              Time
            </span>
            <div className="flex-1 flex flex-col gap-1 min-w-0">
              {/* Quarter markers — clickable to jump */}
              <div className="relative h-3.5 select-none">
                {scrubMarkers.map((m) => {
                  const pct = (m.secs / liveMaxSecs) * 100;
                  const active =
                    !isLive &&
                    effectiveScrub >= m.secs &&
                    (m.nextSecs == null || effectiveScrub < m.nextSecs);
                  return (
                    <button
                      type="button"
                      key={m.label}
                      onClick={() => setScrubSecs(m.secs)}
                      className="absolute top-0 -translate-x-1/2 flex flex-col items-center gap-0.5 cursor-pointer group"
                      style={{ left: `${pct}%` }}
                      aria-label={`Jump to start of ${m.label}`}
                      title={`Jump to start of ${m.label}`}>
                      <span
                        className="text-[9px] font-bold uppercase tracking-widest leading-none transition-colors"
                        style={{
                          color: active ? "#a855f7" : "rgba(255,255,255,0.4)",
                        }}>
                        {m.label}
                      </span>
                      <span
                        className="block w-px h-1.5 transition-colors"
                        style={{
                          background: active ? "#a855f7" : "rgba(255,255,255,0.25)",
                        }}
                      />
                    </button>
                  );
                })}
                {/* "Live" anchor at the right edge */}
                <div
                  className="absolute top-0 -translate-x-1/2 flex flex-col items-center gap-0.5"
                  style={{ left: "100%" }}
                  aria-hidden>
                  <span
                    className="text-[9px] font-bold uppercase tracking-widest leading-none"
                    style={{ color: isLive ? "#22c55e" : "rgba(255,255,255,0.4)" }}>
                    Live
                  </span>
                  <span
                    className="block w-px h-1.5"
                    style={{ background: isLive ? "#22c55e" : "rgba(255,255,255,0.25)" }}
                  />
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={liveMaxSecs}
                step={1}
                value={effectiveScrub}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (v >= liveMaxSecs - 1) setScrubSecs(null);
                  else setScrubSecs(v);
                }}
                aria-label="Scrub through game time"
                className="w-full accent-purple-500 cursor-pointer"
              />
            </div>
            <div className="text-[12px] tabular-nums font-mono text-white/80 min-w-[58px] text-right shrink-0">
              {scrubLabel}
            </div>
            {isLive ? (
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest shrink-0"
                style={{
                  background: "rgba(34,197,94,0.12)",
                  color: "#22c55e",
                  border: "1px solid rgba(34,197,94,0.35)",
                }}>
                <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] pulse-live" />
                Live
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setScrubSecs(null)}
                className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest border border-white/15 text-white/55 hover:text-white/85 hover:border-white/30 transition-colors shrink-0">
                Go Live
              </button>
            )}
          </div>
        </div>
      )}

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        {/* 2D / 3D view toggle — most prominent, leads the row */}
        <FilterGroup
          label="View"
          options={[
            { value: "2d", label: "2D" },
            { value: "3d", label: "3D" },
          ]}
          value={viewMode}
          onChange={(v) => setViewMode(v as "2d" | "3d")}
        />
        {/* History toggle — only meaningful in 3D mode. When on (LIVE),
            the court keeps only the latest shot and shows the shooter
            figure. The LIVE label pulses while the game is in progress
            so the user can see at a glance that data is flowing. */}
        {viewMode === "3d" && (
          <FilterGroup
            label="History"
            options={[
              { value: "show", label: "Show" },
              {
                value: "hide",
                label: "LIVE",
                pulseWhenActive: isGameLive,
                // Game must be in progress for LIVE mode to make sense
                disabled: !isGameLive,
              },
            ]}
            value={hideHistory ? "hide" : "show"}
            onChange={(v) => setHideHistory(v === "hide")}
          />
        )}
        {/* Filter chips below — only shown in 2D mode, or in 3D when
            history is being shown. In 3D LIVE mode the court is locked
            to the most recent shot, so per-team/result/period/player
            filtering would be meaningless. */}
        {!(viewMode === "3d" && hideHistory) && (
          <>
            <FilterGroup
              label="Team"
              options={[
                { value: "all", label: "Both" },
                { value: "home", label: home.team.shortDisplayName ?? "Home", color: homeColor },
                { value: "away", label: away.team.shortDisplayName ?? "Away", color: awayColor },
              ]}
              value={sideFilter}
              onChange={(v) => setSideFilter(v as SideFilter)}
            />
            <FilterGroup
              label="Result"
              options={[
                { value: "all", label: "All" },
                { value: "made", label: "Made" },
                { value: "missed", label: "Missed" },
              ]}
              value={resultFilter}
              onChange={(v) => setResultFilter(v as ResultFilter)}
            />
            {periods.length > 1 && (
              <FilterGroup
                label="Period"
                options={[
                  { value: "all", label: "All" },
                  ...periods.map((p) => ({
                    value: String(p),
                    label: p > 4 ? `OT${p - 4}` : `Q${p}`,
                  })),
                ]}
                value={periodFilter === "all" ? "all" : String(periodFilter)}
                onChange={(v) => setPeriodFilter(v === "all" ? "all" : parseInt(v, 10))}
              />
            )}

            {playerOptions.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-widest text-white/30 font-semibold">
                  Player
                </span>
                <DarkSelect
                  ariaLabel="Filter by player"
                  value={playerFilter}
                  onValueChange={setPlayerFilter}
                  triggerClassName="text-[11px] font-semibold rounded-lg border border-white/[0.07] bg-white/[0.02] text-white/85 px-2 py-1 max-w-[200px] hover:border-white/20 transition-colors cursor-pointer focus:outline-none focus:border-white/30"
                  groups={(() => {
                    const homeName = home.team.shortDisplayName ?? "Home";
                    const awayName = away.team.shortDisplayName ?? "Away";
                    const homeOpts = playerOptions
                      .filter((p) => p.side === "home")
                      .map((p) => ({ value: p.id, label: `${p.name} (${p.count})` }));
                    const awayOpts = playerOptions
                      .filter((p) => p.side === "away")
                      .map((p) => ({ value: p.id, label: `${p.name} (${p.count})` }));
                    const otherOpts = playerOptions
                      .filter((p) => !p.side)
                      .map((p) => ({ value: p.id, label: `${p.name} (${p.count})` }));
                    const out: DarkSelectGroup[] = [
                      {
                        label: "All",
                        options: [{ value: "all", label: "Everyone" }],
                      },
                    ];
                    if (homeOpts.length) out.push({ label: homeName, options: homeOpts });
                    if (awayOpts.length) out.push({ label: awayName, options: awayOpts });
                    if (otherOpts.length) out.push({ label: "Other", options: otherOpts });
                    return out;
                  })()}
                />
              </div>
            )}

            <span className="text-[11px] text-white/30 ml-auto">
              {visibleShots.length} of {allShots.length} shots
            </span>
          </>
        )}
      </div>

      {/* Court visualization — 2D SVG by default, 3D Canvas when toggled.
          Both consume the same `visibleShots` array so filters/scrubber
          apply consistently. */}
      {viewMode === "3d" && (
        <ShotChart3D
          shots={visibleShots.map<Shot3DInput>((s) => ({
            id: s.play.id,
            // SVG → world coord (1 unit = 1 foot). See ShotChart3D for the
            // full mapping; basket center sits at (0, 10, 4.5).
            worldX: s.svgX / 10 - 25,
            worldZ: 4.5 + (BY - s.svgY) / 10,
            made: s.made,
            isThree: s.isThree,
            side: s.side,
            period: s.period,
            text: s.play.text ?? "",
            playerId: s.playerId,
            gameTimeSecs: s.play.gameTimeSecs ?? 0,
            play: s.play,
          }))}
          homeColor={homeColor}
          awayColor={awayColor}
          homeSecondary={homeSecondary}
          awaySecondary={awaySecondary}
          homeName={home.team.shortDisplayName ?? home.team.displayName}
          awayName={away.team.shortDisplayName ?? away.team.displayName}
          homeLogoUrl={homeLogoUrl}
          awayLogoUrl={awayLogoUrl}
          playerNamesById={playerNamesById}
          playerJerseysById={playerJerseysById}
          playerHeadshotsById={playerHeadshotsById}
          playerHeightsById={playerHeightsById}
          hideHistory={hideHistory}
          homeScore={homeScore}
          awayScore={awayScore}
          liveClock={liveClock}
          livePeriod={livePeriod}
          gameStateText={gameStateText}
          homeTimeoutsLeft={homeTimeoutsLeft}
          awayTimeoutsLeft={awayTimeoutsLeft}
          maxTimeouts={maxTimeouts}
          isGameLive={isGameLive}
          gameState={gameState}
        />
      )}

      {viewMode === "2d" && (
      <div className="relative" onMouseLeave={() => setTooltip(null)}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full rounded-xl"
          style={{ maxHeight: 640, userSelect: "none", aspectRatio: `${W} / ${H}` }}>
          <HalfCourt />

          <AnimatePresence>
            {visibleShots.map((s, i) => {
              const color =
                s.side === "home" ? homeColor : s.side === "away" ? awayColor : "rgba(255,255,255,0.5)";
              const r = s.isThree ? 7 : 5.5;
              return (
                <motion.g
                  key={`${s.play.id}-${i}`}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ delay: Math.min(i * 0.005, 0.4), duration: 0.18 }}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() =>
                    setTooltip({
                      svgX: s.svgX,
                      svgY: s.svgY,
                      text: s.play.text ?? "",
                      color,
                      playerId: s.playerId,
                    })
                  }>
                  {s.made ? (
                    <>
                      {/* Made shot: solid filled circle in team color with halo */}
                      <circle cx={s.svgX} cy={s.svgY} r={r + 4} fill={hexWithOpacity(color, 0.22)} />
                      <circle cx={s.svgX} cy={s.svgY} r={r} fill={color}
                        stroke="#0c0c1c" strokeWidth={1.25} />
                    </>
                  ) : (
                    <>
                      {/* Missed shot: X mark in the same team color (classic
                          basketball shot-chart convention). A faint dark
                          backing keeps the X readable against any court area. */}
                      <line x1={s.svgX - r} y1={s.svgY - r} x2={s.svgX + r} y2={s.svgY + r}
                        stroke="rgba(0,0,0,0.55)" strokeWidth={4} strokeLinecap="round" />
                      <line x1={s.svgX + r} y1={s.svgY - r} x2={s.svgX - r} y2={s.svgY + r}
                        stroke="rgba(0,0,0,0.55)" strokeWidth={4} strokeLinecap="round" />
                      <line x1={s.svgX - r} y1={s.svgY - r} x2={s.svgX + r} y2={s.svgY + r}
                        stroke={color} strokeWidth={2.25} strokeLinecap="round" />
                      <line x1={s.svgX + r} y1={s.svgY - r} x2={s.svgX - r} y2={s.svgY + r}
                        stroke={color} strokeWidth={2.25} strokeLinecap="round" />
                    </>
                  )}
                </motion.g>
              );
            })}
          </AnimatePresence>
        </svg>

        {/* Tooltip pinned to bottom of court — leads with the shooter's
            jersey + name (when known), then the full play description. */}
        <AnimatePresence>
          {tooltip && (() => {
            const jersey = tooltip.playerId
              ? playerJerseysById[tooltip.playerId]
              : undefined;
            const name = tooltip.playerId
              ? playerNamesById[tooltip.playerId]
              : undefined;
            return (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="absolute bottom-2 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg text-[11px] text-white/85 max-w-[320px] text-center pointer-events-none z-10 shadow-lg"
                style={{
                  background: "rgba(15,15,26,0.96)",
                  border: `1px solid ${hexWithOpacity(tooltip.color, 0.45)}`,
                }}>
                {name && (
                  <div className="flex items-center justify-center gap-1.5 mb-0.5">
                    {jersey && (
                      <span
                        className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1 rounded text-[10px] font-bold tabular-nums"
                        style={{
                          background: hexWithOpacity(tooltip.color, 0.18),
                          color: tooltip.color,
                          border: `1px solid ${hexWithOpacity(tooltip.color, 0.5)}`,
                        }}>
                        #{jersey}
                      </span>
                    )}
                    <span className="font-bold" style={{ color: tooltip.color }}>
                      {name}
                    </span>
                  </div>
                )}
                <div>{tooltip.text}</div>
              </motion.div>
            );
          })()}
        </AnimatePresence>
      </div>
      )}

      {/* Legend — 2D only; the 3D view shows team-colored arcs+balls and an
          in-canvas hint for orbit controls. */}
      {viewMode === "2d" && (
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-[11px] text-white/45 mt-1">
        <div className="flex items-center gap-3">
          <LegendMarker color={homeColor} kind="made" />
          <LegendMarker color={homeColor} kind="missed" />
          <span>{home.team.shortDisplayName ?? "Home"}</span>
        </div>
        <div className="flex items-center gap-3">
          <LegendMarker color={awayColor} kind="made" />
          <LegendMarker color={awayColor} kind="missed" />
          <span>{away.team.shortDisplayName ?? "Away"}</span>
        </div>
        <div className="flex items-center gap-2 ml-2">
          <LegendMarker color="rgba(255,255,255,0.55)" kind="made" />
          <span>Made</span>
        </div>
        <div className="flex items-center gap-2">
          <LegendMarker color="rgba(255,255,255,0.55)" kind="missed" />
          <span>Missed</span>
        </div>
      </div>
      )}
    </div>
  );
}

function FilterGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string; color?: string; pulseWhenActive?: boolean; disabled?: boolean }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-widest text-white/30 font-semibold">{label}</span>
      <div className="flex items-center gap-1 p-0.5 rounded-lg border border-white/[0.07] bg-white/[0.02]">
        {options.map((o) => {
          const active = o.value === value;
          const pulsing = active && o.pulseWhenActive;
          return (
            <button
              key={o.value}
              type="button"
              disabled={o.disabled}
              onClick={() => {
                if (o.disabled) return;
                onChange(o.value);
              }}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors flex items-center gap-1.5",
                active ? "text-white" : "text-white/45 hover:text-white/70",
                o.disabled && "opacity-30 cursor-not-allowed",
              )}
              style={{
                background:
                  active && !o.disabled
                    ? o.color
                      ? hexWithOpacity(o.color, 0.2)
                      : "rgba(255,255,255,0.08)"
                    : "transparent",
                color: active && o.color && !o.disabled ? o.color : undefined,
              }}>
              {pulsing && (
                <span
                  className="w-1.5 h-1.5 rounded-full pulse-live shrink-0"
                  style={{ background: "#22c55e" }}
                  aria-hidden
                />
              )}
              <span className={pulsing ? "animate-pulse" : undefined}>{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LegendMarker({ color, kind }: { color: string; kind: "made" | "missed" }) {
  if (kind === "made") {
    return (
      <span
        className="inline-block w-3 h-3 rounded-full shrink-0"
        style={{ background: color, boxShadow: `0 0 0 1px rgba(0,0,0,0.4)` }}
      />
    );
  }
  // X mark for misses
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" className="shrink-0">
      <line x1={2} y1={2} x2={10} y2={10} stroke={color} strokeWidth={2} strokeLinecap="round" />
      <line x1={10} y1={2} x2={2} y2={10} stroke={color} strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}
