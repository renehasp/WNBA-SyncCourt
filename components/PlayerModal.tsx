"use client";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { X, TrendingUp, AlertTriangle } from "lucide-react";
import type { ESPNPlayerStats, ESPNTeam, ESPNAthleteOverview } from "@/lib/espn";
import { getTeamColor } from "@/lib/teams";
import { getAthleteHeadshotById, fetchAthleteOverview } from "@/lib/espn";
import { hexWithOpacity } from "@/lib/utils";
import { getFullCollegeName } from "@/lib/colleges";

interface PlayerModalProps {
  stats: ESPNPlayerStats | null;
  team: ESPNTeam | null;
  labels?: string[];
  onClose: () => void;
}

const STAT_LABELS: Record<string, string> = {
  "MIN": "Minutes",
  "PTS": "Points",
  "REB": "Rebounds",
  "AST": "Assists",
  "STL": "Steals",
  "BLK": "Blocks",
  "TO": "Turnovers",
  "FG": "Field Goals",
  "3PT": "3-Pointers",
  "FT": "Free Throws",
  "PF": "Fouls",
};

function StatBubble({ label, value, color }: { label: string; value: string; color: string }) {
  const numVal = parseFloat(value) || 0;
  const isHigh = (label === "PTS" && numVal >= 20) ||
    (label === "REB" && numVal >= 10) ||
    (label === "AST" && numVal >= 8) ||
    (label === "STL" && numVal >= 3) ||
    (label === "BLK" && numVal >= 3);

  const displayLabel = STAT_LABELS[label] || label;

  return (
    <div className="flex flex-col items-center gap-1 p-3 rounded-xl border"
      style={{
        background: isHigh ? hexWithOpacity(color, 0.1) : "rgba(255,255,255,0.03)",
        borderColor: isHigh ? hexWithOpacity(color, 0.3) : "rgba(255,255,255,0.07)",
      }}>
      <span className="text-2xl font-extrabold tabular-nums leading-none"
        style={{ color: isHigh ? color : "rgba(255,255,255,0.8)" }}>
        {value || "0"}
      </span>
      <span className="text-[10px] text-white/30 uppercase tracking-wide font-semibold">
        {displayLabel}
      </span>
      {isHigh && <TrendingUp size={10} style={{ color }} />}
    </div>
  );
}

const DISPLAY_STATS = ["MIN", "PTS", "REB", "AST", "STL", "BLK", "TO", "FG", "3PT", "FT"];

const WNBA_FOUL_LIMIT = 6;

function FoulIndicator({ fouls, color }: { fouls: number; color: string }) {
  const used = Math.max(0, Math.min(WNBA_FOUL_LIMIT, fouls));
  const remaining = Math.max(0, WNBA_FOUL_LIMIT - used);
  const fouledOut = used >= WNBA_FOUL_LIMIT;
  const dangerColor = used >= 5 ? "#ef4444" : used >= 4 ? "#f59e0b" : color;
  const title = fouledOut
    ? `Fouled out (${used}/${WNBA_FOUL_LIMIT})`
    : `${used} foul${used === 1 ? "" : "s"} · ${remaining} before disqualification`;

  return (
    <div className="flex items-center gap-2 mt-2" title={title}>
      <span className="text-[9px] font-semibold uppercase tracking-widest text-white/35">Fouls</span>
      <div className="flex items-center gap-[3px]">
        {Array.from({ length: WNBA_FOUL_LIMIT }).map((_, i) => {
          const isUsed = i < used;
          return (
            <div
              key={i}
              className="rounded-full"
              style={{
                width: 6,
                height: 6,
                background: isUsed ? hexWithOpacity(dangerColor, 0.9) : "rgba(255,255,255,0.08)",
                border: isUsed
                  ? `1px solid ${hexWithOpacity(dangerColor, 0.5)}`
                  : "1px solid rgba(255,255,255,0.12)",
                boxShadow: isUsed ? `0 0 4px ${hexWithOpacity(dangerColor, 0.45)}` : "none",
              }}
            />
          );
        })}
      </div>
      <span className="text-[10px] tabular-nums font-bold" style={{ color: dangerColor }}>
        {used}/{WNBA_FOUL_LIMIT}
      </span>
      {fouledOut && (
        <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-widest"
          style={{ color: "#ef4444" }}>
          <AlertTriangle size={9} /> Out
        </span>
      )}
    </div>
  );
}

