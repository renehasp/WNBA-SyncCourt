"use client";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Line, Text, Billboard } from "@react-three/drei";
import * as THREE from "three";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronUp, ChevronDown, Maximize2, Minimize2 } from "lucide-react";
import { hexWithOpacity } from "@/lib/utils";
import type { ProcessedPlay } from "@/lib/spoiler-engine";

// Skin / hair palette for the procedural player figure. Kept neutral and
// limited; the visual identity comes from the team uniform + jersey number,
// not the figure itself.
const SKIN_COLOR = "#c69c8c";
const HAIR_COLOR = "#3d2914";

// World units: 1 unit = 1 foot.
//
// WNBA half-court geometry (matches the 2D ShotChart but in three dimensions):
//   X axis: -25 → +25 (50 ft court width, x=0 at basket centerline)
//   Y axis: 0 → up    (height; rim at 10 ft)
//   Z axis: 0 → 47    (depth; baseline at 0, midcourt at 47)
//
// ESPN coordinate mapping (same convention used in ShotChart.tsx):
//   c.x ∈ [0, 50] across baseline width → worldX = c.x - 25
//   c.y = feet from basket toward midcourt → worldZ = 4.5 + c.y

const COURT_W = 50;
const COURT_D = 47;
const RIM_X = 0;
const RIM_Y = 10;          // 10 ft regulation rim height
const RIM_Z = 4.5;         // rim center 4.5 ft from baseline
const RIM_R = 0.75;        // 18-inch rim
const BACKBOARD_Y = 10;
const BACKBOARD_Z = 4;     // 4 ft from baseline
const LANE_W = 16;
const LANE_D = 19;         // baseline → free-throw line
const FT_R = 6;
const THREE_R = 22.15;
const RESTRICTED_R = 4;

type Side = "home" | "away" | null;

export interface Shot3DInput {
  id: string;
  worldX: number;
  worldZ: number;
  made: boolean;
  isThree: boolean;
  side: Side;
  period: number;
  text: string;
  playerId: string | null;
  gameTimeSecs: number;
  play: ProcessedPlay;
}

interface ShotChart3DProps {
  shots: Shot3DInput[];
  homeColor: string;
  awayColor: string;
  homeSecondary: string;
  awaySecondary: string;
  homeName: string;
  awayName: string;
  homeLogoUrl?: string;
  awayLogoUrl?: string;
  playerNamesById: Record<string, string>;
  playerJerseysById: Record<string, string>;
  // Optional id → headshot URL. The 3D shooter samples skin tone from the
  // face region of this image so each player gets their own tone.
  playerHeadshotsById?: Record<string, string>;
  // Optional id → height in inches. Used to scale the 3D shooter figure
  // realistically against the 10 ft rim. Defaults to 6'2" (74 in).
  playerHeightsById?: Record<string, number>;
  // When true, only currently-animating shots are rendered. Each new shot
  // also spawns a procedural player figure at the origin who shoots before
  // both fade out. Past shots are hidden.
  hideHistory: boolean;
  // Live game state — drives the always-visible mini scoreboard above
  // the backboard. All optional so the component still renders sensibly
  // before the game data lands.
  homeScore?: string | number;
  awayScore?: string | number;
  liveClock?: string;
  livePeriod?: number;
  gameStateText?: string;
  homeTimeoutsLeft?: number;
  awayTimeoutsLeft?: number;
  maxTimeouts?: number;
  isGameLive?: boolean;
  // ESPN game state: "pre" | "in" | "post". Drives the loading overlay
  // copy so empty-canvas states show useful context (game ended /
  // halftime / pre-game) instead of a generic "Loading…".
  gameState?: string;
}

// Sample an average skin tone from the player's headshot image. Loads the
// image with CORS, draws to a 2D canvas, and averages pixels in the upper-
// center face region after filtering out clearly non-skin pixels (very
// dark / very desaturated / blue-dominant). Falls back to the neutral
// SKIN_COLOR on any failure (CORS read blocked, no headshot, etc.).
//
// The result is cached per-URL via a module-level Map so that flipping
// between Show/Hide History or replaying the same player doesn't re-sample.
const SKIN_TONE_CACHE = new Map<string, string>();

function useSkinToneFromHeadshot(url: string | undefined): string {
  const [color, setColor] = useState<string>(() =>
    url ? SKIN_TONE_CACHE.get(url) ?? SKIN_COLOR : SKIN_COLOR,
  );

  useEffect(() => {
    if (!url) {
      queueMicrotask(() => setColor(SKIN_COLOR));
      return;
    }
    const cached = SKIN_TONE_CACHE.get(url);
    if (cached) {
      queueMicrotask(() => setColor(cached));
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      try {
        const W = img.naturalWidth;
        const H = img.naturalHeight;
        if (W < 16 || H < 16) return;

        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);

        // ESPN headshots frame the head in the upper third. Sample a
        // square region centered around (50% W, 32% H) sized ~36% of
        // the smaller dimension — this lands on cheeks/forehead/neck.
        const cx = Math.floor(W * 0.5);
        const cy = Math.floor(H * 0.32);
        const r = Math.floor(Math.min(W, H) * 0.18);
        const x0 = Math.max(0, cx - r);
        const y0 = Math.max(0, cy - r);
        const w = Math.min(W - x0, r * 2);
        const h = Math.min(H - y0, r * 2);
        const data = ctx.getImageData(x0, y0, w, h).data;

        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let count = 0;

        for (let i = 0; i < data.length; i += 4) {
          const R = data[i];
          const G = data[i + 1];
          const B = data[i + 2];
          const A = data[i + 3];
          if (A < 200) continue;
          // Skin filter: red-dominant, not too dark, not pure background
          if (R < 35 || R > 248) continue;
          if (R <= B) continue;
          if (R - G > 90) continue; // exclude very saturated reds (jersey)
          if (G - B < -10) continue; // exclude blue-dominant pixels
          const max = Math.max(R, G, B);
          const min = Math.min(R, G, B);
          if (max - min < 8) continue; // exclude near-grayscale (background)
          if (max - min > 110) continue; // exclude very saturated colors
          sumR += R;
          sumG += G;
          sumB += B;
          count++;
        }

        // Need a confident sample size — otherwise the headshot crop was
        // off (sunglasses, atypical framing) and we should keep the fallback.
        if (count < 60) return;

        const r2 = Math.round(sumR / count);
        const g2 = Math.round(sumG / count);
        const b2 = Math.round(sumB / count);
        const hex =
          "#" +
          [r2, g2, b2]
            .map((v) => v.toString(16).padStart(2, "0"))
            .join("");
        SKIN_TONE_CACHE.set(url, hex);
        if (!cancelled) setColor(hex);
      } catch {
        // CORS read blocked or other canvas error — keep fallback.
      }
    };
    img.onerror = () => {
      // Headshot 404 / network error — fallback color is already set.
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);

  return color;
}

// Async image-texture loader that does NOT suspend (so it slots into
// existing render trees without a Suspense boundary). Returns null on load
// failure (CORS / 404) — caller falls back gracefully.
function useImageTexture(url: string | undefined): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!url) {
      queueMicrotask(() => setTex(null));
      return;
    }
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader
      .loadAsync(url)
      .then((t) => {
        if (cancelled) return;
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        setTex(t);
      })
      .catch(() => {
        // Logo load failure is non-fatal — figure still renders without logo.
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return tex;
}

// ── Ballistic curves ──────────────────────────────────────────────────────

function shotOriginVec(s: Shot3DInput): THREE.Vector3 {
  // Release height ~7 ft (typical for jump shots). Layups release lower
  // because shooter is closer/below; gives a nicer arc shape for short shots.
  const dx = s.worldX - RIM_X;
  const dz = s.worldZ - RIM_Z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const release = dist < 6 ? 6.5 : 7;
  return new THREE.Vector3(s.worldX, release, s.worldZ);
}

function buildMakeArc(s: Shot3DInput): THREE.QuadraticBezierCurve3 {
  const start = shotOriginVec(s);
  const end = new THREE.Vector3(RIM_X, RIM_Y, RIM_Z);
  const dist = start.distanceTo(end);
  // Apex height scales with shot distance — closer shots have lower arcs,
  // long jumpers go higher. Capped so half-court heaves don't shoot off-screen.
  const apexY = Math.max(start.y, end.y) + Math.min(8, Math.max(2.5, dist / 3.2));
  const mid = start.clone().lerp(end, 0.5);
  mid.y = apexY;
  return new THREE.QuadraticBezierCurve3(start, mid, end);
}

function buildMissArc(s: Shot3DInput): {
  approach: THREE.QuadraticBezierCurve3;
  deflect: THREE.QuadraticBezierCurve3;
} {
  // Approach is a normal arc that just barely fails — ends at a "rim contact"
  // point slightly off the actual rim center. Deflect arc bounces away.
  const start = shotOriginVec(s);
  const dist = Math.sqrt(s.worldX * s.worldX + (s.worldZ - RIM_Z) * (s.worldZ - RIM_Z));

  // Deterministic per-shot pseudo-random so the same shot always misses the
  // same way. ESPN play IDs are numeric strings; hash to [0, 1).
  const h = hashId(s.id);
  const angle = h * Math.PI * 2;

  // Rim-contact point: slightly off rim center in the direction of `angle`,
  // at rim height. This is where the approach arc terminates.
  const contact = new THREE.Vector3(
    RIM_X + Math.cos(angle) * RIM_R * 0.8,
    RIM_Y + 0.1,
    RIM_Z + Math.sin(angle) * RIM_R * 0.8,
  );
  const apexY1 = Math.max(start.y, RIM_Y) + Math.min(8, Math.max(2.5, dist / 3.2));
  const mid1 = start.clone().lerp(contact, 0.5);
  mid1.y = apexY1;
  const approach = new THREE.QuadraticBezierCurve3(start, mid1, contact);

  // Deflection: ball bounces off rim, arcs to the floor a few feet away in
  // the direction it came in from (mostly), with some randomness.
  const inboundDir = new THREE.Vector3()
    .subVectors(contact, start)
    .setY(0)
    .normalize();
  const lateral = Math.cos(angle) * 1.5;
  const reverse = -0.6 - h * 0.4; // bounce somewhat back toward shooter
  const land = contact.clone().add(
    inboundDir
      .clone()
      .multiplyScalar(reverse * (3 + h * 3))
      .add(new THREE.Vector3(lateral, 0, lateral * 0.5)),
  );
  land.y = 0.1;
  // Clamp landing inside the half-court so balls don't fly off the world.
  land.x = THREE.MathUtils.clamp(land.x, -COURT_W / 2 + 1, COURT_W / 2 - 1);
  land.z = THREE.MathUtils.clamp(land.z, 0.5, COURT_D - 1);

  const apexY2 = Math.max(2, RIM_Y - 4 - h * 2);
  const mid2 = contact.clone().lerp(land, 0.4);
  mid2.y = apexY2;
  const deflect = new THREE.QuadraticBezierCurve3(contact, mid2, land);

  return { approach, deflect };
}

function hashId(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h = (h ^ id.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 4294967296;
}

function sampleCurve(curve: THREE.Curve<THREE.Vector3>, segments = 32): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) pts.push(curve.getPoint(i / segments));
  return pts;
}

// ── Court geometry ────────────────────────────────────────────────────────

function arcPoints(
  cx: number,
  cz: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  segments = 64,
  y = 0.02,
): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = startAngle + (endAngle - startAngle) * (i / segments);
    out.push(new THREE.Vector3(cx + Math.cos(t) * radius, y, cz + Math.sin(t) * radius));
  }
  return out;
}

interface CourtProps {
  homeColor: string;
  awayColor: string;
  floorLogoTexture?: THREE.Texture | null;
}

