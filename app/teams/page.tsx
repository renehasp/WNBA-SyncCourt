"use client";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Loader2, Users } from "lucide-react";
import Navbar from "@/components/Navbar";
import PlayerSearch from "@/components/PlayerSearch";
import TeamCard from "@/components/TeamCard";
import { fetchTeams, getTeamLogoUrl } from "@/lib/espn";
import { useAppStore } from "@/store/useAppStore";

export default function TeamsPage() {
  const favoriteTeamId = useAppStore((s) => s.favoriteTeamId);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["teams"],
    queryFn: fetchTeams,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 30 * 60 * 1000, // Auto-refresh every 30 minutes during season
  });

  const allTeams = (data?.sports?.[0]?.leagues?.[0]?.teams ?? [])
    .map((t) => t.team);

  // Calculate rankings based on win-loss record
  const teamsWithRank = allTeams
    .map((team) => {
      const record = team.record?.items?.[0]?.summary ?? "0-0";
      const [wins, losses] = record.split("-").map(Number);
      return { team, wins: wins || 0, losses: losses || 0 };
    })
    .sort((a, b) => {
      const aWinPct = a.wins / (a.wins + a.losses);
      const bWinPct = b.wins / (b.wins + b.losses);
      return bWinPct - aWinPct;
    })
    .map((item, index) => ({ ...item, rank: index + 1 }));

  const teams = teamsWithRank
    .map((item) => item.team)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const teamRankMap = Object.fromEntries(
    teamsWithRank.map((item) => [item.team.id, item.rank])
  );

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8">
        <div className="flex items-start sm:items-center justify-between gap-4 mb-8 flex-col sm:flex-row">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Users size={20} className="text-white/60" />
              <span>
                WNBA{" "}
                <span
                  className="text-transparent bg-clip-text"
                  style={{ backgroundImage: "linear-gradient(135deg, #a855f7, #3b82f6)" }}>
                  Teams
                </span>
              </span>
            </h1>
            <p className="text-sm text-white/30 mt-1">
              {teams.length || ""} {teams.length === 1 ? "team" : "teams"}
              {teams.length ? " · click a team to view its roster" : ""}
            </p>
          </div>
          <PlayerSearch />
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-24 gap-2 text-white/30">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm">Loading teams…</span>
          </div>
        )}

        {isError && (
          <div className="text-center py-12 text-red-400/70 text-sm">
            Failed to load teams. ESPN API may be unavailable.
          </div>
        )}

        {!isLoading && teams.length > 0 && (
          <motion.div
            className="grid grid-cols-4 gap-4"
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.04 } } }}>
            {teams.map((team, idx) => (
              <TeamCard
                key={team.id}
                team={team}
                logoUrl={getTeamLogoUrl(team)}
                isFavorite={team.id === favoriteTeamId}
                isLcpCandidate={idx === 0}
                rank={teamRankMap[team.id]}
              />
            ))}
          </motion.div>
        )}
      </main>
    </div>
  );
}
