import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatClock(clock: string | undefined): string {
  return clock || "0:00";
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

export function hexWithOpacity(hex: string, opacity: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function ordinalPeriod(period: number): string {
  if (period <= 4) {
    const suffixes = ["", "1st", "2nd", "3rd", "4th"];
    return suffixes[period] ?? `${period}th`;
  }
  const otNum = period - 4;
  return otNum === 1 ? "OT" : `${otNum}OT`;
}

export interface DateGroup<T> {
  iso: string;
  display: string;
  events: T[];
}

/**
 * Group events by local calendar date in the given IANA time zone.
 * Returns sorted groups (ascending by iso date).
 */
export function groupEventsByLocalDate<T extends { date: string }>(
  events: T[],
  timeZone: string | null,
  filter: (e: T) => boolean = () => true,
): DateGroup<T>[] {
  const tz = timeZone || undefined;
  const groups = new Map<string, T[]>();
  for (const ev of events) {
    if (!filter(ev)) continue;
    const d = new Date(ev.date);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const y = parts.find((p) => p.type === "year")?.value ?? "";
    const m = parts.find((p) => p.type === "month")?.value ?? "";
    const dd = parts.find((p) => p.type === "day")?.value ?? "";
    const iso = `${y}-${m}-${dd}`;
    if (!groups.has(iso)) groups.set(iso, []);
    groups.get(iso)!.push(ev);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([iso, evs]) => {
      const sample = new Date(evs[0].date);
      const display = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "long",
        month: "short",
        day: "numeric",
      }).format(sample);
      return { iso, display, events: evs };
    });
}