function Court({ homeColor, awayColor, floorLogoTexture }: CourtProps) {
  // Lane painted with a subtle blend of the two team colors — keeps team
  // identity in the floor while signalling this is a shared half-court.
  const laneColor = useMemo(() => {
    const a = new THREE.Color(homeColor);
    const b = new THREE.Color(awayColor);
    return a.lerp(b, 0.5);
  }, [homeColor, awayColor]);

  const line = "#e8e8ec";
  const lineFaint = "#5a5a6a";
  const floorColor = "#1f1810"; // warm hardwood-ish, dark to match the app

  // Pre-compute all the line geometries once.
  const courtBorder = useMemo<THREE.Vector3[]>(
    () => [
      new THREE.Vector3(-COURT_W / 2, 0.02, 0),
      new THREE.Vector3(COURT_W / 2, 0.02, 0),
      new THREE.Vector3(COURT_W / 2, 0.02, COURT_D),
      new THREE.Vector3(-COURT_W / 2, 0.02, COURT_D),
      new THREE.Vector3(-COURT_W / 2, 0.02, 0),
    ],
    [],
  );

  const lane = useMemo<THREE.Vector3[]>(
    () => [
      new THREE.Vector3(-LANE_W / 2, 0.025, 0),
      new THREE.Vector3(LANE_W / 2, 0.025, 0),
      new THREE.Vector3(LANE_W / 2, 0.025, LANE_D),
      new THREE.Vector3(-LANE_W / 2, 0.025, LANE_D),
      new THREE.Vector3(-LANE_W / 2, 0.025, 0),
    ],
    [],
  );

  // FT circle rotated another 180° — solid now faces midcourt, dashed
  // faces the baseline (flips the previous orientation).
  const ftCircleSolid = useMemo(
    () => arcPoints(0, LANE_D, FT_R, 0, Math.PI, 48, 0.025),
    [],
  );
  const ftCircleDashed = useMemo(
    () => arcPoints(0, LANE_D, FT_R, Math.PI, 2 * Math.PI, 48, 0.025),
    [],
  );

  // 3-pt arc — sweep around the rim. The straight corner segments down to
  // the baseline are part of the line in real courts; in WNBA the radius is
  // uniform 22.15 ft so the corner intersects the baseline cleanly.
  const threeArc = useMemo(() => {
    // Compute angle range that stays inside the court (-COURT_W/2 ≤ x ≤ COURT_W/2).
    // Going from baseline-corner-left, around the top, to baseline-corner-right.
    // Corner X at z=0: cos θ = -RIM_Z/THREE_R isn't right; we want where the
    // arc hits z=0. Solve RIM_Z + sin θ * THREE_R = 0 → sin θ = -RIM_Z/THREE_R.
    const sinT = -RIM_Z / THREE_R;
    const cornerAngle = Math.asin(sinT); // negative
    // Sweep from π - cornerAngle (left baseline) clockwise across top to
    // cornerAngle (right baseline)
    return arcPoints(
      0,
      RIM_Z,
      THREE_R,
      Math.PI - cornerAngle,
      cornerAngle,
      96,
      0.025,
    );
  }, []);

  const restrictedArc = useMemo(
    () => arcPoints(0, RIM_Z, RESTRICTED_R, 0, Math.PI, 48, 0.025),
    [],
  );

  // Mid-court arc (just the bottom half of a center circle, since we only
  // render the half we live on)
  const centerArc = useMemo(
    () => arcPoints(0, COURT_D, 6, Math.PI, 2 * Math.PI, 48, 0.025),
    [],
  );

  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, COURT_D / 2]} receiveShadow>
        <planeGeometry args={[COURT_W, COURT_D]} />
        <meshStandardMaterial color={floorColor} roughness={0.85} metalness={0.05} />
      </mesh>

      {/* SyncCourt logo on the floor — semi-transparent so it reads as
          a faint watermark rather than overwhelming the wood texture.
          Sits at y=0.005 just above the floor and below the lane paint
          (y=0.012) and white lines (y≥0.025). Z=34 places the logo
          deep in the back-court area, near the midcourt line. */}
      {floorLogoTexture && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.005, 34]}>
          <planeGeometry args={[20, 20]} />
          <meshBasicMaterial
            map={floorLogoTexture}
            transparent
            opacity={0.18}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}

      {/* Painted lane (semi-transparent team-blend tint) */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.012, LANE_D / 2]}
        receiveShadow>
        <planeGeometry args={[LANE_W, LANE_D]} />
        <meshStandardMaterial
          color={laneColor}
          transparent
          opacity={0.28}
          roughness={0.9}
          metalness={0}
        />
      </mesh>

      {/* Lines */}
      <Line points={courtBorder} color={line} lineWidth={2} />
      <Line points={lane} color={line} lineWidth={2} />
      <Line points={ftCircleSolid} color={line} lineWidth={1.5} />
      <Line points={ftCircleDashed} color={lineFaint} lineWidth={1.2} dashed dashSize={0.6} gapSize={0.4} />
      <Line points={threeArc} color={line} lineWidth={2} />
      <Line points={restrictedArc} color={lineFaint} lineWidth={1.2} />
      <Line points={centerArc} color={lineFaint} lineWidth={1.2} />

      {/* Free-throw line */}
      <Line
        points={[
          new THREE.Vector3(-LANE_W / 2, 0.026, LANE_D),
          new THREE.Vector3(LANE_W / 2, 0.026, LANE_D),
        ]}
        color={line}
        lineWidth={2}
      />

      {/* ── Stanchion ──────────────────────────────────────────────────
          Real WNBA setup: the entire support structure sits BEHIND the
          baseline (out of bounds). A wide base on the floor anchors a
          vertical pole, and a horizontal arm reaches forward over the
          baseline to suspend the backboard above the court. The rim
          attaches to the bottom-front of the backboard via a small
          bracket — never directly to the pole. */}
      {(() => {
        const POLE_Z = -3;        // 3 ft behind baseline
        const BASE_Y = 0.18;
        const BASE_W = 5;
        const BASE_H = 0.36;
        const BASE_D = 3;
        const POLE_TOP_Y = 13.2;  // just above backboard top (12.5 ft)
        const ARM_Y = 12.9;
        const ARM_FRONT_Z = BACKBOARD_Z;       // 4
        const ARM_LEN = ARM_FRONT_Z - POLE_Z;  // 7 ft
        const stanchion = "#1f1f25";
        const stanchionMetal = { color: stanchion, metalness: 0.65, roughness: 0.45 };
        return (
          <group>
            {/* Base plate — heavy, planted out of bounds */}
            <mesh position={[0, BASE_Y, POLE_Z]} castShadow receiveShadow>
              <boxGeometry args={[BASE_W, BASE_H, BASE_D]} />
              <meshStandardMaterial {...stanchionMetal} />
            </mesh>
            {/* Lower base trim */}
            <mesh position={[0, BASE_H + 0.05, POLE_Z]}>
              <boxGeometry args={[BASE_W - 0.4, 0.1, BASE_D - 0.4]} />
              <meshStandardMaterial color="#2a2a32" metalness={0.5} roughness={0.5} />
            </mesh>

            {/* Vertical pole — square cross-section, like an actual stanchion */}
            <mesh
              position={[0, BASE_H + (POLE_TOP_Y - BASE_H) / 2, POLE_Z]}
              castShadow>
              <boxGeometry args={[0.6, POLE_TOP_Y - BASE_H, 0.6]} />
              <meshStandardMaterial {...stanchionMetal} />
            </mesh>

            {/* Horizontal arm reaching from pole top forward to backboard */}
            <mesh
              position={[0, ARM_Y, (POLE_Z + ARM_FRONT_Z) / 2]}
              castShadow>
              <boxGeometry args={[0.55, 0.55, ARM_LEN]} />
              <meshStandardMaterial {...stanchionMetal} />
            </mesh>

            {/* Diagonal brace — pole midpoint up to arm midpoint, looks
                structural, casts a nice shadow */}
            {(() => {
              const aY = 8;
              const aZ = POLE_Z + 0.3;
              const bY = ARM_Y - 0.3;
              const bZ = (POLE_Z + ARM_FRONT_Z) / 2;
              const dy = bY - aY;
              const dz = bZ - aZ;
              const len = Math.sqrt(dy * dy + dz * dz);
              const angle = Math.atan2(dz, dy);
              return (
                <mesh
                  position={[0, (aY + bY) / 2, (aZ + bZ) / 2]}
                  rotation={[angle, 0, 0]}
                  castShadow>
                  <cylinderGeometry args={[0.12, 0.12, len, 12]} />
                  <meshStandardMaterial color="#2a2a32" metalness={0.5} roughness={0.5} />
                </mesh>
              );
            })()}

            {/* Padded backboard plate (the foam/protective cover behind
                the glass — sits on the arm side, away from the court) */}
            <mesh
              position={[0, BACKBOARD_Y + 0.75, BACKBOARD_Z - 0.18]}
              castShadow>
              <boxGeometry args={[6.1, 3.6, 0.18]} />
              <meshStandardMaterial color="#0e0e14" roughness={0.85} />
            </mesh>

            {/* Backboard glass — semi-transparent panel */}
            <mesh
              position={[0, BACKBOARD_Y + 0.75, BACKBOARD_Z]}
              castShadow>
              <boxGeometry args={[6, 3.5, 0.1]} />
              <meshPhysicalMaterial
                color="#e8eef5"
                transparent
                opacity={0.55}
                roughness={0.08}
                metalness={0}
                transmission={0.45}
                ior={1.4}
                clearcoat={0.7}
              />
            </mesh>

            {/* Backboard frame — orange/red border around the glass */}
            {(() => {
              const fw = 6.05;
              const fh = 3.55;
              const ft = 0.08; // frame thickness
              const fy = BACKBOARD_Y + 0.75;
              // Frame sits on the court-facing side of the glass (+Z)
              const fz = BACKBOARD_Z + 0.06;
              return (
                <group>
                  {/* top */}
                  <mesh position={[0, fy + fh / 2, fz]}>
                    <boxGeometry args={[fw, ft, 0.06]} />
                    <meshStandardMaterial color="#fc6300" emissive="#fc6300" emissiveIntensity={0.25} />
                  </mesh>
                  {/* bottom */}
                  <mesh position={[0, fy - fh / 2, fz]}>
                    <boxGeometry args={[fw, ft, 0.06]} />
                    <meshStandardMaterial color="#fc6300" emissive="#fc6300" emissiveIntensity={0.25} />
                  </mesh>
                  {/* left */}
                  <mesh position={[-fw / 2, fy, fz]}>
                    <boxGeometry args={[ft, fh, 0.06]} />
                    <meshStandardMaterial color="#fc6300" emissive="#fc6300" emissiveIntensity={0.25} />
                  </mesh>
                  {/* right */}
                  <mesh position={[fw / 2, fy, fz]}>
                    <boxGeometry args={[ft, fh, 0.06]} />
                    <meshStandardMaterial color="#fc6300" emissive="#fc6300" emissiveIntensity={0.25} />
                  </mesh>
                </group>
              );
            })()}

            {/* Painted "shooter's square" — 24" × 18" outline on the
                backboard glass, bottom edge aligned with the rim. Drawn as
                4 thin boxes so it reads as a solid painted line from any
                viewing angle (Line widths in WebGL are inconsistent across
                browsers). */}
            {(() => {
              const sw = 2;       // 24" wide
              const sh = 1.5;     // 18" tall
              const cy = RIM_Y + sh / 2; // bottom aligned with rim height
              // Painted square on the court-facing surface of the glass (+Z),
              // sitting just in front of the frame.
              const sz = BACKBOARD_Z + 0.055;
              const t = 0.045;
              return (
                <group>
                  <mesh position={[0, cy + sh / 2, sz]}>
                    <boxGeometry args={[sw, t, 0.02]} />
                    <meshBasicMaterial color="#fc6300" />
                  </mesh>
                  <mesh position={[0, cy - sh / 2, sz]}>
                    <boxGeometry args={[sw, t, 0.02]} />
                    <meshBasicMaterial color="#fc6300" />
                  </mesh>
                  <mesh position={[-sw / 2, cy, sz]}>
                    <boxGeometry args={[t, sh, 0.02]} />
                    <meshBasicMaterial color="#fc6300" />
                  </mesh>
                  <mesh position={[sw / 2, cy, sz]}>
                    <boxGeometry args={[t, sh, 0.02]} />
                    <meshBasicMaterial color="#fc6300" />
                  </mesh>
                </group>
              );
            })()}

            {/* Rim bracket — small connector mounting the rim to the
                court-facing front of the backboard, between the glass and
                the rim itself. */}
            <mesh
              position={[0, RIM_Y, BACKBOARD_Z + 0.22]}
              castShadow>
              <boxGeometry args={[0.5, 0.18, 0.36]} />
              <meshStandardMaterial color="#1a1a1f" metalness={0.5} roughness={0.5} />
            </mesh>
          </group>
        );
      })()}

      {/* Rim — orange ring oriented horizontally, attached to backboard */}
      <mesh position={[RIM_X, RIM_Y, RIM_Z]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[RIM_R, 0.06, 12, 32]} />
        <meshStandardMaterial color="#fc6300" emissive="#fc6300" emissiveIntensity={0.4} />
      </mesh>

      {/* Net — 12 vertical strands fanning slightly outward and down */}
      {Array.from({ length: 12 }).map((_, i) => {
        const t = (i / 12) * Math.PI * 2;
        const top = new THREE.Vector3(
          RIM_X + Math.cos(t) * RIM_R,
          RIM_Y,
          RIM_Z + Math.sin(t) * RIM_R,
        );
        const bot = new THREE.Vector3(
          RIM_X + Math.cos(t) * RIM_R * 0.55,
          RIM_Y - 1.4,
          RIM_Z + Math.sin(t) * RIM_R * 0.55,
        );
        return (
          <Line
            key={`net-${i}`}
            points={[top, bot]}
            color="#ffffff"
            opacity={0.65}
            transparent
            lineWidth={1}
          />
        );
      })}
    </group>
  );
}