export default function PlayerModal({ stats, team, labels = [], onClose }: PlayerModalProps) {
  const athleteId = stats?.athlete?.id ?? null;

  const { data: athleteOverview } = useQuery({
    queryKey: ["athlete-overview", athleteId],
    queryFn: () => (athleteId ? fetchAthleteOverview(athleteId) : Promise.resolve(null as ESPNAthleteOverview | null)),
    enabled: !!athleteId,
    staleTime: 1000 * 60 * 10, // 10 min
    retry: 1,
  });

  if (!stats || !team) return null;

  const abbr = team.abbreviation;
  const color = getTeamColor(abbr) || `#${team.color || "a855f7"}`;
  const athlete = stats.athlete;
  const headshotUrl = getAthleteHeadshotById(athlete.id);
  const detailedAthlete = athleteOverview?.athlete;

  const pts = (() => {
    const idx = labels.indexOf("PTS");
    return idx >= 0 ? parseInt(stats.stats[idx] ?? "0") || 0 : 0;
  })();

  const fouls = (() => {
    const idx = labels.indexOf("PF");
    return idx >= 0 ? parseInt(stats.stats[idx] ?? "0") || 0 : 0;
  })();

  const hotHand = pts >= 20;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(12px)" }}
        onClick={(e) => e.target === e.currentTarget && onClose()}>
        <motion.div
          initial={{ y: 40, opacity: 0, scale: 0.95 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 40, opacity: 0, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 300, damping: 28 }}
          className="w-full max-w-md rounded-2xl border overflow-hidden"
          style={{ background: "#0f0f1a", borderColor: hexWithOpacity(color, 0.3) }}>
          {/* Color bar */}
          <div className="h-1" style={{ background: `linear-gradient(90deg, ${color}, ${hexWithOpacity(color, 0.3)})` }} />

          {/* Header */}
          <div className="relative p-5"
            style={{ background: `radial-gradient(ellipse 80% 60% at 30% 50%, ${hexWithOpacity(color, 0.1)}, transparent)` }}>
            <div className="absolute top-5 right-4 flex items-center gap-2">
              {team.logo && (
                <div
                  className="w-20 h-20 rounded-full flex items-center justify-center shrink-0"
                  title={team.displayName}
                  style={{
                    background: hexWithOpacity(color, 0.12),
                    border: `1px solid ${hexWithOpacity(color, 0.35)}`,
                    boxShadow: `0 0 12px ${hexWithOpacity(color, 0.15)}`,
                  }}>
                  <Image
                    src={team.logo}
                    alt={team.displayName}
                    width={54}
                    height={54}
                    className="object-contain"
                    style={{ width: 54, height: 54 }}
                    unoptimized
                  />
                </div>
              )}
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-all">
                <X size={15} />
              </button>
            </div>

            <div className="flex items-center gap-4">
              {/* Headshot */}
              <div className="w-20 h-20 rounded-full overflow-hidden shrink-0"
                style={{ border: `2px solid ${hexWithOpacity(color, 0.4)}`, background: hexWithOpacity(color, 0.1), boxShadow: `0 0 24px ${hexWithOpacity(color, 0.2)}` }}>
                <Image
                  src={headshotUrl}
                  alt={athlete.displayName}
                  width={80}
                  height={80}
                  className="object-cover w-full h-full"
                  unoptimized
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>

              {/* Player info */}
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-white leading-tight">{athlete.displayName}</h2>
                  {hotHand && <span title="Hot hand">🔥</span>}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  {athlete.jersey && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded"
                      style={{ background: hexWithOpacity(color, 0.15), color }}>
                      #{athlete.jersey}
                    </span>
                  )}
                  {athlete.position && (
                    <span className="text-xs text-white/40">{athlete.position.displayName ?? athlete.position.abbreviation}</span>
                  )}
                  <span className="text-xs text-white/30">{team.shortDisplayName ?? abbr}</span>
                </div>
                {stats.starter && (
                  <span className="mt-1.5 inline-flex text-[10px] px-2 py-0.5 rounded-full font-semibold"
                    style={{ background: hexWithOpacity(color, 0.12), color }}>
                    Starter
                  </span>
                )}
                {!stats.didNotPlay && labels.indexOf("PF") >= 0 && (
                  <FoulIndicator fouls={fouls} color={color} />
                )}
              </div>
            </div>
          </div>

          {/* Trading Card - Career Stats */}
          {detailedAthlete && (
            <div className="px-5 pt-5" style={{ borderTop: `1px solid ${hexWithOpacity(color, 0.2)}` }}>
              <p className="text-[11px] text-white/30 uppercase tracking-wide mb-3 font-semibold">Career Info</p>
              <div className="grid grid-cols-2 gap-3 pb-5">
                {/* WNBA Experience */}
                {detailedAthlete.experience?.years !== undefined && (
                  <div className="p-2.5 rounded-lg" style={{ background: hexWithOpacity(color, 0.08), border: `1px solid ${hexWithOpacity(color, 0.2)}` }}>
                    <p className="text-[10px] text-white/40 uppercase tracking-wide font-semibold">WNBA Years</p>
                    <p className="text-lg font-bold" style={{ color }}>
                      {detailedAthlete.experience.years}
                    </p>
                  </div>
                )}

                {/* Height */}
                {detailedAthlete.displayHeight && (
                  <div className="p-2.5 rounded-lg" style={{ background: hexWithOpacity(color, 0.08), border: `1px solid ${hexWithOpacity(color, 0.2)}` }}>
                    <p className="text-[10px] text-white/40 uppercase tracking-wide font-semibold">Height</p>
                    <p className="text-lg font-bold text-white">{detailedAthlete.displayHeight}</p>
                  </div>
                )}

                {/* Weight */}
                {detailedAthlete.displayWeight && (
                  <div className="p-2.5 rounded-lg" style={{ background: hexWithOpacity(color, 0.08), border: `1px solid ${hexWithOpacity(color, 0.2)}` }}>
                    <p className="text-[10px] text-white/40 uppercase tracking-wide font-semibold">Weight</p>
                    <p className="text-lg font-bold text-white">{detailedAthlete.displayWeight}</p>
                  </div>
                )}

                {/* Age/DOB */}
                {detailedAthlete.age && (
                  <div className="p-2.5 rounded-lg" style={{ background: hexWithOpacity(color, 0.08), border: `1px solid ${hexWithOpacity(color, 0.2)}` }}>
                    <p className="text-[10px] text-white/40 uppercase tracking-wide font-semibold">Age</p>
                    <p className="text-lg font-bold text-white">{detailedAthlete.age}</p>
                  </div>
                )}

                {/* College */}
                {detailedAthlete.college?.name && (
                  <div className="p-2.5 rounded-lg col-span-2" style={{ background: hexWithOpacity(color, 0.08), border: `1px solid ${hexWithOpacity(color, 0.2)}` }}>
                    <p className="text-[10px] text-white/40 uppercase tracking-wide font-semibold mb-1">College</p>
                    <p className="text-sm font-bold text-white">{getFullCollegeName(detailedAthlete.college.name)}</p>
                  </div>
                )}

                {/* Hometown */}
                {detailedAthlete.birthPlace && (detailedAthlete.birthPlace.city || detailedAthlete.birthPlace.state) && (
                  <div className="p-2.5 rounded-lg col-span-2" style={{ background: hexWithOpacity(color, 0.08), border: `1px solid ${hexWithOpacity(color, 0.2)}` }}>
                    <p className="text-[10px] text-white/40 uppercase tracking-wide font-semibold mb-1">Hometown</p>
                    <p className="text-sm font-bold text-white">
                      {detailedAthlete.birthPlace.city}
                      {detailedAthlete.birthPlace.city && detailedAthlete.birthPlace.state && ", "}
                      {detailedAthlete.birthPlace.state}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Stats grid */}
          <div className="px-5 pb-5">
            <p className="text-[11px] text-white/30 uppercase tracking-wide mb-3 font-semibold">Today&apos;s Stats</p>
            {stats.didNotPlay ? (
              <div className="text-center py-4 text-white/30 text-sm">
                Did Not Play{stats.reason ? ` — ${stats.reason}` : ""}
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {DISPLAY_STATS.map((label) => {
                  const idx = labels.indexOf(label);
                  if (idx < 0) return null;
                  const val = stats.stats[idx] ?? "0";
                  return <StatBubble key={label} label={label} value={val} color={color} />;
                })}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
