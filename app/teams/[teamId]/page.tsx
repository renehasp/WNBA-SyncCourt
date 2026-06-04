"use client";
import { use, useEffect, useMemo, useState, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ChevronRight, Loader2, ExternalLink } from "lucide-react";
import Navbar from "@/components/Navbar";
import { fetchTeam, fetchTeamLeaders, getAthleteHeadshotById, getHeadshotUrl, getTeamLogoUrl } from "@/lib/espn";
import { getTeamColor, getTeamSecondary } from "@/lib/teams";
import { hexWithOpacity } from "@/lib/utils";
import { getTeamLinks } from "@/lib/team-links";

export default function TeamPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = use(params);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["team", teamId],
    queryFn: () => fetchTeam(teamId),
    staleTime: 5 * 60 * 1000,
  });

  const leadersQuery = useQuery({
    queryKey: ["team-leaders", teamId],
    queryFn: () => fetchTeamLeaders(teamId),
    staleTime: 30 * 60 * 1000,
  });

  const team = data?.team;
  const abbr = team?.abbreviation ?? "";
  const color = getTeamColor(abbr) || `#${team?.color || "a855f7"}`;
  const secondary = getTeamSecondary(abbr);
  const record = team?.record?.items?.[0]?.summary;
  const logoUrl = getTeamLogoUrl(team);

  const ppgMap = useMemo(() => leadersQuery.data?.ppg ?? {}, [leadersQuery.data?.ppg]);

  // Sort roster: leaders by season PPG first (MVP → down), then everyone else
  // by jersey number / name. Players with no recorded PPG fall to the bottom.
  const athletes = useMemo(() => {
    const rawAthletes = data?.athletes ?? [];
    const ranked = [...rawAthletes].sort((a, b) => {
      const aP = ppgMap[a.id];
      const bP = ppgMap[b.id];
      const aHas = typeof aP === "number";
      const bHas = typeof bP === "number";
      if (aHas && bHas) return bP - aP;
      if (aHas) return -1;
      if (bHas) return 1;
      const aJ = parseInt(a.jersey ?? "999", 10);
      const bJ = parseInt(b.jersey ?? "999", 10);
      if (aJ !== bJ) return aJ - bJ;
      return a.displayName.localeCompare(b.displayName);
    });
    return ranked;
  }, [data?.athletes, ppgMap]);

  // JS-driven column splitting. CSS multi-column was glitching when react-query
  // re-sorted the roster after initial paint (cards landed in the wrong columns
  // until a refresh). This computes a stable column-major distribution that
  // doesn't depend on browser flow rebalancing.
  const [colCount, setColCount] = useState(3);
  useEffect(() => {
    const calc = () => {
      if (window.matchMedia("(min-width: 1024px)").matches) setColCount(3);
      else if (window.matchMedia("(min-width: 640px)").matches) setColCount(2);
      else setColCount(1);
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);
  const rosterColumns = useMemo(() => {
    if (athletes.length === 0) return [];
    const perCol = Math.ceil(athletes.length / colCount);
    return Array.from({ length: colCount }, (_, c) =>
      athletes.slice(c * perCol, (c + 1) * perCol),
    );
  }, [athletes, colCount]);

  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showMenu]);

  const teamLinks = team ? getTeamLinks(team.abbreviation) : null;

  return (
    <div className="relative min-h-screen flex flex-col">
      {/* Page-wide team logo watermark — CSS background so it isn't LCP-tracked */}
      {logoUrl && (
        <div
          aria-hidden
          className="fixed inset-0 pointer-events-none"
          style={{
            zIndex: 0,
            backgroundImage: `url(${logoUrl})`,
            backgroundSize: "min(80vmin, 900px)",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            opacity: 0.05,
            filter: "blur(0.5px)",
          }}
        />
      )}
      <Navbar />
      <main className="relative z-10 flex-1 max-w-6xl mx-auto w-full px-4 py-6 flex flex-col gap-5">
        <Link
          href="/teams"
          className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors w-fit">
          <ArrowLeft size={12} />
          All Teams
        </Link>

        {isLoading && (
          <div className="flex items-center justify-center py-24 gap-2 text-white/30">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm">Loading team…</span>
          </div>
        )}

        {isError && (
          <div className="text-center py-12 text-red-400/70 text-sm">
            Failed to load team. ESPN API may be unavailable.
          </div>
        )}

        {team && (
          <div
            className="relative overflow-hidden rounded-2xl border p-6 sm:p-8"
            style={{
              background: `linear-gradient(135deg, ${hexWithOpacity(color, 0.18)} 0%, ${hexWithOpacity(secondary, 0.08)} 100%), #0f0f1a`,
              borderColor: hexWithOpacity(color, 0.25),
            }}>
            {logoUrl && (
              <div
                aria-hidden
                className="absolute -right-12 -bottom-12 pointer-events-none"
                style={{
                  width: 280,
                  height: 280,
                  backgroundImage: `url(${logoUrl})`,
                  backgroundSize: "contain",
                  backgroundPosition: "center",
                  backgroundRepeat: "no-repeat",
                  opacity: 0.1,
                }}
              />
            )}
            <div className="relative flex items-center gap-5">
              {logoUrl && (
                <Image
                  src={logoUrl}
                  alt={team.displayName}
                  width={88}
                  height={88}
                  className="object-contain shrink-0"
                  style={{ width: 88, height: 88 }}
                  unoptimized
                />
              )}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/45">
                  {team.location ?? ""}
                </p>
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMenu(!showMenu);
                    }}
                    className="text-3xl sm:text-4xl font-extrabold text-white leading-tight hover:opacity-80 transition-opacity cursor-pointer"
                    title="Click for team links">
                    {team.name ?? team.displayName}
                  </button>

                  {/* Team info menu */}
                  <AnimatePresence>
                    {showMenu && teamLinks && (
                      <motion.div
                        ref={menuRef}
                        initial={{ opacity: 0, x: 4 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute top-0 right-full mr-3 z-50 rounded-lg border overflow-hidden whitespace-nowrap"
                        style={{
                          background: "#0f0f1a",
                          borderColor: hexWithOpacity(color, 0.3),
                          boxShadow: `0 4px 12px ${hexWithOpacity(color, 0.2)}`,
                        }}>
                        <a
                          href={teamLinks.wnba}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white hover:bg-white/5 transition-colors"
                          style={{ color }}>
                          WNBA
                          <ExternalLink size={10} />
                        </a>
                        <div className="h-px" style={{ background: hexWithOpacity(color, 0.2) }} />
                        <a
                          href={`https://www.espn.com/wnba/team/_/name/${abbr?.toLowerCase()}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white hover:bg-white/5 transition-colors"
                          style={{ color }}>
                          ESPN
                          <ExternalLink size={10} />
                        </a>
                        <div className="h-px" style={{ background: hexWithOpacity(color, 0.2) }} />
                        <a
                          href={teamLinks.wikipedia}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white hover:bg-white/5 transition-colors"
                          style={{ color }}>
                          Wikipedia
                          <ExternalLink size={10} />
                        </a>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded"
                    style={{ background: hexWithOpacity(color, 0.18), color }}>
                    {abbr}
                  </span>
                  {record && (
                    <span className="text-sm text-white/60 tabular-nums">{record}</span>
                  )}
                  {team.standingSummary && (
                    <span className="text-xs text-white/35">{team.standingSummary}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {!isLoading && athletes.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-white/50 uppercase tracking-widest">Roster</h2>
              <span className="text-xs text-white/30">{athletes.length} players</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {rosterColumns.map((col, c) => (
                <div key={c} className="flex flex-col gap-3">
                  {col.map((a) => {
                const idx = athletes.indexOf(a);
                const headshot =
                  getHeadshotUrl(a.headshot) ?? (a.id ? getAthleteHeadshotById(a.id) : null);
                const positionLabel =
                  a.position?.displayName ?? a.position?.abbreviation ?? "";
                const isInjured = (a.injuries ?? []).some(
                  (i) => (i.status ?? "").toLowerCase() !== "active",
                );
                const ppg = ppgMap[a.id];
                const isRanked = typeof ppg === "number";
                const trophy =
                  isRanked && idx === 0
                    ? { icon: "🏆", label: "Team MVP" }
                    : isRanked && idx === 1
                      ? { icon: "🥈", label: "2nd in scoring" }
                      : isRanked && idx === 2
                        ? { icon: "🥉", label: "3rd in scoring" }
                        : null;
                return (
                  <motion.div
                    key={a.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: Math.min(idx * 0.025, 0.4) }}>
                    <Link
                      href={`/teams/${teamId}/players/${a.id}`}
                      className="group flex items-center gap-3 p-3 rounded-xl border transition-all hover:border-white/20"
                      style={{
                        background: "rgba(255,255,255,0.02)",
                        borderColor: "rgba(255,255,255,0.06)",
                      }}>
                      <div
                        className="relative w-14 h-14 rounded-full overflow-hidden shrink-0 flex items-center justify-center"
                        style={{
                          background: hexWithOpacity(color, 0.1),
                          border: `1px solid ${hexWithOpacity(color, 0.25)}`,
                        }}>
                        {/* Team logo watermark behind the headshot */}
                        {logoUrl && (
                          <div
                            aria-hidden
                            className="absolute inset-0 pointer-events-none"
                            style={{
                              backgroundImage: `url(${logoUrl})`,
                              backgroundSize: "75%",
                              backgroundPosition: "center",
                              backgroundRepeat: "no-repeat",
                              opacity: 0.18,
                            }}
                          />
                        )}
                        {headshot ? (
                          <Image
                            src={headshot}
                            alt={a.displayName}
                            width={56}
                            height={56}
                            className="relative object-cover w-full h-full"
                            unoptimized
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <span className="relative text-sm font-bold" style={{ color }}>
                            {(a.firstName?.[0] ?? "") + (a.lastName?.[0] ?? "")}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {a.jersey && (
                            <span
                              className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded"
                              style={{ background: hexWithOpacity(color, 0.15), color }}>
                              #{a.jersey}
                            </span>
                          )}
                          <p className="font-semibold text-white text-sm leading-tight truncate">
                            {trophy && (
                              <span title={trophy.label} aria-label={trophy.label} className="mr-1">
                                {trophy.icon}
                              </span>
                            )}
                            {a.displayName}
                            {a.experience?.years === 0 && (
                              <span title="Rookie" aria-label="Rookie" className="ml-1">🐣</span>
                            )}
                            {isInjured && (
                              <span title="Injured" aria-label="Injured" className="ml-1">🤕</span>
                            )}
                          </p>
                        </div>
                        <p className="text-xs text-white/40 mt-0.5 truncate">
                          {positionLabel}
                          {a.displayHeight ? ` · ${a.displayHeight}` : ""}
                          {a.experience?.years != null
                            ? ` · ${a.experience.years === 0 ? "Rookie" : `Yr ${a.experience.years}`}`
                            : ""}
                        </p>
                      </div>
                      {typeof ppg === "number" && (
                        <div
                          className="hidden sm:flex flex-col items-center justify-center px-2 py-1 rounded-lg shrink-0"
                          title={`${ppg.toFixed(1)} points per game`}
                          style={{
                            background: hexWithOpacity(color, 0.12),
                            border: `1px solid ${hexWithOpacity(color, 0.25)}`,
                          }}>
                          <span className="text-sm font-extrabold tabular-nums leading-none" style={{ color }}>
                            {ppg.toFixed(1)}
                          </span>
                          <span className="text-[8px] uppercase tracking-widest text-white/40 mt-0.5">
                            PPG
                          </span>
                        </div>
                      )}
                      <ChevronRight
                        size={14}
                        className="text-white/20 group-hover:text-white/60 transition-colors shrink-0"
                      />
                    </Link>
                  </motion.div>
                );
                  })}
                </div>
              ))}
            </div>
          </section>
        )}

        {!isLoading && team && athletes.length === 0 && (
          <div className="text-center py-12 text-white/30 text-sm">
            No roster available for this team.
          </div>
        )}
      </main>
    </div>
  );
}