// ── Procedural player figure ──────────────────────────────────────────────
//
// Stylized humanoid built from primitives. Not photoreal — the goal is
// silhouette + team identity (uniform colors + jersey number + logo + name).
// Animation is driven by the parent shot's progress ref so the figure's
// motion stays in sync with the ball flight.

interface PlayerFigureProps {
  position: [number, number, number]; // shot origin in world coords
  primaryColor: string;
  secondaryColor: string;
  jerseyNumber: string;
  playerName: string;
  logoTexture: THREE.Texture | null;
  // URL of the player's ESPN headshot. The figure samples skin tone from
  // the face region of this image; falls back to a neutral default.
  headshotUrl?: string;
  // Player height in inches. Drives the figure's scale so the head sits at
  // a realistic ratio against the 10 ft rim. Falls back to 6'2" (74).
  heightInches?: number;
  // Animation progress: 0..1 over the lifetime of the shot animation.
  // Phases: 0..0.35 wind-up (crouch), 0.35..0.55 release, 0.55..1 follow-through + fade.
  progressRef: React.MutableRefObject<number>;
}

// The base figure (no scale) is built ~3.45 ft tall foot-to-crown. We scale
// the entire group to match the player's real height. 6'2" = 74 in = 6.17 ft
// → scale ≈ 1.79.
const BASE_FIGURE_FT = 3.45;
const DEFAULT_HEIGHT_IN = 74; // 6'2"

function PlayerFigure({
  position,
  primaryColor,
  secondaryColor,
  jerseyNumber,
  playerName,
  logoTexture,
  headshotUrl,
  heightInches,
  progressRef,
}: PlayerFigureProps) {
  // Per-player skin tone sampled from the headshot image. Returns the
  // neutral default (#c69c8c) until the image loads + sampling succeeds.
  const skinColor = useSkinToneFromHeadshot(headshotUrl);

  // Compute uniform scale so the figure ends up at the player's real
  // height. WNBA heights span ~5'8" (Sabrina-ish) to ~6'7" (Brittney
  // Griner), so scale ranges roughly 1.65 to 1.91.
  const scale = useMemo(() => {
    const inches = heightInches && heightInches > 0 ? heightInches : DEFAULT_HEIGHT_IN;
    const heightFt = inches / 12;
    return heightFt / BASE_FIGURE_FT;
  }, [heightInches]);
  const groupRef = useRef<THREE.Group>(null);
  const torsoRef = useRef<THREE.Group>(null);
  const armRef = useRef<THREE.Group>(null);
  const offArmRef = useRef<THREE.Group>(null);

  // Face the rim. atan2 gives the angle to rotate around Y so the figure's
  // forward (-Z in local space, after our setup) points at the basket.
  const yaw = useMemo(() => {
    const dx = 0 - position[0];
    const dz = RIM_Z - position[2];
    return Math.atan2(dx, dz);
  }, [position]);

  useFrame(() => {
    const p = THREE.MathUtils.clamp(progressRef.current, 0, 1);
    if (!groupRef.current) return;

    // Crouch: figure dips down during wind-up, rises sharply at release,
    // then holds upright in follow-through. No fade — the figure stays
    // visible at full opacity until the parent Shot unmounts (which
    // happens when the next live shot replaces it). Crouch depth scales
    // with figure height so it reads consistently across player sizes.
    let crouchY = 0;
    if (p < 0.35) {
      const t = p / 0.35; // 0..1
      crouchY = -0.35 * scale * Math.sin(t * Math.PI); // goes down then back up
    }
    groupRef.current.position.y = position[1] + crouchY;

    // Shooting arm: from "ready" (folded across chest) to "extended high"
    // and held there through follow-through.
    if (armRef.current) {
      // armSwing: 0 = down/folded, 1 = full extension overhead toward rim
      const armSwing =
        p < 0.35
          ? 0.2 * (p / 0.35)              // small lift during wind-up
          : p < 0.55
            ? 0.2 + 0.8 * ((p - 0.35) / 0.2) // explosive extension on release
            : 1;                            // hold follow-through
      // Rotate around the shoulder. Local axis: arm hangs along -Y by default;
      // we rotate around X to swing it forward (toward rim, which is +Z in
      // local space after we faced it). 0 = arm down, π/2 + a bit = past 90°.
      armRef.current.rotation.x = -armSwing * (Math.PI * 0.62);
      // Wrist tilt forward at release for a release-snap feel.
      armRef.current.rotation.z = -armSwing * 0.15;
    }

    // Off (guide) arm: small motion only.
    if (offArmRef.current) {
      const guide =
        p < 0.4 ? 0.3 * (p / 0.4) : p < 0.6 ? 0.3 - 0.3 * ((p - 0.4) / 0.2) : 0;
      offArmRef.current.rotation.x = -guide;
    }
  });

  return (
    <group ref={groupRef} position={position} rotation={[0, yaw, 0]} scale={scale}>
      {/* Legs (shorts, slight color contrast from jersey via secondary color) */}
      <mesh position={[-0.22, 0.85, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.13, 1.7, 12]} />
        <meshStandardMaterial
color={secondaryColor}
          roughness={0.7}
        />
      </mesh>
      <mesh position={[0.22, 0.85, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.13, 1.7, 12]} />
        <meshStandardMaterial
color={secondaryColor}
          roughness={0.7}
        />
      </mesh>
      {/* Sneakers */}
      <mesh position={[-0.22, 0.08, 0.08]} castShadow>
        <boxGeometry args={[0.28, 0.16, 0.55]} />
        <meshStandardMaterial color="#ffffff" roughness={0.5} />
      </mesh>
      <mesh position={[0.22, 0.08, 0.08]} castShadow>
        <boxGeometry args={[0.28, 0.16, 0.55]} />
        <meshStandardMaterial color="#ffffff" roughness={0.5} />
      </mesh>

      {/* Torso (jersey) */}
      <group ref={torsoRef} position={[0, 2.15, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.5, 0.45, 1.3, 16]} />
          <meshStandardMaterial
    color={primaryColor}
            roughness={0.6}
          />
        </mesh>
        {/* Jersey number — front (visible when player faces camera) */}
        <Text
          position={[0, 0.05, 0.51]}
          fontSize={0.42}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.025}
          outlineColor={secondaryColor}>
          {jerseyNumber || ""}
        </Text>
        {/* Jersey number — back */}
        <Text
          position={[0, 0.05, -0.51]}
          rotation={[0, Math.PI, 0]}
          fontSize={0.42}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.025}
          outlineColor={secondaryColor}>
          {jerseyNumber || ""}
        </Text>

        {/* Team logo decal on chest (only when texture loaded successfully) */}
        {logoTexture && (
          <mesh position={[0, -0.42, 0.515]}>
            <planeGeometry args={[0.32, 0.32]} />
            <meshBasicMaterial
        map={logoTexture}
              transparent
              alphaTest={0.05}
            />
          </mesh>
        )}
      </group>

      {/* Neck */}
      <mesh position={[0, 2.85, 0]}>
        <cylinderGeometry args={[0.13, 0.13, 0.18, 10]} />
        <meshStandardMaterial color={skinColor} />
      </mesh>

      {/* Head */}
      <mesh position={[0, 3.15, 0]} castShadow>
        <sphereGeometry args={[0.3, 20, 20]} />
        <meshStandardMaterial color={skinColor} roughness={0.55} />
      </mesh>

      {/* Hair: a slight cap over the crown plus a ponytail behind the head */}
      <mesh position={[0, 3.28, -0.04]} scale={[1.02, 0.85, 1.02]}>
        <sphereGeometry args={[0.31, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={HAIR_COLOR} roughness={0.7} />
      </mesh>
      <mesh position={[0, 3.05, -0.32]} rotation={[0.4, 0, 0]}>
        <capsuleGeometry args={[0.11, 0.45, 8, 12]} />
        <meshStandardMaterial color={HAIR_COLOR} roughness={0.7} />
      </mesh>

      {/* Shooting (right) arm — pivots from the shoulder. Local rest pose
          hangs straight down; useFrame rotates `armRef.rotation.x` toward
          extended-overhead during the release. */}
      <group position={[0.5, 2.65, 0]}>
        <group ref={armRef}>
          {/* Upper arm */}
          <mesh position={[0, -0.45, 0]} castShadow>
            <cylinderGeometry args={[0.1, 0.09, 0.85, 10]} />
            <meshStandardMaterial color={skinColor} />
          </mesh>
          {/* Forearm + hand stub at the end so it reads as an extended arm */}
          <mesh position={[0, -0.95, 0.18]} rotation={[0.45, 0, 0]} castShadow>
            <cylinderGeometry args={[0.09, 0.08, 0.75, 10]} />
            <meshStandardMaterial color={skinColor} />
          </mesh>
          <mesh position={[0, -1.32, 0.34]} castShadow>
            <sphereGeometry args={[0.11, 12, 12]} />
            <meshStandardMaterial color={skinColor} />
          </mesh>
        </group>
      </group>

      {/* Off (left) guide arm — smaller motion, mostly bent at chest height */}
      <group position={[-0.5, 2.65, 0]}>
        <group ref={offArmRef} rotation={[-0.2, 0, 0]}>
          <mesh position={[0, -0.45, 0]} castShadow>
            <cylinderGeometry args={[0.1, 0.09, 0.85, 10]} />
            <meshStandardMaterial color={skinColor} />
          </mesh>
          <mesh position={[0, -0.95, 0.15]} rotation={[0.5, 0, 0]} castShadow>
            <cylinderGeometry args={[0.09, 0.08, 0.7, 10]} />
            <meshStandardMaterial color={skinColor} />
          </mesh>
        </group>
      </group>

      {/* Floating name + jersey number label, billboarded toward camera */}
      <Billboard position={[0, 4.25, 0]} follow lockX={false} lockY={false} lockZ={false}>
        <Text
          fontSize={0.42}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.04}
          outlineColor={primaryColor}>
          {jerseyNumber ? `#${jerseyNumber}  ${playerName}` : playerName}
        </Text>
      </Billboard>
    </group>
  );
}

