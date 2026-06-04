"use client";
import { use, useState, useMemo, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, BarChart2, List, Target, Loader2, X } from "lucide-react";
import Navbar from "@/components/Navbar";
import ScoreboardHero from "@/components/ScoreboardHero";
import PlayByPlayFeed from "@/components/PlayByPlayFeed";
import SpoilerVeilControls from "@/components/SpoilerVeilControls";
import LiveBoxScore from "@/components/LiveBoxScore";
import ShotChart from "@/components/ShotChart";
import PlayerModal from "@/components/PlayerModal";
import { useLiveGames } from "@/hooks/useLiveGames";
import { useGameData } from "@/hooks/useGameData";
import { useAppStore } from "@/store/useAppStore";
import { useQuery } from "@tanstack/react-query";
import type { ESPNPlayerStats, ESPNTeam } from "@/lib/espn";
import { getHeadshotUrl, getAthleteHeadshotById, fetchTeam } from "@/lib/espn";

type Tab = "plays" | "boxscore" | "shotchart";

const TABS: { id: Tab; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "plays", label: "Play-by-Play", Icon: List },
  { id: "boxscore", label: "Box Score", Icon: BarChart2 },
  { id: "shotchart", label: "Shot Chart", Icon: Target },
];

export default function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [activeTab, setActiveTab] = useState<Tab>("plays");
  const [selectedPlayer, setSelectedPlayer] = useState<{ stats: ESPNPlayerStats; team: ESPNTeam } | null>(null);
  const [isHeroVisible, setIsHeroVisible] = useState(true);
  const [showMiniScoreboard, setShowMiniScoreboard] = useState(true);
  const heroRef = useRef<HTMLDivElement>(null);

  const delaySeconds = useAppStore((s) => s.delaySeconds);
  const syncMode = useAppStore((s) => s.syncMode);

  useEffect(() => {
    if (!heroRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsHeroVisible(entry.isIntersecting),
      { threshold: 0.1 }
    );
    observer.observe(heroRef.current);
    return () => observer.disconnect();
  }, []);

  // Get live status from scoreboard to know current period/clock
  const { data: scoreboard } = useLiveGames();
  const liveEvent = scoreboard?.events?.find((e) => e.id === id);
  const liveStatus = liveEvent?.status;
  const livePeriod = liveStatus?.period ?? 1;
  const liveClock = liveStatus?.displayClock ?? "10:00";

  const competition = liveEvent?.competitions?.[0];
  const home = competition?.competitors?.find((c) => c.homeAway === "home");
  const away = competition?.competitors?.find((c) => c.homeAway === "away");

  // Fetch home + away team rosters so we can size the 3D shooter figure
  // to each player's real height. Cached aggressively (rosters change once
  // a season). enabled-gated so we don't fire until we know the team IDs.
  const homeRosterQ = useQuery({
    queryKey: ["team-roster", home?.team.id],
    queryFn: () => fetchTeam(home!.team.id),
    enabled: !!home?.team.id,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
  const awayRosterQ = useQuery({
    queryKey: ["team-roster", away?.team.id],
    queryFn: () => fetchTeam(away!.team.id),
    enabled: !!away?.team.id,
    staleTime: 1000 * 60 * 60,
  });

  // Fetch detailed summary + process through spoiler engine
  const {
    isLoading,
    isError,
    visiblePlays,
    bufferedCount,
    boxscore,
    gameInfo,
  } = useGameData(id, livePeriod, liveClock);

  const broadcasts = competition?.broadcasts?.flatMap((b) => b.names) ?? [];
  const venueName = gameInfo?.venue?.fullName ?? competition?.venue?.fullName;

  // Build a box-score-derived player resolver so play-by-play can both render
  // the correct headshot AND open the same "Today's Stats" modal that the Box
  // Score tab opens. Each entry carries enough to pop the modal:
  // { stats, team, headshot }. Two indexes:
  //   - playerById: O(1) lookup when the play has an athlete ref.
  //   - playerLookup: name-sorted-longest-first list for fuzzy text matching
  //     (so "Aliyah Boston" beats "Boston").
  const { playerById, playerLookup } = useMemo(() => {
    type Entry = { stats: ESPNPlayerStats; team: ESPNTeam; headshot: string };
    const byId: Record<string, Entry> = {};
    const lookup: Array<Entry & { name: string }> = [];
    boxscore?.players?.forEach((teamStats) => {
      teamStats.statistics?.[0]?.athletes?.forEach((ps) => {
        const id = ps.athlete.id;
        if (!id) return;
        const headshot = getHeadshotUrl(ps.athlete.headshot) ?? getAthleteHeadshotById(id);
        const entry: Entry = { stats: ps, team: teamStats.team, headshot };
        byId[id] = entry;
        if (ps.athlete.displayName) {
          lookup.push({ name: ps.athlete.displayName, ...entry });
        }
      });
    });
    lookup.sort((a, b) => b.name.length - a.name.length);
    return { playerById: byId, playerLookup: lookup };
  }, [boxscore]);

  // Plain id → display-name map for the shot-chart player filter.
  const playerNamesById = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [id, entry] of Object.entries(playerById)) {
      const name = entry.stats.athlete.displayName;
      if (name) out[id] = name;
    }
    return out;
  }, [playerById]);

  // id → jersey number, for the 3D shot-chart hover tooltip. Some athletes
  // are missing a jersey field on ESPN; those just render without a number.
  const playerJerseysById = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [id, entry] of Object.entries(playerById)) {
      const j = entry.stats.athlete.jersey;
      if (j) out[id] = j;
    }
    return out;
  }, [playerById]);

  // id → headshot URL, used by the 3D shooter figure to sample a skin tone
  // for that specific player from their face pixels. Reuses the same URLs
  // the rest of the app shows.
  const playerHeadshotsById = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [id, entry] of Object.entries(playerById)) {
      if (entry.headshot) out[id] = entry.headshot;
    }
    return out;
  }, [playerById]);

  // id → height in inches, sourced from team rosters. Used by the 3D
  // shooter figure to scale realistically against a 10 ft rim. Players
  // missing height fall back to 6'2" (74 in) downstream.
  const playerHeightsById = useMemo(() => {
    const out: Record<string, number> = {};
    for (const roster of [homeRosterQ.data, awayRosterQ.data]) {
      for (const a of roster?.athletes ?? []) {
        if (a.id && typeof a.height === "number" && a.height > 0) {
          out[a.id] = a.height;
        }
      }
    }
    return out;
  }, [homeRosterQ.data, awayRosterQ.data]);

  // Build athlete ID → "home"|"away" map from boxscore (play refs often lack team data)
  const homeTeamId = home?.team?.id;
  // Built every render (tiny loop); avoids react-compiler memo-preservation error on object deps.
  const teamMap: Record<string, "home" | "away"> = {};
  boxscore?.players?.forEach((teamStats) => {
    const side: "home" | "away" = teamStats.team.id === homeTeamId ? "home" : "away";
    teamStats.statistics?.[0]?.athletes?.forEach((ps) => {
      if (ps.athlete.id) teamMap[ps.athlete.id] = side;
    });
  });

  // Count charged timeouts per team from play-by-play
  // Excludes TV/Official/mandatory timeouts which don't count against teams
  function countTimeouts(teamId: string | undefined, teamName: string | undefined) {
    if (!teamId && !teamName) return 0;
    return visiblePlays.filter((p) => {
      const t = (p.text ?? "").toLowerCase();
      if (!t.includes("timeout")) return false;
      if (t.includes("tv timeout") || t.includes("official timeout") || t.includes("end of")) return false;
      const athleteTeamId = p.athletes?.[0]?.athlete?.team?.id;
      if (athleteTeamId) return athleteTeamId === teamId;
      return teamName ? (p.text ?? "").includes(teamName) : false;
    }).length;
  }
  const homeTimeoutsUsed = countTimeouts(home?.team?.id, home?.team?.shortDisplayName);
  const awayTimeoutsUsed = countTimeouts(away?.team?.id, away?.team?.shortDisplayName);

  // Delayed view: latest visible play represents the score/clock the user
  // should see when the spoiler veil is active. Falls back to live values
  // when nothing is visible yet (pre-game) or sync is off.
  const delayedView = useMemo(() => {
    if (syncMode === "none" || visiblePlays.length === 0) return null;
    const last = visiblePlays.reduce((a, b) =>
      b.gameTimeSecs > a.gameTimeSecs ? b : a,
    );
    return {
      awayScore: last.awayScore ?? "0",
      homeScore: last.homeScore ?? "0",
      clock: last.clock?.displayValue ?? liveClock,
      period: last.period?.number ?? livePeriod,
    };
  }, [syncMode, visiblePlays, liveClock, livePeriod]);

  // Stoppage detection: infer WHY the clock is currently stopped from the
  // most recent play's text, then layer ESPN's status (halftime / final /
  // end-of-period) on top so structural state always wins over a stale
  // in-game stoppage. Returns a short caption suitable for the 3D
  // scoreboard's status line.
  const gameStateLabel = useMemo<string | undefined>(() => {
    const status = liveStatus?.type?.shortDetail ?? liveStatus?.type?.detail;
    // Halftime / Final / End-of-period from ESPN's own status takes
    // priority — these reflect structural game state, not a stale play.
    if (status && /halftime|final|end of/i.test(status)) return status;
    if (visiblePlays.length === 0) return status ?? undefined;

    const latest = visiblePlays.reduce((a, b) =>
      b.gameTimeSecs > a.gameTimeSecs ? b : a,
    );
    const t = (latest.text ?? "").toLowerCase();

    // In-game stoppage classification — order matters (most specific first).
    if (/official timeout|tv timeout|media timeout/.test(t)) return "TV Timeout";
    if (/team timeout/.test(t)) return "Team Timeout";
    if (/reset timeout/.test(t)) return "Reset Timeout";
    if (/full timeout|short timeout|20[\s-]?second timeout/.test(t)) return "Team Timeout";
    if (/timeout/.test(t)) return "Timeout";
    if (/technical foul/.test(t)) return "Technical Foul";
    if (/flagrant foul/.test(t)) return "Flagrant Foul";
    if (/shooting foul/.test(t)) return "Shooting Foul";
    if (/loose ball foul/.test(t)) return "Loose Ball Foul";
    if (/offensive foul|charging foul/.test(t)) return "Offensive Foul";
    if (/personal foul|defensive foul/.test(t)) return "Personal Foul";
    if (/foul/.test(t)) return "Foul";
    if (/replay|review/.test(t)) return "Replay Review";
    if (/injury/.test(t)) return "Injury Stoppage";
    if (/jump ball/.test(t)) return "Jump Ball";
    if (/out of bounds/.test(t)) return undefined; // common, not really a stoppage worth labeling

    return status ?? undefined;
  }, [liveStatus, visiblePlays]);

  if (!liveEvent && !isLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center flex-col gap-4 text-white/30">
          <span className="text-5xl">🏀</span>
          <p className="text-lg font-semibold">Game not found</p>
          <Link href="/" className="text-sm text-purple-400 hover:text-purple-300 underline">
            ← Back to Dashboard
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 flex flex-col gap-5">
        {/* Back link */}
        <Link
          href="/"
          className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors w-fit">
          <ArrowLeft size={12} />
          All Games
        </Link>

        {/* Scoreboard Hero */}
        <div ref={heroRef}>
          {home && away && liveStatus ? (
            <ScoreboardHero
              home={home}
              away={away}
              status={liveStatus}
              venueName={venueName}
              broadcasts={broadcasts}
              homeTimeoutsUsed={homeTimeoutsUsed}
              awayTimeoutsUsed={awayTimeoutsUsed}
              syncMode={syncMode}
              delayedAwayScore={delayedView?.awayScore}
              delayedHomeScore={delayedView?.homeScore}
              delayedClock={delayedView?.clock}
              delayedPeriod={delayedView?.period}
            />
          ) : (
            <div className="h-48 rounded-2xl skeleton" />
          )}
        </div>

        {/* Sticky Mini Scoreboard - appears when hero scrolls out of view */}
        {!isHeroVisible && showMiniScoreboard && home && away && liveStatus && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="fixed top-16 left-0 right-0 z-40"
            style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.95), rgba(0,0,0,0.85))" }}>
            <div className="relative px-4 py-3 max-w-7xl mx-auto w-full">
              {/* Hide Button */}
              <button
                onClick={() => setShowMiniScoreboard(false)}
                className="absolute right-4 bottom-1 p-1 hover:bg-white/10 rounded transition-colors"
                title="Hide mini scoreboard"
                aria-label="Hide mini scoreboard">
                <X size={16} className="text-white/40 hover:text-white/70" />
              </button>

              <div className="flex items-center justify-between gap-4">
                {/* Away Team */}
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                    {away.team.logo ? (
                      <Image
                        src={away.team.logo}
                        alt={away.team.abbreviation}
                        width={20}
                        height={20}
                        className="object-contain"
                        unoptimized
                      />
                    ) : (
                      <span className="text-xs font-bold text-white/70">{away.team.abbreviation.slice(0, 2)}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-white/50 truncate">{away.team.shortDisplayName || away.team.displayName}</p>
                    <p className="text-sm font-bold text-white">{delayedView?.awayScore ?? away.score ?? "0"}</p>
                  </div>
                </div>

                {/* Center - Clock & Status */}
                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                  <p className="text-xs font-mono font-bold text-white/80">{delayedView?.clock ?? liveStatus.displayClock}</p>
                  <p className="text-[10px] text-white/40 uppercase">Q{delayedView?.period ?? liveStatus.period}</p>
                </div>

                {/* Home Team */}
                <div className="flex items-center justify-end gap-2 flex-1 min-w-0">
                  <div className="min-w-0">
                    <p className="text-xs text-white/50 truncate text-right">{home.team.shortDisplayName || home.team.displayName}</p>
                    <p className="text-sm font-bold text-white">{delayedView?.homeScore ?? home.score ?? "0"}</p>
                  </div>
                  <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                    {home.team.logo ? (
                      <Image
                        src={home.team.logo}
                        alt={home.team.abbreviation}
                        width={20}
                        height={20}
                        className="object-contain"
                        unoptimized
                      />
                    ) : (
                      <span className="text-xs font-bold text-white/70">{home.team.abbreviation.slice(0, 2)}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          </motion.div>
        )}

        {/* Spoiler Veil Controls */}
        <SpoilerVeilControls
          livePeriod={livePeriod}
          liveClock={liveClock}
          bufferedCount={bufferedCount}
        />

        {/* Tab bar */}
        <div className="flex gap-1 p-1 rounded-xl"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
          {TABS.map(({ id: tabId, label, Icon }) => {
            const isActive = activeTab === tabId;
            return (
              <button
                key={tabId}
                onClick={() => setActiveTab(tabId)}
                className="relative flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors"
                style={{ color: isActive ? "white" : "rgba(255,255,255,0.35)" }}>
                {isActive && (
                  <motion.div
                    layoutId="tab-indicator"
                    className="absolute inset-0 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.08)" }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative flex items-center gap-1.5">
                  <Icon size={13} />
                  <span className="inline">{label}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-16 text-white/25 gap-2">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm">Loading game data…</span>
          </div>
        )}

        {/* Error state */}
        {isError && !isLoading && (
          <div className="text-center py-12 text-red-400/70 text-sm">
            Failed to load game details. ESPN API may be unavailable.
          </div>
        )}

        {/* Tab content */}
        {!isLoading && home && away && (
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}>

              {activeTab === "plays" && (
                <PlayByPlayFeed
                  visiblePlays={visiblePlays}
                  bufferedCount={bufferedCount}
                  home={home}
                  away={away}
                  delaySeconds={delaySeconds}
                  playerById={playerById}
                  playerLookup={playerLookup}
                  onPlayerClick={(stats, team) => setSelectedPlayer({ stats, team })}
                />
              )}

              {activeTab === "boxscore" && boxscore && (
                <LiveBoxScore
                  boxscore={boxscore}
                  onPlayerClick={(stats, team) => setSelectedPlayer({ stats, team })}
                  liveAwayScore={away?.score}
                  liveHomeScore={home?.score}
                  liveClock={liveStatus?.displayClock}
                  livePeriod={liveStatus?.period}
                />
              )}

              {activeTab === "boxscore" && !boxscore && (
                <div className="text-center py-12 text-white/20 text-sm">
                  Box score not available yet.
                </div>
              )}

              {activeTab === "shotchart" && (
                <ShotChart
                  plays={visiblePlays}
                  home={home}
                  away={away}
                  teamMap={teamMap}
                  playerNamesById={playerNamesById}
                  playerJerseysById={playerJerseysById}
                  playerHeadshotsById={playerHeadshotsById}
                  playerHeightsById={playerHeightsById}
                  isGameLive={liveStatus?.type?.state === "in"}
                  gameState={liveStatus?.type?.state}
                  homeScore={delayedView?.homeScore ?? home?.score ?? "0"}
                  awayScore={delayedView?.awayScore ?? away?.score ?? "0"}
                  liveClock={delayedView?.clock ?? liveClock}
                  livePeriod={delayedView?.period ?? livePeriod}
                  gameStateText={gameStateLabel}
                  homeTimeoutsLeft={Math.max(0, 7 - homeTimeoutsUsed)}
                  awayTimeoutsLeft={Math.max(0, 7 - awayTimeoutsUsed)}
                  maxTimeouts={7}
                />
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </main>

      {/* Player Modal */}
      {selectedPlayer && (
        <PlayerModal
          stats={selectedPlayer.stats}
          team={selectedPlayer.team}
          labels={
            boxscore?.players
              ?.find((p) => p.team.id === selectedPlayer.team.id)
              ?.statistics?.[0]?.labels ?? []
          }
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </div>
  );
}
