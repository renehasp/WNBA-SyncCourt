"use client";
import { useState, useMemo, useRef, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Heart, Search, X } from "lucide-react";
import {
  fetchAllPlayers,
  getAthleteHeadshotById,
  type ESPNPlayerSearchEntry,
} from "@/lib/espn";
import { getTeamColor } from "@/lib/teams";
import { hexWithOpacity } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";

const MAX_RESULTS = 10;
const FAV_YELLOW = "#fde68a";

export default function PlayerSearch() {
  const router = useRouter();
  const favoriteTeamId = useAppStore((s) => s.favoriteTeamId);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ["all-players"],
    queryFn: fetchAllPlayers,
    staleTime: 30 * 60 * 1000,
  });

  const matches = useMemo(() => {
    const players = data?.players ?? [];
    const tokens = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    return players
      .filter((p) => {
        const hay = `${p.firstName ?? ""} ${p.lastName ?? ""} ${p.displayName}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      })
      .slice(0, MAX_RESULTS);
  }, [q, data?.players]);

  useEffect(() => {
    queueMicrotask(() => setHighlightIdx(0));
  }, [q]);

  // Close dropdown on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function go(p: ESPNPlayerSearchEntry) {
    router.push(`/teams/${p.teamId}/players/${p.id}`);
    setOpen(false);
    setQ("");
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      const p = matches[highlightIdx];
      if (p) {
        e.preventDefault();
        go(p);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  const showDropdown = open && q.trim().length > 0;

  return (
    <div ref={containerRef} className="relative w-full sm:w-80">
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-white/[0.03] focus-within:border-white/25 transition-colors">
        <Search size={14} className="text-white/40 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder="Search players…"
          className="flex-1 bg-transparent text-sm text-white placeholder:text-white/30 outline-none"
          aria-label="Search players"
          autoComplete="off"
          spellCheck={false}
        />
        {q && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              inputRef.current?.focus();
            }}
            className="text-white/30 hover:text-white/60"
            aria-label="Clear search">
            <X size={13} />
          </button>
        )}
      </div>

      {showDropdown && (
        <div
          className="absolute top-full left-0 right-0 mt-2 rounded-xl border border-white/10 shadow-2xl z-50 overflow-hidden max-h-[60vh] overflow-y-auto"
          style={{ background: "rgba(15,15,26,0.97)", backdropFilter: "blur(12px)" }}>
          {matches.length === 0 ? (
            <div className="p-4 text-center text-sm text-white/30">No players match.</div>
          ) : (
            matches.map((p, i) => {
              const color = getTeamColor(p.teamAbbr);
              const headshot = p.headshot ?? getAthleteHeadshotById(p.id);
              const isHighlight = i === highlightIdx;
              const isFavorite = !!favoriteTeamId && p.teamId === favoriteTeamId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onMouseEnter={() => setHighlightIdx(i)}
                  onClick={() => go(p)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                    isHighlight ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
                  }`}
                  style={
                    isFavorite
                      ? {
                          background: isHighlight
                            ? hexWithOpacity(FAV_YELLOW, 0.16)
                            : hexWithOpacity(FAV_YELLOW, 0.08),
                          borderLeft: `2px solid ${hexWithOpacity(FAV_YELLOW, 0.65)}`,
                          paddingLeft: "calc(0.75rem - 2px)",
                        }
                      : undefined
                  }>
                  <div
                    className="relative w-9 h-9 rounded-full overflow-hidden shrink-0 flex items-center justify-center"
                    style={{
                      background: hexWithOpacity(color, 0.12),
                      border: `1px solid ${hexWithOpacity(color, 0.3)}`,
                    }}>
                    {p.teamLogo && (
                      <Image
                        src={p.teamLogo}
                        alt=""
                        aria-hidden
                        width={36}
                        height={36}
                        className="absolute inset-0 m-auto object-contain pointer-events-none"
                        style={{ width: "70%", height: "70%", opacity: 0.18 }}
                        unoptimized
                      />
                    )}
                    <Image
                      src={headshot}
                      alt={p.displayName}
                      width={36}
                      height={36}
                      className="relative object-cover w-full h-full"
                      unoptimized
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate flex items-center gap-1.5">
                      {isFavorite && (
                        <Heart size={11} fill={FAV_YELLOW} className="text-yellow-200 shrink-0" />
                      )}
                      <span className="truncate">{p.displayName}</span>
                      {p.jersey && (
                        <span className="ml-1.5 text-[10px] tabular-nums text-white/35 shrink-0">
                          #{p.jersey}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-white/40 truncate">
                      {p.position ? `${p.position} · ` : ""}
                      {p.teamShortName}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