// ── Shot text classification ──────────────────────────────────────────────
//
// Derive a short shot-type label ("Layup", "Slam dunk", "Pull-up jumper")
// from ESPN's play description. Order matters — most specific first.

function classifyShotType(text: string | undefined, isThree: boolean): string {
  const t = (text ?? "").toLowerCase();
  if (/dunk/.test(t)) return "Slam dunk";
  if (/tip[\s-]?in/.test(t)) return "Tip-in";
  if (/alley[\s-]?oop/.test(t)) return "Alley-oop";
  if (/floater|floating/.test(t)) return "Floater";
  if (/finger[\s-]?roll/.test(t)) return "Finger roll";
  if (/reverse layup/.test(t)) return "Reverse layup";
  if (/driving layup/.test(t)) return "Driving layup";
  if (/cutting layup/.test(t)) return "Cutting layup";
  if (/layup/.test(t)) return "Layup";
  if (/hook/.test(t)) return "Hook shot";
  if (/fadeaway|fade[\s-]away/.test(t)) return "Fadeaway jumper";
  if (/step[\s-]?back/.test(t)) return "Step-back jumper";
  if (/pull[\s-]?up/.test(t)) return "Pull-up jumper";
  if (/turnaround/.test(t)) return "Turnaround jumper";
  if (/jumper|jump shot/.test(t)) return isThree ? "3-point jumper" : "Jumper";
  if (/free throw/.test(t)) return "Free throw";
  return isThree ? "3-pointer" : "Field goal";
}

function pointsLabel(made: boolean, isThree: boolean, isFreeThrow: boolean): string {
  if (!made) return "MISS";
  if (isFreeThrow) return "1 POINT";
  return isThree ? "3 POINTS" : "2 POINTS";
}

// ESPN play text for free throws looks like:
//   "Aliyah Boston makes free throw 1 of 2"
//   "Aliyah Boston misses free throw 2 of 2"
//   "Aliyah Boston makes free throw 1 of 1"        (after technical)
//   "Player makes free throw 1 of 3"               (3-pt foul)
// Returns "1 of 2" / "2 of 2" / "1 of 1" / etc., or null if not a FT.
function freeThrowContext(text: string | undefined): string | null {
  if (!text || !/free throw/i.test(text)) return null;
  const m = text.match(/(\d+)\s*of\s*(\d+)/i);
  if (!m) return null;
  return `${m[1]} of ${m[2]}`;
}

function isFreeThrowText(text: string | undefined): boolean {
  return !!text && /free throw/i.test(text);
}

// Pick the same emoji vocabulary as PlayByPlayFeed:
//   FT made → ✓, FT missed → ✗
//   dunk → 🔥, 3PT made → 🎯, 2PT/layup made → 🏀
//   field-goal miss → ↓
function shotEmoji(
  made: boolean,
  isThree: boolean,
  shotText: string | undefined,
): string {
  const isFT = /free throw/i.test(shotText ?? "");
  if (isFT) return made ? "✓" : "❌";
  if (made && /dunk/i.test(shotText ?? "")) return "🔥";
  if (made && isThree) return "🎯";
  if (made) return "🏀";
  return "❌";
}

