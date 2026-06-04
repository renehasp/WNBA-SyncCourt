"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, Radio, X, ChevronDown, ChevronUp, Info } from "lucide-react";
import * as Slider from "@radix-ui/react-slider";
import { useSpoilerDelay } from "@/hooks/useSpoilerDelay";
import { ordinalPeriod } from "@/lib/utils";

interface SpoilerVeilControlsProps {
  livePeriod?: number;
  liveClock?: string;
  bufferedCount?: number;
}

const DELAY_PRESETS = [
  { label: "Off", value: 0 },
  { label: "15s", value: 15 },
  { label: "30s", value: 30 },
  { label: "60s", value: 60 },
  { label: "90s", value: 90 },
  { label: "~TV", value: 120 },
];

const PERIODS = [1, 2, 3, 4, 5, 6];

export default function SpoilerVeilControls({
  livePeriod = 1,
  liveClock = "10:00",
  bufferedCount = 0,
}: SpoilerVeilControlsProps) {
  const [expanded, setExpanded] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [tvPeriod, setTvPeriod] = useState(1);
  const [tvMin, setTvMin] = useState("10");
  const [tvSec, setTvSec] = useState("00");
  const [lastSyncDelta, setLastSyncDelta] = useState<number | null>(null);

  const { delaySeconds, syncMode, yourView, setDelay, syncToTV, clearDelay } =
    useSpoilerDelay({ period: livePeriod, clock: liveClock });

  const handleSync = () => {
    const min = Math.min(59, Math.max(0, parseInt(tvMin) || 0));
    const sec = Math.min(59, Math.max(0, parseInt(tvSec) || 0));
    const clock = `${min}:${sec.toString().padStart(2, "0")}`;
    const delta = syncToTV(tvPeriod, clock);
    setLastSyncDelta(delta);
    setSyncOpen(false);
  };

  const statusColor =
    syncMode === "synced" ? "#3b82f6" : syncMode === "delay" ? "#f59e0b" : "#22c55e";
  const statusLabel =
    syncMode === "synced" ? "TV Synced" : syncMode === "delay" ? `${delaySeconds}s Delay` : "Live";

  return (
    <div className="rounded-xl border overflow-hidden"
      style={{ background: "#0f0f1a", borderColor: `${statusColor}28` }}>
      {/* Header row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-2">
          <Shield size={15} style={{ color: statusColor }} />
          <span className="text-sm font-semibold text-white/80">Spoiler Veil</span>
          {bufferedCount > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: `${statusColor}28`, color: statusColor }}>
              {bufferedCount} buffered
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold flex items-center gap-1"
            style={{ color: statusColor }}>
            <span className="w-1.5 h-1.5 rounded-full pulse-live" style={{ background: statusColor }} />
            {statusLabel}
          </span>
          {expanded ? <ChevronUp size={14} className="text-white/30" /> : <ChevronDown size={14} className="text-white/30" />}
        </div>
      </button>

      {/* Expanded panel */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden">
            <div className="px-4 pb-4 flex flex-col gap-4 border-t border-white/[0.05]">
              {/* Dual clock display */}
              {delaySeconds > 0 && yourView && (
                <div className="mt-3 rounded-lg p-3 flex items-center justify-between gap-4 text-xs"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="text-center">
                    <p className="text-white/30 mb-0.5 uppercase tracking-wide text-[10px]">Live</p>
                    <p className="font-bold font-mono text-white/70">
                      {ordinalPeriod(livePeriod)} {liveClock}
                    </p>
                  </div>
                  <div className="flex flex-col items-center">
                    <div className="h-px w-12 bg-white/10" />
                    <span className="text-[10px] text-white/25 mt-0.5">{delaySeconds}s behind</span>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: statusColor }}>Your View</p>
                    <p className="font-bold font-mono" style={{ color: statusColor }}>
                      {yourView.periodLabel} {yourView.clock}
                    </p>
                  </div>
                </div>
              )}

              {/* Presets */}
              <div className="mt-1">
                <p className="text-[11px] text-white/30 uppercase tracking-wide mb-2">Quick Presets</p>
                <div className="flex gap-2 flex-wrap">
                  {DELAY_PRESETS.map((p) => (
                    <button
                      key={p.value}
                      onClick={() => p.value === 0 ? clearDelay() : setDelay(p.value)}
                      className="px-3 py-1 rounded-lg text-xs font-semibold border transition-all"
                      style={
                        delaySeconds === p.value && (p.value > 0 || syncMode === "none")
                          ? { background: `${statusColor}20`, borderColor: `${statusColor}50`, color: statusColor }
                          : { background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)" }
                      }>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Slider */}
              <div>
                <div className="flex justify-between mb-2">
                  <p className="text-[11px] text-white/30 uppercase tracking-wide">Custom Delay</p>
                  <span className="text-[11px] font-mono font-semibold text-white/60">{delaySeconds}s</span>
                </div>
                <Slider.Root
                  value={[delaySeconds]}
                  onValueChange={([v]) => setDelay(v)}
                  min={0}
                  max={300}
                  step={5}
                  className="relative flex items-center select-none touch-none w-full h-5">
                  <Slider.Track className="relative grow rounded-full h-1.5"
                    style={{ background: "rgba(255,255,255,0.1)" }}>
                    <Slider.Range className="absolute rounded-full h-full"
                      style={{ background: statusColor }} />
                  </Slider.Track>
                  <Slider.Thumb
                    className="block w-4 h-4 rounded-full border-2 shadow-lg focus:outline-none"
                    style={{ background: "#0f0f1a", borderColor: statusColor, boxShadow: `0 0 8px ${statusColor}60` }} />
                </Slider.Root>
                <div className="flex justify-between mt-1 text-[10px] text-white/20">
                  <span>0s</span><span>1m</span><span>2m</span><span>3m</span><span>5m</span>
                </div>
              </div>

              {/* Sync + Clear buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => setSyncOpen(true)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-all hover:bg-white/[0.06]"
                  style={{ borderColor: "#3b82f640", color: "#3b82f6", background: "#3b82f610" }}>
                  <Radio size={12} />
                  Sync to TV / Stream
                </button>
                {delaySeconds > 0 && (
                  <button
                    onClick={clearDelay}
                    className="px-3 py-2 rounded-lg text-xs font-semibold border border-white/10 text-white/40 hover:text-white/60 hover:border-white/20 transition-all">
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sync Modal */}
      <AnimatePresence>
        {syncOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
            onClick={(e) => e.target === e.currentTarget && setSyncOpen(false)}>
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              className="w-full max-w-sm rounded-2xl p-6 border"
              style={{ background: "#0f0f1a", borderColor: "#3b82f640" }}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Radio size={16} className="text-[#3b82f6]" />
                  <h3 className="font-bold text-white text-base">Sync to TV / Stream</h3>
                </div>
                <button onClick={() => setSyncOpen(false)} className="text-white/30 hover:text-white/60">
                  <X size={16} />
                </button>
              </div>

              <p className="text-xs text-white/40 mb-5 leading-relaxed flex items-start gap-1.5">
                <Info size={11} className="shrink-0 mt-0.5" />
                Enter the quarter and clock you currently see on your TV or stream. The app will calculate and apply the exact delay.
              </p>

              {/* Live reference */}
              <div className="mb-4 p-3 rounded-lg text-xs flex items-center justify-between"
                style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}>
                <span className="text-white/40">Live right now:</span>
                <span className="font-mono font-bold text-[#22c55e]">
                  {ordinalPeriod(livePeriod)} · {liveClock}
                </span>
              </div>

              {/* Quarter selector */}
              <div className="mb-4">
                <label className="text-[11px] text-white/40 uppercase tracking-wide mb-2 block">
                  Your TV&apos;s Quarter / Period
                </label>
                <div className="flex gap-2">
                  {PERIODS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setTvPeriod(p)}
                      className="flex-1 py-2 rounded-lg text-xs font-bold border transition-all"
                      style={
                        tvPeriod === p
                          ? { background: "#3b82f620", borderColor: "#3b82f650", color: "#3b82f6" }
                          : { background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)" }
                      }>
                      {p <= 4 ? `Q${p}` : p === 5 ? "OT" : `${p - 4}OT`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Clock input */}
              <div className="mb-5">
                <label className="text-[11px] text-white/40 uppercase tracking-wide mb-2 block">
                  Your TV&apos;s Clock (MM : SS)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0} max={10}
                    value={tvMin}
                    onChange={(e) => setTvMin(e.target.value)}
                    className="flex-1 text-center text-xl font-mono font-bold py-2 rounded-lg border bg-transparent outline-none focus:border-[#3b82f6]"
                    style={{ borderColor: "rgba(255,255,255,0.15)", color: "white" }}
                    placeholder="MM"
                  />
                  <span className="text-2xl font-bold text-white/40">:</span>
                  <input
                    type="number"
                    min={0} max={59}
                    value={tvSec}
                    onChange={(e) => setTvSec(e.target.value)}
                    className="flex-1 text-center text-xl font-mono font-bold py-2 rounded-lg border bg-transparent outline-none focus:border-[#3b82f6]"
                    style={{ borderColor: "rgba(255,255,255,0.15)", color: "white" }}
                    placeholder="SS"
                  />
                </div>
              </div>

              {lastSyncDelta !== null && (
                <p className="text-xs text-[#3b82f6] mb-3 text-center">
                  ✓ Synced — your stream is ~{lastSyncDelta}s behind live
                </p>
              )}

              <button
                onClick={handleSync}
                className="w-full py-2.5 rounded-xl font-bold text-sm transition-all hover:opacity-90 active:scale-[0.98]"
                style={{ background: "linear-gradient(135deg, #3b82f6, #6366f1)", color: "white" }}>
                Apply Sync
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