// Render a color emoji into a 2D canvas (using the system color-emoji font)
// and wrap as a THREE.CanvasTexture so it can be plastered on a plane in
// the 3D scene. Drei's <Text> can't render color emojis (SDF fonts are
// monochrome), so this is the workaround.
function useEmojiTexture(emoji: string | null): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!emoji || typeof window === "undefined") {
      queueMicrotask(() => setTex(null));
      return;
    }
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    ctx.font =
      `${Math.floor(size * 0.82)}px "Apple Color Emoji", ` +
      `"Segoe UI Emoji", "Noto Color Emoji", "EmojiOne Color", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emoji, size / 2, size / 2 + size * 0.05);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.needsUpdate = true;
    queueMicrotask(() => setTex(t));
    return () => {
      t.dispose();
    };
  }, [emoji]);
  return tex;
}

function periodLabelFromNumber(p: number | undefined): string {
  if (!p || p < 1) return "—";
  if (p === 1) return "Q1";
  if (p === 2) return "Q2";
  if (p === 3) return "Q3";
  if (p === 4) return "Q4";
  if (p === 5) return "OT";
  return `${p - 4}OT`;
}

// ── Mini scoreboard ───────────────────────────────────────────────────────
//
// Always visible above the backboard while in 3D mode. Mirrors the data
// from the main scoreboard hero: live (or delayed) team scores with
// logos, period + clock, game-state line, and timeout dots per team.

interface MiniScoreboardProps {
  homeColor: string;
  awayColor: string;
  homeLogoUrl?: string;
  awayLogoUrl?: string;
  homeScore: string | number;
  awayScore: string | number;
  liveClock?: string;
  livePeriod?: number;
  gameStateText?: string;
  homeTimeoutsLeft?: number;
  awayTimeoutsLeft?: number;
  maxTimeouts: number;
  isGameLive: boolean;
}

function TimeoutDots({ left, max, color }: { left: number; max: number; color: string }) {
  // One dot per timeout slot: filled if remaining, hollow if used.
  return (
    <span className="inline-flex items-center gap-[3px]">
      {Array.from({ length: max }).map((_, i) => {
        const remaining = i < left;
        return (
          <span
            key={i}
            className="block w-[5px] h-[5px] rounded-full"
            style={{
              background: remaining ? color : "transparent",
              border: `1px solid ${remaining ? color : "rgba(255,255,255,0.3)"}`,
            }}
          />
        );
      })}
    </span>
  );
}

function MiniScoreboard({
  homeColor,
  awayColor,
  homeLogoUrl,
  awayLogoUrl,
  homeScore,
  awayScore,
  liveClock,
  livePeriod,
  gameStateText,
  homeTimeoutsLeft,
  awayTimeoutsLeft,
  maxTimeouts,
  isGameLive,
}: MiniScoreboardProps) {
  const period = periodLabelFromNumber(livePeriod);
  // Plain DOM overlay — rendered as a sibling of the <Canvas> outside the
  // R3F scene graph. Sits over the canvas but does not consume pointer
  // events, so OrbitControls receives drags / scroll through it.
  return (
    <div
      className="rounded-xl pointer-events-none shadow-2xl text-white"
      style={{
        background: "rgba(8,8,16,0.94)",
        border: "1px solid rgba(255,255,255,0.12)",
        backdropFilter: "blur(8px)",
        padding: "8px 12px",
        minWidth: 280,
      }}>
        {/* Top row: away logo · away score · clock/period · home score · home logo */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {awayLogoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={awayLogoUrl}
                alt=""
                style={{ width: 24, height: 24, objectFit: "contain" }}
              />
            )}
            <span
              className="text-lg font-bold tabular-nums"
              style={{ color: awayColor }}>
              {awayScore}
            </span>
          </div>

          <div className="flex flex-col items-center px-2">
            <div className="flex items-center gap-1">
              {isGameLive && (
                <span
                  className="w-1.5 h-1.5 rounded-full pulse-live"
                  style={{ background: "#22c55e" }}
                  aria-hidden
                />
              )}
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/55">
                {period}
              </span>
            </div>
            <span className="text-sm font-mono font-bold tabular-nums text-white">
              {liveClock ?? "—:—"}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span
              className="text-lg font-bold tabular-nums"
              style={{ color: homeColor }}>
              {homeScore}
            </span>
            {homeLogoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={homeLogoUrl}
                alt=""
                style={{ width: 24, height: 24, objectFit: "contain" }}
              />
            )}
          </div>
        </div>

        {/* Game-state line — only when ESPN gives us something interesting
            ("Halftime", "End of 3rd Quarter", "Final"). */}
        {gameStateText && (
          <div className="text-center text-[10px] font-semibold uppercase tracking-widest text-white/45 mt-1">
            {gameStateText}
          </div>
        )}

        {/* Timeouts row — labeled "TO" with one dot per slot per team. */}
        {(homeTimeoutsLeft != null || awayTimeoutsLeft != null) && (
          <div className="flex items-center justify-between gap-3 mt-1.5 pt-1.5 border-t border-white/10">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold uppercase tracking-widest text-white/35">
                TO
              </span>
              <TimeoutDots
                left={awayTimeoutsLeft ?? maxTimeouts}
                max={maxTimeouts}
                color={awayColor}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <TimeoutDots
                left={homeTimeoutsLeft ?? maxTimeouts}
                max={maxTimeouts}
                color={homeColor}
              />
              <span className="text-[9px] font-bold uppercase tracking-widest text-white/35">
                TO
              </span>
            </div>
          </div>
        )}
    </div>
  );
}

// ── Shot result badge ─────────────────────────────────────────────────────
//
// Pops up at the rim once the ball completes its approach arc, showing
// the same emoji vocabulary as the Play-by-Play feed plus the shooting
// team's logo. Lives in HTML space (drei <Html>) so emoji fonts render
// crisply at every camera distance.

// ── In-world jumbotron scoreboard ─────────────────────────────────────────
//
// 3D arena-style scoreboard hanging above and behind the rim. Always
// faces the camera (Billboard) so it stays readable from any orbit
// angle. Top half: live scores + clock + period. Bottom half: result
// of the most recent shot (player + points + shot type). Logos are
// rendered as textured planes; text via drei's <Text>.

interface JumbotronProps {
  homeColor: string;
  awayColor: string;
  homeLogoTexture: THREE.Texture | null;
  awayLogoTexture: THREE.Texture | null;
  homeScore: string | number;
  awayScore: string | number;
  liveClock?: string;
  livePeriod?: number;
  gameStateText?: string;
  homeTimeoutsLeft?: number;
  awayTimeoutsLeft?: number;
  maxTimeouts: number;
  isGameLive: boolean;
  currentShotResult: SceneProps["currentShotResult"];
}

function JumbotronScoreboard({
  homeColor,
  awayColor,
  homeLogoTexture,
  awayLogoTexture,
  homeScore,
  awayScore,
  liveClock,
  livePeriod,
  gameStateText,
  homeTimeoutsLeft,
  awayTimeoutsLeft,
  maxTimeouts,
  isGameLive,
  currentShotResult,
}: JumbotronProps) {
  const period = periodLabelFromNumber(livePeriod);
  // Larger panel — easier to read from any reasonable orbit distance.
  const W = 22;
  const H = 12;
  const PANEL_DEPTH = 0.5;

  // Frame border tint. Tracks the shooting team of the most recent
  // shot so the user can see at a glance which team last had the ball.
  // Defaults to a neutral grey before any shot lands.
  const frameColor = currentShotResult?.teamColor ?? "#666677";

  // Glow-pulse animation: fade between black and the frame color via
  // useFrame on the frame mesh's material. Sine wave at ~2.5 rad/s
  // (~0.4 Hz, full cycle every ~2.5 s) — visible but not distracting.
  const frameMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const frameTargetColor = useMemo(
    () => new THREE.Color(frameColor),
    [frameColor],
  );
  const blackColor = useMemo(() => new THREE.Color("#000000"), []);
  useFrame((state) => {
    if (!frameMatRef.current) return;
    const t = (Math.sin(state.clock.elapsedTime * 2.5) + 1) / 2; // 0..1
    frameMatRef.current.color.lerpColors(blackColor, frameTargetColor, t);
    frameMatRef.current.emissive.lerpColors(blackColor, frameTargetColor, t);
    frameMatRef.current.emissiveIntensity = 0.1 + t * 0.7;
  });

  // Bottom result panel data (only when a shot has settled)
  const result = currentShotResult;
  const resultAccent = result ? (result.made ? "#22c55e" : "#ef4444") : "#ffffff";
  const isFT = result ? isFreeThrowText(result.shotText) : false;
  const ftCtx = result ? freeThrowContext(result.shotText) : null;
  const pointsText = result
    ? pointsLabel(result.made, result.isThree, isFT)
    : "";
  // Shot type line. For free throws, append the "X of Y" context that
  // ESPN encodes in the play text — "Free throw · 1 of 2" reads better
  // than just "Free throw".
  const shotType = result
    ? ftCtx
      ? `${classifyShotType(result.shotText, result.isThree)} · ${ftCtx}`
      : classifyShotType(result.shotText, result.isThree)
    : "";
  // Emoji texture mirrors PlayByPlayFeed's vocabulary (🔥/🎯/🏀/↓).
  // Rendered to a CanvasTexture so we get system color emoji rendering
  // inside the WebGL scene.
  const emojiChar = result
    ? shotEmoji(result.made, result.isThree, result.shotText)
    : null;
  const emojiTexture = useEmojiTexture(emojiChar);

  // Stationary group with default orientation — content face points
  // toward +Z, the natural viewing direction when orbiting in front of
  // the basket (looking back from inside the court). Away/home X coords
  // are now the natural sign: away at -X (left), home at +X (right).
  // Scale 1.5625 (1.25 × 1.25) uniformly grows the panel + every child
  // (text, logos, dots, spacing) so the whole scoreboard reads larger
  // without having to retune each individual value.
  return (
    <group position={[0, 25, -2]} scale={1.5625}>
      {/* Backing panel — dark, slightly emissive so it reads in low light */}
      <mesh>
        <boxGeometry args={[W, H, PANEL_DEPTH]} />
        <meshStandardMaterial
          color="#070710"
          emissive="#070710"
          emissiveIntensity={0.6}
          roughness={0.8}
        />
      </mesh>
      {/* Outer frame — pulses between black and the shooting team's
          color (grey before any shot). useFrame on the material above
          drives the lerp every frame. */}
      <mesh position={[0, 0, PANEL_DEPTH / 2 - 0.01]}>
        <boxGeometry args={[W + 0.4, H + 0.4, 0.06]} />
        <meshStandardMaterial
          ref={frameMatRef}
          color={frameColor}
          emissive={frameColor}
          emissiveIntensity={0.4}
        />
      </mesh>
      {/* Inner well — black plate that the content sits on. Sits between
          the frame (front face at PANEL_DEPTH/2 + 0.02) and the content
          (at PANEL_DEPTH/2 + 0.2), with comfortable z-gaps to either side. */}
      <mesh position={[0, 0, PANEL_DEPTH / 2 + 0.08]}>
        <boxGeometry args={[W - 0.6, H - 0.6, 0.02]} />
        <meshStandardMaterial color="#000000" />
      </mesh>

      {/* ── TOP HALF: live scoreboard ───────────────────────────────── */}
      <group position={[0, 2.6, PANEL_DEPTH / 2 + 0.2]}>
        {/* Away (camera's LEFT) — at LOCAL -X */}
        {awayLogoTexture && (
          <mesh position={[-8.2, 0, 0]}>
            <planeGeometry args={[2.6, 2.6]} />
            <meshBasicMaterial
              map={awayLogoTexture}
              transparent
              alphaTest={0.05}
              toneMapped={false}
            />
          </mesh>
        )}
        <Text
          position={[-5.0, 0, 0]}
          fontSize={2.4}
          color={awayColor}
          anchorX="center"
          anchorY="middle"
          fontWeight="bold"
          outlineWidth={0.06}
          outlineColor="#000000">
          {String(awayScore)}
        </Text>

        {/* Center: clock + period */}
        <Text
          position={[0, 1.1, 0]}
          fontSize={0.8}
          color="#cccccc"
          anchorX="center"
          anchorY="middle">
          {period}
        </Text>
        <Text
          position={[0, -0.2, 0]}
          fontSize={2.0}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
          fontWeight="bold"
          outlineWidth={0.05}
          outlineColor="#000000">
          {liveClock ?? "—:—"}
        </Text>
        {isGameLive && (
          <mesh position={[0, -1.5, 0.01]}>
            <circleGeometry args={[0.18, 16]} />
            <meshBasicMaterial color="#22c55e" toneMapped={false} />
          </mesh>
        )}

        {/* Home (camera's RIGHT) — at LOCAL +X */}
        <Text
          position={[5.0, 0, 0]}
          fontSize={2.4}
          color={homeColor}
          anchorX="center"
          anchorY="middle"
          fontWeight="bold"
          outlineWidth={0.06}
          outlineColor="#000000">
          {String(homeScore)}
        </Text>
        {homeLogoTexture && (
          <mesh position={[8.2, 0, 0]}>
            <planeGeometry args={[2.6, 2.6]} />
            <meshBasicMaterial
              map={homeLogoTexture}
              transparent
              alphaTest={0.05}
              toneMapped={false}
            />
          </mesh>
        )}
      </group>

      {/* Game-state line (HALFTIME / END OF 3RD / FINAL) */}
      {gameStateText && (
        <Text
          position={[0, 0.4, PANEL_DEPTH / 2 + 0.2]}
          fontSize={0.55}
          color="#888899"
          anchorX="center"
          anchorY="middle">
          {gameStateText.toUpperCase()}
        </Text>
      )}

      {/* Timeouts row */}
      {(homeTimeoutsLeft != null || awayTimeoutsLeft != null) && (
        <group position={[0, -0.6, PANEL_DEPTH / 2 + 0.2]}>
          {/* Away TO label (camera's left = local -X) */}
          <Text
            position={[-7.5, 0, 0]}
            fontSize={0.45}
            color="#666677"
            anchorX="center"
            anchorY="middle">
            TO
          </Text>
          {/* Away dots: starting just inside the TO label, going toward center */}
          {Array.from({ length: maxTimeouts }).map((_, i) => {
            const remaining = i < (awayTimeoutsLeft ?? maxTimeouts);
            return (
              <mesh key={`a${i}`} position={[-6.4 + i * 0.5, 0, 0]}>
                <circleGeometry args={[0.18, 16]} />
                <meshBasicMaterial
                  color={remaining ? awayColor : "#222233"}
                  toneMapped={false}
                />
              </mesh>
            );
          })}
          {/* Home dots: starting just past center, going toward camera's right */}
          {Array.from({ length: maxTimeouts }).map((_, i) => {
            const remaining = i < (homeTimeoutsLeft ?? maxTimeouts);
            return (
              <mesh key={`h${i}`} position={[2.4 + i * 0.5, 0, 0]}>
                <circleGeometry args={[0.18, 16]} />
                <meshBasicMaterial
                  color={remaining ? homeColor : "#222233"}
                  toneMapped={false}
                />
              </mesh>
            );
          })}
          {/* Home TO label (camera's right = local +X) */}
          <Text
            position={[7.5, 0, 0]}
            fontSize={0.45}
            color="#666677"
            anchorX="center"
            anchorY="middle">
            TO
          </Text>
        </group>
      )}

      {/* Divider between top (scoreboard) and bottom (shot result) */}
      <mesh position={[0, -1.5, PANEL_DEPTH / 2 + 0.2]}>
        <boxGeometry args={[W - 1.5, 0.06, 0.01]} />
        <meshBasicMaterial color="#fc6300" toneMapped={false} />
      </mesh>

      {/* ── BOTTOM HALF: most recent shot result ────────────────────── */}
      {result ? (
        <group position={[0, -3.7, PANEL_DEPTH / 2 + 0.2]}>
          {/* Player name + jersey — y=1.55 leaves ~0.2 ft padding above
              from the divider line, while still keeping a clean gap to
              the result row below. */}
          <Text
            position={[0, 1.55, 0]}
            fontSize={0.84}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            fontWeight="bold">
            {result.jerseyNumber ? `#${result.jerseyNumber}  ${result.playerName}` : result.playerName}
          </Text>

          {/* Result row: EMOJI · TEXT · TEAM LOGO. Spread out so the
              emoji and logo don't overlap the (variable-width) result
              text in the middle. */}
          <group position={[0, 0.1, 0]}>
            {emojiTexture && (
              <mesh position={[-5.5, 0, 0]}>
                <planeGeometry args={[1.2, 1.2]} />
                <meshBasicMaterial
                  map={emojiTexture}
                  transparent
                  alphaTest={0.05}
                  toneMapped={false}
                />
              </mesh>
            )}
            <Text
              position={[0, 0, 0]}
              fontSize={1.75}
              color={resultAccent}
              anchorX="center"
              anchorY="middle"
              fontWeight="bold"
              outlineWidth={0.075}
              outlineColor="#000000">
              {pointsText}
            </Text>
            {result.teamLogoTexture && (
              <mesh position={[5.5, 0, 0]}>
                <planeGeometry args={[2.0, 2.0]} />
                <meshBasicMaterial
                  map={result.teamLogoTexture}
                  transparent
                  alphaTest={0.05}
                  toneMapped={false}
                />
              </mesh>
            )}
          </group>

          {/* Bottom row: shot type alone, centered. Pulled up to y=-1.4
              so there's ~0.4 ft of clear space between the shot type
              text and the panel's bottom edge. */}
          <Text
            position={[0, -1.4, 0]}
            fontSize={0.975}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            fontWeight="bold">
            {shotType}
          </Text>
        </group>
      ) : (
        <Text
          position={[0, -3.4, PANEL_DEPTH / 2 + 0.2]}
          fontSize={0.85}
          color="#444455"
          anchorX="center"
          anchorY="middle">
          AWAITING NEXT SHOT
        </Text>
      )}
    </group>
  );
}

// ── Shot rendering ────────────────────────────────────────────────────────

interface ShotProps {
  shot: Shot3DInput;
  color: string;
  animate: boolean;
  // When true, also render a procedural player figure at the origin during
  // the animation. Used by hide-history mode.
  showPlayer: boolean;
  playerInfo: {
    primary: string;
    secondary: string;
    jerseyNumber: string;
    playerName: string;
    logoTexture: THREE.Texture | null;
    logoUrl?: string;
    headshotUrl?: string;
    heightInches?: number;
  } | null;
  onHover: (s: Shot3DInput | null, screenX: number, screenY: number) => void;
}

function Shot({ shot, color, animate, showPlayer, playerInfo, onHover }: ShotProps) {
  const groupRef = useRef<THREE.Group>(null);
  const ballRef = useRef<THREE.Mesh>(null);
  // Combined animation progress (0..1) covering windup + flight + fade.
  // Player figure reads this via useFrame to stay in sync.
  const playerProgress = useRef<number>(animate ? 0 : 1);
  // Flips true once the ball completes its approach (reaches the rim).
  // Drives the made/missed result badge. Starts true when not animating
  // so static shots show their badge immediately. Ref-paired with state
  // so the useFrame closure can check O(1) without stale-closure issues.
  const hasReachedRimRef = useRef<boolean>(!animate);

  const { mainPoints, deflectPoints, makeCurve, missCurves } =
    useMemo(() => {
      if (shot.made) {
        const c = buildMakeArc(shot);
        return {
          mainPoints: sampleCurve(c, 28),
          deflectPoints: null as THREE.Vector3[] | null,
          totalLen: 1,
          makeCurve: c,
          missCurves: null as ReturnType<typeof buildMissArc> | null,
        };
      } else {
        const m = buildMissArc(shot);
        return {
          mainPoints: sampleCurve(m.approach, 24),
          deflectPoints: sampleCurve(m.deflect, 16),
          totalLen: 1,
          makeCurve: null as THREE.QuadraticBezierCurve3 | null,
          missCurves: m,
        };
      }
    }, [shot]);

  // Animation state. `t` runs 0→1 across the approach, then 1→2 across the
  // deflection (for misses). Static mode just leaves the ball at the end.
  const animating = useRef(animate);
  const t = useRef(animate ? 0 : shot.made ? 1 : 2);

  useEffect(() => {
    if (animate) {
      animating.current = true;
      t.current = 0;
      playerProgress.current = 0;
    }
  }, [animate]);

  // Total animation timeline (when showPlayer is true):
  //   0.00–0.45 s : player wind-up; ball stays at start (release point)
  //   0.45–1.10 s : ball flies along approach arc
  //   1.10–1.50 s : (miss only) deflection bounce
  //   trailing    : player + arc fade
  const TIMINGS = useMemo(() => {
    if (showPlayer) {
      return { windup: 0.45, approach: 0.65, deflect: 0.4, fade: 0.4 };
    }
    return { windup: 0, approach: 0.7, deflect: 0.5, fade: 0.3 };
  }, [showPlayer]);

  useFrame((_, delta) => {
    if (!animating.current || !ballRef.current) return;

    // Phase 0: wind-up. Ball stays at release-point start; player crouches.
    if (t.current < 0) {
      t.current += delta / TIMINGS.windup;
      const curve = shot.made ? makeCurve! : missCurves!.approach;
      ballRef.current.position.copy(curve.getPoint(0));
      // Map negative t (-1..0) into player progress 0..0.35
      playerProgress.current = THREE.MathUtils.clamp((t.current + 1) * 0.35, 0, 0.35);
      return;
    }

    if (t.current < 1) {
      t.current = Math.min(1, t.current + delta / TIMINGS.approach);
      const curve = shot.made ? makeCurve! : missCurves!.approach;
      ballRef.current.position.copy(curve.getPoint(t.current));
      // approach maps to player progress 0.35..0.85
      playerProgress.current = 0.35 + t.current * 0.5;
      // Ball just reached the rim — pop the made/missed result badge.
      if (!hasReachedRimRef.current && t.current >= 1) {
        hasReachedRimRef.current = true;
      }
    } else if (!shot.made && t.current < 2) {
      const localT = t.current - 1;
      t.current = Math.min(2, t.current + delta / TIMINGS.deflect);
      ballRef.current.position.copy(
        missCurves!.deflect.getPoint(THREE.MathUtils.clamp(localT, 0, 1)),
      );
      playerProgress.current = 0.85 + Math.min(localT, 1) * 0.1; // 0.85..0.95
    } else if (t.current < 3) {
      // Linger / fade phase. Doesn't affect ball position; lets player
      // figure complete its fade-out gracefully.
      t.current = Math.min(3, t.current + delta / TIMINGS.fade);
      playerProgress.current = Math.min(1, 0.95 + (t.current - 2) * 0.05);
    } else {
      animating.current = false;
      playerProgress.current = 1;
    }

    // Spin the ball as it flies for a bit of life (only during flight)
    if (t.current >= 0 && t.current < 2) {
      ballRef.current.rotation.x += delta * 6;
      ballRef.current.rotation.y += delta * 4;
    }
  });

  // Initialize t at -1 (start of windup) when showing player and animating;
  // -1 → 0 = windup, 0 → 1 = approach, 1 → 2 = deflect, 2 → 3 = fade.
  useEffect(() => {
    if (animate) {
      t.current = showPlayer ? -1 : 0;
      playerProgress.current = 0;
      hasReachedRimRef.current = false;
    }
  }, [animate, showPlayer]);

  // Final resting position of the ball when not animating
  const restPos = useMemo(() => {
    if (shot.made) return new THREE.Vector3(RIM_X, RIM_Y - 0.8, RIM_Z);
    return missCurves!.deflect.getPoint(1);
  }, [shot.made, missCurves]);

  const ballRadius = 0.45;

  return (
    <group ref={groupRef}>
      {/* Approach arc */}
      <Line
        points={mainPoints}
        color={color}
        lineWidth={shot.made ? 2.2 : 1.6}
        opacity={shot.made ? 0.85 : 0.5}
        transparent
      />
      {/* Deflection arc (misses only) */}
      {deflectPoints && (
        <Line
          points={deflectPoints}
          color={color}
          lineWidth={1.2}
          opacity={0.35}
          transparent
          dashed
          dashSize={0.4}
          gapSize={0.3}
        />
      )}

      {/* Origin marker on the floor */}
      <mesh
        position={[shot.worldX, 0.04, shot.worldZ]}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          onHover(shot, e.clientX, e.clientY);
        }}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          onHover(shot, e.clientX, e.clientY);
        }}
        onPointerOut={() => onHover(null, 0, 0)}>
        <ringGeometry args={[0.45, 0.7, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} side={THREE.DoubleSide} />
      </mesh>

      {/* Ball — animates along the arc, then rests at end position */}
      <mesh
        ref={ballRef}
        position={animate ? shotOriginVec(shot).toArray() : restPos.toArray()}
        castShadow
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          onHover(shot, e.clientX, e.clientY);
        }}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          onHover(shot, e.clientX, e.clientY);
        }}
        onPointerOut={() => onHover(null, 0, 0)}>
        <sphereGeometry args={[ballRadius, 24, 24]} />
        <meshStandardMaterial
          color={shot.made ? color : "#9b6534"}
          emissive={shot.made ? color : "#000"}
          emissiveIntensity={shot.made ? 0.35 : 0}
          roughness={0.55}
          metalness={0.05}
        />
      </mesh>

      {/* Procedural shooter — rendered the entire time this Shot is
          on the court in hide-history mode. Crouches/shoots when the
          ball animation runs (animate=true), then holds in follow-through
          pose for the lifetime of the Shot. The figure is replaced when
          the next live shot arrives (different liveShotId → new Shot
          mounts with its own fresh PlayerFigure). */}
      {showPlayer && playerInfo && (
        <PlayerFigure
          position={[shot.worldX, 0, shot.worldZ]}
          primaryColor={playerInfo.primary}
          secondaryColor={playerInfo.secondary}
          jerseyNumber={playerInfo.jerseyNumber}
          playerName={playerInfo.playerName}
          logoTexture={playerInfo.logoTexture}
          headshotUrl={playerInfo.headshotUrl}
          heightInches={playerInfo.heightInches}
          progressRef={playerProgress}
        />
      )}

      {/* Result badge is rendered as a DOM overlay at the top level
          (outside the Canvas) so it never intercepts pointer events
          meant for OrbitControls. See ShotChart3D bottom of file. */}
    </group>
  );
}

// ── Camera nudger ─────────────────────────────────────────────────────────
//
// Lives inside the Canvas (so it can use useThree). When the parent's
// `delta` prop changes to a non-zero value, lifts BOTH the camera and the
// active OrbitControls' target by that many world units (preserving the
// look angle — like an elevator), then calls `onApplied` so the parent
// can reset delta back to 0. Subsequent clicks just toggle delta again.

interface CameraNudgerProps {
  delta: number;
  onApplied: () => void;
}

function CameraNudger({ delta, onApplied }: CameraNudgerProps) {
  const camera = useThree((s) => s.camera);
  const controls = useThree(
    (s) => s.controls,
  ) as unknown as { target: THREE.Vector3; update: () => void } | null;

  useEffect(() => {
    if (delta === 0) return;
    // Imperative 3D camera nudge — use .set() to avoid direct property assignment lint in strict compiler mode.
    camera.position.set(camera.position.x, camera.position.y + delta, camera.position.z);
    if (controls && controls.target) {
      controls.target.set(controls.target.x, controls.target.y + delta, controls.target.z);
      controls.update();
    }
    onApplied();
  }, [delta, camera, controls, onApplied]);

  return null;
}

// ── Scene ──────────────────────────────────────────────────────────────────

interface SceneProps {
  shots: Shot3DInput[];
  homeColor: string;
  awayColor: string;
  homeSecondary: string;
  awaySecondary: string;
  homeLogoTexture: THREE.Texture | null;
  awayLogoTexture: THREE.Texture | null;
  // Raw URLs (passed alongside the textures) so the HTML result badge
  // can render the logo as an <img> next to the emoji.
  homeLogoUrl?: string;
  awayLogoUrl?: string;
  playerNamesById: Record<string, string>;
  playerJerseysById: Record<string, string>;
  playerHeadshotsById: Record<string, string>;
  playerHeightsById: Record<string, number>;
  newShotIds: Set<string>;
  hideHistory: boolean;
  // In hide-history mode, the single shot ID that should remain visible
  // on the court. Updates only when a newer live shot arrives, so the
  // previous shot persists between live plays. Null until first shot.
  liveShotId: string | null;
  onHover: ShotProps["onHover"];
  // Mini scoreboard data — always rendered above the backboard.
  homeScore: string | number;
  awayScore: string | number;
  liveClock?: string;
  livePeriod?: number;
  gameStateText?: string;
  homeTimeoutsLeft?: number;
  awayTimeoutsLeft?: number;
  maxTimeouts: number;
  isGameLive: boolean;
  // Result of the most recent shot. Drives the bottom half of the
  // in-world jumbotron scoreboard. Null until the live cinema toggle
  // produces a settled shot.
  currentShotResult: {
    made: boolean;
    isThree: boolean;
    teamLogoTexture: THREE.Texture | null;
    // Primary color of the shooting team — drives the jumbotron frame
    // tint so the scoreboard border reflects who took the latest shot.
    teamColor: string;
    shotText: string;
    playerName: string;
    jerseyNumber: string;
  } | null;
  // One-shot camera Y nudge — non-zero means apply on next render then
  // reset via onCameraNudgeApplied.
  cameraDelta: number;
  onCameraNudgeApplied: () => void;
  // Browser fullscreen — extends OrbitControls.maxDistance by 50% so
  // users with a full viewport can zoom out further to see the whole
  // court / scoreboard / sidelines without clipping.
  isFullscreen: boolean;
}

function Scene({
  shots,
  homeColor,
  awayColor,
  homeSecondary,
  awaySecondary,
  homeLogoTexture,
  awayLogoTexture,
  homeLogoUrl,
  awayLogoUrl,
  playerNamesById,
  playerJerseysById,
  playerHeadshotsById,
  playerHeightsById,
  newShotIds,
  hideHistory,
  liveShotId,
  onHover,
  homeScore,
  awayScore,
  liveClock,
  livePeriod,
  gameStateText,
  homeTimeoutsLeft,
  awayTimeoutsLeft,
  maxTimeouts,
  isGameLive,
  currentShotResult,
  cameraDelta,
  onCameraNudgeApplied,
  isFullscreen,
}: SceneProps) {
  // Load the SyncCourt floor logo once. Texture is shared with the Court
  // mesh below; falls back to no-logo if the image fails to load.
  const floorLogoTex = useImageTexture("/synccourt-logo.jpg");
  // Hide-history mode renders exactly one shot at a time — the most
  // recent live shot. It stays visible (arc + ball at rest) until a
  // newer shot arrives, at which point it's replaced. The user gets
  // a continuous "last shot is always on screen" view.
  const renderedShots = useMemo(() => {
    if (!hideHistory) return shots;
    if (!liveShotId) return [];
    const live = shots.find((s) => s.id === liveShotId);
    return live ? [live] : [];
  }, [shots, hideHistory, liveShotId]);

  return (
    <>
      <color attach="background" args={["#0a0a14"]} />
      {/* Fog removed — was fading distant objects toward the background
          color when zooming out, especially in fullscreen with the
          extended OrbitControls.maxDistance. */}

      <ambientLight intensity={0.55} />
      <directionalLight
        position={[15, 30, 5]}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[-20, 18, 30]} intensity={0.4} />

      <Court
        homeColor={homeColor}
        awayColor={awayColor}
        floorLogoTexture={floorLogoTex}
      />

      {/* In-world jumbotron — billboard above the rim, always faces camera */}
      <JumbotronScoreboard
        homeColor={homeColor}
        awayColor={awayColor}
        homeLogoTexture={homeLogoTexture}
        awayLogoTexture={awayLogoTexture}
        homeScore={homeScore}
        awayScore={awayScore}
        liveClock={liveClock}
        livePeriod={livePeriod}
        gameStateText={gameStateText}
        homeTimeoutsLeft={homeTimeoutsLeft}
        awayTimeoutsLeft={awayTimeoutsLeft}
        maxTimeouts={maxTimeouts}
        isGameLive={isGameLive}
        currentShotResult={currentShotResult}
      />

      {renderedShots.map((s) => {
        const isHome = s.side === "home";
        const color = isHome ? homeColor : s.side === "away" ? awayColor : "#bbbbbb";
        const secondary = isHome ? homeSecondary : s.side === "away" ? awaySecondary : "#1a1a2e";
        const logoTex = isHome ? homeLogoTexture : s.side === "away" ? awayLogoTexture : null;
        const logoUrl = isHome ? homeLogoUrl : s.side === "away" ? awayLogoUrl : undefined;
        const jersey = s.playerId ? playerJerseysById[s.playerId] ?? "" : "";
        const name = s.playerId
          ? playerNamesById[s.playerId] ?? "Unknown player"
          : "Unknown player";
        const headshot = s.playerId ? playerHeadshotsById[s.playerId] : undefined;
        const heightIn = s.playerId ? playerHeightsById[s.playerId] : undefined;
        return (
          <Shot
            key={s.id}
            shot={s}
            color={color}
            animate={newShotIds.has(s.id)}
            showPlayer={hideHistory}
            playerInfo={{
              primary: color,
              secondary,
              jerseyNumber: jersey,
              playerName: name,
              logoTexture: logoTex,
              logoUrl,
              headshotUrl: headshot,
              heightInches: heightIn,
            }}
            onHover={onHover}
          />
        );
      })}

      <OrbitControls
        // Target dropped 12 ft to match the new default camera Y so the
        // initial look angle is unchanged (camera and target both drop
        // by the same amount = elevator translation, not a tilt).
        target={[0, 10, -2]}
        minDistance={18}
        // Both max distances bumped 50% from the prior pass so users
        // can pull way back: 75 → 112 (windowed), 112 → 168 (fullscreen).
        maxDistance={isFullscreen ? 168 : 112}
        minPolarAngle={0.05}
        maxPolarAngle={Math.PI / 2 - 0.05}
        enablePan
        enableZoom
        makeDefault
      />
      <CameraNudger delta={cameraDelta} onApplied={onCameraNudgeApplied} />
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function ShotChart3D({
  shots,
  homeColor,
  awayColor,
  homeSecondary,
  awaySecondary,
  homeName,
  awayName,
  homeLogoUrl,
  awayLogoUrl,
  playerNamesById,
  playerJerseysById,
  playerHeadshotsById = {},
  playerHeightsById = {},
  hideHistory,
  homeScore = "0",
  awayScore = "0",
  liveClock,
  livePeriod,
  gameStateText,
  homeTimeoutsLeft,
  awayTimeoutsLeft,
  maxTimeouts = 7,
  isGameLive = false,
  gameState,
}: ShotChart3DProps) {
  // Load team logo textures once. Returned null if URL is missing or load
  // fails (CORS/404) — Player figure renders without logo in that case.
  const homeLogoTexture = useImageTexture(homeLogoUrl);
  const awayLogoTexture = useImageTexture(awayLogoUrl);

  // Track which shot IDs are "new" since mount, so we can flight-animate
  // freshly arrived shots when a live game ticks. On first mount, we treat
  // existing shots as already-played to avoid a 50-shot opening cinematic.
  const seenRef = useRef<Set<string> | null>(null);
  const [newShotIds, setNewShotIds] = useState<Set<string>>(() => new Set());

  // The single shot kept on the court in hide-history mode. Sticky — only
  // replaced when a newer shot arrives, so the last shot stays visible
  // between live plays instead of disappearing on a timer.
  const [liveShotId, setLiveShotId] = useState<string | null>(null);

  // FIFO queue of shot IDs waiting to be promoted to liveShotId in
  // hide-history mode. Used so each new shot's animation gets to fully
  // play out and then sit on screen for ~4 seconds before the next shot
  // takes over (rather than rapid-fire replacing during a flurry of
  // plays). Show-history mode bypasses the queue entirely.
  const [shotQueue, setShotQueue] = useState<string[]>([]);
  const liveShotStartRef = useRef<number>(0);
  // Total dwell time per shot before the queue advances. Animation
  // takes ~1.5–1.9 s (windup + approach + optional miss-deflect + fade);
  // user-requested 4 s display window starts after that → ~6 s total.
  const HOLD_MS = 6000;

  // When hide-history toggles on, seed liveShotId with the most recent
  // shot from the current data so the user immediately sees something
  // (rather than an empty court waiting for the next live tick). Also
  // mark it as a fresh arrival so it animates once, and stamp the start
  // time so the queue-advance effect respects the HOLD_MS dwell.
  useEffect(() => {
    if (!hideHistory || shots.length === 0) return;
    const latest = shots.reduce((a, b) =>
      a.gameTimeSecs >= b.gameTimeSecs ? a : b,
    );
    queueMicrotask(() => setLiveShotId(latest.id));
    queueMicrotask(() => setNewShotIds(new Set([latest.id])));
    liveShotStartRef.current = Date.now();
    queueMicrotask(() => setShotQueue([]));
    // Intentional: only reseed when hideHistory transitions to on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideHistory]);

  useEffect(() => {
    if (seenRef.current == null) {
      seenRef.current = new Set(shots.map((s) => s.id));
      return;
    }
    const incoming: Shot3DInput[] = [];
    for (const s of shots) {
      if (!seenRef.current.has(s.id)) {
        incoming.push(s);
        seenRef.current.add(s.id);
      }
    }
    if (incoming.length === 0) return;

    if (hideHistory) {
      // Queue them in chronological order. The queue-advance effect
      // pulls them off one at a time with HOLD_MS spacing.
      incoming.sort((a, b) => a.gameTimeSecs - b.gameTimeSecs);
      queueMicrotask(() => setShotQueue((q) => [...q, ...incoming.map((s) => s.id)]));
      queueMicrotask(() => setNewShotIds((prev) => {
        const next = new Set(prev);
        for (const s of incoming) next.add(s.id);
        return next;
      }));
      return;
    }

    // Show-history mode: still immediate. Promote the newest arrival to
    // liveShotId and animate it once.
    queueMicrotask(() => setNewShotIds(new Set(incoming.map((s) => s.id))));
    const newest = incoming.reduce((a, b) =>
      a.gameTimeSecs >= b.gameTimeSecs ? a : b,
    );
    queueMicrotask(() => setLiveShotId(newest.id));
    const timer = setTimeout(() => setNewShotIds(new Set()), 1500);
    return () => clearTimeout(timer);
  }, [shots, hideHistory]);

  // Queue-advance effect (hide-history only). Pops the next shot off
  // the queue when (a) there's nothing showing yet, or (b) the current
  // shot has been on screen for at least HOLD_MS so its animation has
  // completed plus the user-requested ~4 s dwell.
  useEffect(() => {
    if (!hideHistory) return;
    if (shotQueue.length === 0) return;

    const advance = () => {
      setShotQueue((q) => {
        if (q.length === 0) return q;
        const [next, ...rest] = q;
        queueMicrotask(() => setLiveShotId(next));
        liveShotStartRef.current = Date.now();
        return rest;
      });
    };

    if (!liveShotId) {
      advance();
      return;
    }

    const elapsed = Date.now() - liveShotStartRef.current;
    if (elapsed >= HOLD_MS) {
      advance();
      return;
    }
    const timer = setTimeout(advance, HOLD_MS - elapsed);
    return () => clearTimeout(timer);
  }, [shotQueue, liveShotId, hideHistory]);

  const [hover, setHover] = useState<{
    shot: Shot3DInput;
    color: string;
    x: number;
    y: number;
  } | null>(null);

  const handleHover: ShotProps["onHover"] = (s, x, y) => {
    if (!s) {
      setHover(null);
      return;
    }
    const color = s.side === "home" ? homeColor : s.side === "away" ? awayColor : "#bbbbbb";
    // Compute relative to container at event time (safe in handler, not render).
    let relX = x;
    let relY = y;
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      relX = x - rect.left;
      relY = y - rect.top;
    }
    setHover({ shot: s, color, x: relX, y: relY });
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  // Keep container width in state via ResizeObserver so tooltip positioning
  // math never reads .current during render (satisfies react-hooks/refs).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth || 800);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Camera up/down nudger. Buttons set this to ±3 ft; the in-Canvas
  // CameraNudger applies it once and resets via onApplied.
  const [cameraDelta, setCameraDelta] = useState(0);
  const CAMERA_STEP = 3;
  const handleCameraNudgeApplied = useMemo(
    () => () => setCameraDelta(0),
    [],
  );

  // WebGL readiness — true once the Canvas has created its renderer AND
  // hasn't lost its context. We force the loading overlay whenever this
  // is false, so the dark "Loading…" screen covers the (white) canvas
  // while WebGL is still booting or after a context-lost event.
  const [canvasReady, setCanvasReady] = useState(false);

  // While WebGL isn't ready, force-remount the Canvas every second by
  // bumping a key. Each remount creates a fresh WebGL context attempt;
  // the moment one succeeds, onCreated fires, canvasReady flips, and
  // the interval clears. No cap — keep checking indefinitely so the
  // 3D scene loads automatically the first time the GPU/data is ready.
  const [retryAttempt, setRetryAttempt] = useState(0);
  useEffect(() => {
    if (canvasReady) return;
    const id = setInterval(() => setRetryAttempt((a) => a + 1), 1000);
    return () => clearInterval(id);
  }, [canvasReady]);

  // When a fresh shot arrives while the canvas still isn't ready,
  // immediately bump the retry counter once more so the next poll
  // doesn't have to wait its full second — the user gets the 3D play
  // as soon as both data + GPU are available.
  useEffect(() => {
    if (!canvasReady && liveShotId) {
      queueMicrotask(() => setRetryAttempt((a) => a + 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveShotId]);

  // Browser-fullscreen toggle so users can blow up the 3D view to fill
  // the viewport. Listens for fullscreenchange so we stay in sync if the
  // user hits Esc instead of clicking the minimize button.
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (containerRef.current) {
      containerRef.current.requestFullscreen().catch(() => {});
    }
  };

  // Resolve the current "live cinema" shot from the sticky liveShotId.
  // Drives the bottom half of the in-world jumbotron scoreboard.
  const currentShot = useMemo(() => {
    if (!liveShotId) return null;
    return shots.find((s) => s.id === liveShotId) ?? null;
  }, [shots, liveShotId]);

  // Reveal the shot result on the jumbotron ~1.1 s after the shot starts
  // (windup 0.45 s + approach 0.65 s — matches the ball's flight). For
  // shots seeded without animation, reveal immediately.
  const [showResult, setShowResult] = useState(false);
  useEffect(() => {
    if (!hideHistory || !liveShotId) {
      queueMicrotask(() => setShowResult(false));
      return;
    }
    if (newShotIds.has(liveShotId)) {
      queueMicrotask(() => setShowResult(false));
      const timer = setTimeout(() => setShowResult(true), 1100);
      return () => clearTimeout(timer);
    }
    queueMicrotask(() => setShowResult(true));
  }, [liveShotId, newShotIds, hideHistory]);

  // Compose the result payload passed into the Scene → Jumbotron.
  const currentShotResult = useMemo(() => {
    if (!currentShot || !showResult) return null;
    const isHome = currentShot.side === "home";
    const isAway = currentShot.side === "away";
    return {
      made: currentShot.made,
      isThree: currentShot.isThree,
      teamLogoTexture: isHome ? homeLogoTexture : awayLogoTexture,
      teamColor: isHome ? homeColor : isAway ? awayColor : "#888888",
      shotText: currentShot.text ?? "",
      playerName: currentShot.playerId
        ? playerNamesById[currentShot.playerId] ?? "Unknown player"
        : "Unknown player",
      jerseyNumber: currentShot.playerId
        ? playerJerseysById[currentShot.playerId] ?? ""
        : "",
    };
  }, [
    currentShot,
    showResult,
    homeLogoTexture,
    awayLogoTexture,
    homeColor,
    awayColor,
    playerNamesById,
    playerJerseysById,
  ]);

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden"
      style={{
        // In browser fullscreen, drop the aspect-ratio + max-height
        // constraints so the canvas fills the entire viewport.
        aspectRatio: isFullscreen ? undefined : "16 / 11",
        maxHeight: isFullscreen ? undefined : 640,
        height: isFullscreen ? "100vh" : undefined,
        width: isFullscreen ? "100vw" : undefined,
        background: "#0a0a14",
        borderRadius: isFullscreen ? 0 : 12,
      }}>
      <Canvas
        // key tied to retryAttempt — when WebGL fails / hasn't initialized,
        // changing the key remounts the Canvas, giving us a fresh attempt
        // at creating a context.
        key={`canvas-${retryAttempt}`}
        // Shadows disabled — they were the heaviest GPU cost in the scene
        // (shadow map per directional light, every frame, recomputed for
        // dozens of cast-shadow meshes on the player figure). Combined
        // with HMR remounts in dev, they push past the OS WebGL-context
        // budget on Windows and trigger "Context Lost". The lighting still
        // looks fine without them; the procedural court has no surfaces
        // that meaningfully benefit from shadow-mapped detail.
        // Default vantage: opposite side of the court, zoomed all the way
        // back, dropped 12 ft (= 4 × 3 ft camera-down-button steps) from
        // the prior y=23 default → y=11. Target drops to match so the
        // look angle stays the same.
        camera={{ position: [0, 11, 73], fov: 45 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        // CSS-paint the canvas dark so a lost WebGL context (or the brief
        // moment before first render) shows the same dark color as the
        // container instead of the browser's default white.
        style={{ background: "#0a0a14" }}
        onCreated={({ gl }) => {
          setCanvasReady(true);
          const canvasEl = gl.domElement;
          canvasEl.addEventListener("webglcontextlost", (e) => {
            // Prevent default lets the browser try to restore the context
            e.preventDefault();
            setCanvasReady(false);
          });
          canvasEl.addEventListener("webglcontextrestored", () => {
            setCanvasReady(true);
          });
        }}>
        <Scene
          shots={shots}
          homeColor={homeColor}
          awayColor={awayColor}
          homeSecondary={homeSecondary}
          awaySecondary={awaySecondary}
          homeLogoTexture={homeLogoTexture}
          awayLogoTexture={awayLogoTexture}
          homeLogoUrl={homeLogoUrl}
          awayLogoUrl={awayLogoUrl}
          playerNamesById={playerNamesById}
          playerJerseysById={playerJerseysById}
          playerHeadshotsById={playerHeadshotsById}
          playerHeightsById={playerHeightsById}
          newShotIds={newShotIds}
          hideHistory={hideHistory}
          liveShotId={liveShotId}
          onHover={handleHover}
          homeScore={homeScore}
          awayScore={awayScore}
          liveClock={liveClock}
          livePeriod={livePeriod}
          gameStateText={gameStateText}
          homeTimeoutsLeft={homeTimeoutsLeft}
          awayTimeoutsLeft={awayTimeoutsLeft}
          maxTimeouts={maxTimeouts}
          isGameLive={isGameLive}
          currentShotResult={currentShotResult}
          cameraDelta={cameraDelta}
          onCameraNudgeApplied={handleCameraNudgeApplied}
          isFullscreen={isFullscreen}
        />
      </Canvas>

      {/* Camera up/down side buttons — vertically centered on the right edge. */}
      <div className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 flex flex-col gap-1.5 z-30">
        <button
          type="button"
          onClick={() => setCameraDelta(CAMERA_STEP)}
          className="pointer-events-auto w-9 h-9 flex items-center justify-center rounded-full text-white/80 hover:text-white border border-white/15 hover:border-white/35 transition-colors shadow-lg"
          style={{ background: "rgba(15,15,26,0.85)", backdropFilter: "blur(6px)" }}
          aria-label="Move camera up">
          <ChevronUp size={18} />
        </button>
        <button
          type="button"
          onClick={() => setCameraDelta(-CAMERA_STEP)}
          className="pointer-events-auto w-9 h-9 flex items-center justify-center rounded-full text-white/80 hover:text-white border border-white/15 hover:border-white/35 transition-colors shadow-lg"
          style={{ background: "rgba(15,15,26,0.85)", backdropFilter: "blur(6px)" }}
          aria-label="Move camera down">
          <ChevronDown size={18} />
        </button>
      </div>

      {/* Fullscreen toggle — top-right corner. */}
      <button
        type="button"
        onClick={toggleFullscreen}
        className="absolute top-2 right-2 w-9 h-9 flex items-center justify-center rounded-full text-white/80 hover:text-white border border-white/15 hover:border-white/35 transition-colors shadow-lg z-30"
        style={{ background: "rgba(15,15,26,0.85)", backdropFilter: "blur(6px)" }}
        aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}>
        {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </button>

      {/* HTML tooltip overlay — positioned via client-space coords from R3F */}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 px-3 py-2 rounded-lg text-[11px] text-white/90 shadow-xl"
          style={{
            left: Math.max(8, Math.min(hover.x + 12, (containerWidth ?? 800) - 240)),
            top: Math.max(8, hover.y - 70),
            background: "rgba(15,15,26,0.96)",
            border: `1px solid ${hexWithOpacity(hover.color, 0.55)}`,
            maxWidth: 280,
          }}>
          <div className="flex items-center gap-2 mb-1">
            {hover.shot.playerId &&
              playerJerseysById[hover.shot.playerId] && (
                <span
                  className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-md text-[10px] font-bold tabular-nums"
                  style={{
                    background: hexWithOpacity(hover.color, 0.2),
                    color: hover.color,
                    border: `1px solid ${hexWithOpacity(hover.color, 0.5)}`,
                  }}>
                  #{playerJerseysById[hover.shot.playerId]}
                </span>
              )}
            <span className="font-bold" style={{ color: hover.color }}>
              {hover.shot.playerId
                ? playerNamesById[hover.shot.playerId] ?? "Unknown player"
                : "Unknown player"}
            </span>
            <span
              className="ml-auto text-[9px] uppercase tracking-widest font-bold"
              style={{ color: hover.shot.made ? "#22c55e" : "#ef4444" }}>
              {hover.shot.made ? "Made" : "Miss"}
            </span>
          </div>
          <div className="text-white/75 leading-snug">{hover.shot.text}</div>
          <div className="mt-1 text-[10px] text-white/40">
            {hover.shot.side === "home" ? homeName : hover.shot.side === "away" ? awayName : "—"}{" "}
            · Q{hover.shot.period} · {hover.shot.isThree ? "3PT" : "2PT"}
          </div>
        </div>
      )}

      {/* Hint overlay — fades after first interaction */}
      <div className="pointer-events-none absolute bottom-2 left-2 text-[10px] text-white/35 font-medium">
        Drag to orbit · Scroll to zoom · Right-drag to pan
      </div>

      {/* Hide-history status pill — bottom-right so it doesn't collide
          with the mini scoreboard at top-center. */}
      {hideHistory && (
        <div className="pointer-events-none absolute bottom-2 right-2 text-[10px] uppercase tracking-widest font-bold px-2.5 py-1 rounded-full"
          style={{
            background: "rgba(34,197,94,0.12)",
            color: "#22c55e",
            border: "1px solid rgba(34,197,94,0.35)",
          }}>
          {liveShotId ? "Live Cinema · last shot" : "Live Cinema · waiting for first shot"}
        </div>
      )}

      {/* Loading / status overlay — covers the canvas whenever there's
          nothing meaningful to display, or when the game itself is in a
          structural state worth calling out (pre-game, halftime, final).
          Solid dark background guarantees the user never sees a white
          WebGL canvas if it fails to render. */}
      {(() => {
        const isHalftime =
          !!gameStateText && /halftime/i.test(gameStateText);
        const noShotToShow =
          shots.length === 0 || (hideHistory && !liveShotId);

        // Decide whether to show the overlay at all.
        //   - !canvasReady forces it whenever WebGL hasn't initialized
        //     yet OR has lost its context — guarantees the user never
        //     sees the underlying white canvas pixels.
        //   - Pre-game / post-game / halftime always trigger it.
        //   - Otherwise only when there's no shot to display.
        const showOverlay =
          !canvasReady ||
          gameState === "pre" ||
          gameState === "post" ||
          isHalftime ||
          noShotToShow;
        if (!showOverlay) return null;

        // Pick the message based on the most-specific signal first.
        // !canvasReady wins because the issue is the canvas itself, not
        // the data — we want to communicate "the 3D view is loading"
        // rather than something game-state-specific.
        let title = "Hang Tight, loading…";
        let subtext: string | null = null;
        if (!canvasReady) {
          title = "Hang Tight, loading…";
          subtext = "Waiting for a Play to Happen..";
        } else if (gameState === "post") {
          title = "Live Game has Ended";
          subtext = "Final score above";
        } else if (isHalftime) {
          title = "Half Time";
          subtext = "Game resumes shortly";
        } else if (gameState === "pre") {
          title = "Waiting for Game to begin";
          subtext = gameStateText ?? "Tip-off soon";
        } else if (hideHistory) {
          title = "Hang Tight, loading…";
          subtext = "Waiting for the next live shot";
        } else {
          title = "Hang Tight, loading…";
          subtext = "Pulling shot data from ESPN";
        }

        return (
          <div
            className="pointer-events-none absolute inset-0 flex flex-col z-10"
            style={{ background: "rgba(8, 8, 16, 0.96)" }}>
            {/* Live mini-scoreboard pinned at the top of the loading
                screen so users still see the score / clock / timeouts
                while WebGL / data is loading. */}
            <div className="flex justify-center pt-4 px-4">
              <MiniScoreboard
                homeColor={homeColor}
                awayColor={awayColor}
                homeLogoUrl={homeLogoUrl}
                awayLogoUrl={awayLogoUrl}
                homeScore={homeScore}
                awayScore={awayScore}
                liveClock={liveClock}
                livePeriod={livePeriod}
                gameStateText={gameStateText}
                homeTimeoutsLeft={homeTimeoutsLeft}
                awayTimeoutsLeft={awayTimeoutsLeft}
                maxTimeouts={maxTimeouts}
                isGameLive={isGameLive}
              />
            </div>
            {/* Logo + title + subtext centered in the remaining space */}
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/synccourt-logo.jpg"
                alt="SyncCourt"
                style={{
                  width: 180,
                  height: 180,
                  opacity: 0.85,
                  borderRadius: 16,
                }}
              />
              <div className="text-white/85 text-base font-bold uppercase tracking-widest mt-2">
                {title}
              </div>
              {subtext && (
                <div className="text-white/40 text-xs max-w-xs text-center px-4">
                  {subtext}
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
