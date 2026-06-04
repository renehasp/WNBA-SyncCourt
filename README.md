# WNBA SyncCourt

A live WNBA game tracker and roster browser built with Next.js. Pulls live scores, play-by-play, box scores, team rosters, league leaderboards, and player news straight from ESPN's public API — no API keys required.

<img width="1077" height="1751" alt="image" src="https://github.com/user-attachments/assets/de642807-e366-41ca-98ee-964194ea3719" />

## What's New in v4.0

This release focuses on **code quality, stability, and modernization** after a deep audit of the v3.0 codebase. No major new user-facing features, but significant under-the-hood improvements that make the app more reliable and easier to maintain.

### Code quality & linting
- Achieved **zero ESLint errors** (was previously ~23 errors + warnings).
- Fixed multiple React 19 / Compiler violations:
  - No more accessing refs during render (fixed in 3D tooltip positioning with ResizeObserver + event-time calculations).
  - Proper handling of state updates in effects (using `queueMicrotask` to avoid synchronous setState in effects).
  - Made manual `useMemo` calls React Compiler friendly (stable primitive dependencies, fixed "memoization could not be preserved" errors).
- Modernized `PlayerModal` data loading (replaced manual `useEffect` + state + direct fetch with TanStack Query).
- Cleaned up dead code in the large `ShotChart3D.tsx` (removed unused `ShotResultBadge` component, dead `hasReachedRim` state, unused variables).

### Modernization & best practices
- Removed unused `next-themes` dependency (was declared but never used).
- Added proper `viewport` export + `themeColor` in the root layout (recommended for Next.js 16+ and PWAs).
- Bumped TypeScript `target` to `ES2022`.
- Added a root `app/error.tsx` error boundary with user-friendly reset UI for better resilience.
- Extracted a reusable `groupEventsByLocalDate` helper in `lib/utils.ts` (TZ-aware using `Intl.DateTimeFormat`) and refactored the schedule page to use it (eliminating duplication and making future date grouping consistent).
- Fixed a scope bug in team roster sorting (ppgMap) that surfaced during the audit.

### Developer experience
- Full audit using codebase knowledge graph + manual review.
- All changes verified with clean `npm run lint` and successful production builds.
- Minor cleanups across components (unused imports/vars, consistent patterns).

This makes v4.0 a solid, production-hardened foundation on top of the excellent v3.0 3D experience.

## What's New in v3.0

This is a major release focused on the new **3D Shot Chart** experience — a fully 3D arena view of the same live play data the 2D chart already shows. The 2D chart still ships unchanged for users who prefer it.

### 3D Shot Chart toggle

- **2D / 3D switch** added at the top of the Shot Chart filter row. 3D is dynamic-imported so the heavy `three` bundle (~250 KB gzip) only loads when toggled in.
- **Smart default mode**: the Shot Chart tab opens directly in **3D + LIVE** if the game is live, or **3D + Show History** otherwise. Switching tabs re-evaluates the default each time.
- The **LIVE** button is greyed out and unclickable when the game is in `pre` or `post` state — prevents being stranded on a single replay shot when no new shots can arrive. If a game ends mid-session while LIVE is on, the toggle auto-flips to Show.
- **Filter visibility**: in 3D + LIVE, the Team / Result / Period / Player filters and the shot count are hidden — LIVE locks to the most recent shot so per-team filtering would be meaningless. Filters return in 2D and in 3D + Show History.
- **Time scrubber** is 2D-only — the in-world Jumbotron's clock and period header replace it in 3D.

### Procedural 3D court

- **WNBA half-court geometry** built procedurally at 1 unit = 1 ft: 50×47 ft floor, 16×19 ft lane painted with a blend of both teams' colors, free-throw circle (solid + dashed halves following the official convention), uniform 22.15 ft 3-pt arc, 4 ft restricted area, and a midcourt half-ring.
- **Realistic backboard stanchion** — wide base anchored *behind* the baseline (out of bounds), square-cross-section pole, horizontal arm reaching forward over the court, and a diagonal brace under the arm.
- **Glass backboard** rendered with `meshPhysicalMaterial` (transmission + clearcoat). Orange perimeter frame, painted shooter's-square outline aligned with the rim height, dark padded plate on the arm side.
- **Glowing orange torus rim** with a small dark mounting bracket connecting it to the front of the backboard, and a 12-strand white net hanging below.
- **SyncCourt floor watermark** — the app logo lays on the wood at low opacity (~18%) near the front-court area as a subtle brand cue.

### Ballistic shot trajectories

- Every shot is rendered as a **quadratic Bezier arc** from a 7 ft release point to the rim. Apex height scales with shot distance, capped so half-court heaves stay on-screen.
- **Made shots** end with the ball at rest in the rim.
- **Missed shots** terminate at a rim-contact point and a dashed deflection arc shows the ball bouncing off and landing on the floor. Each shot's miss direction is hashed from its play ID so it's deterministic — the same shot always misses the same way.
- **Free throws** are now first-class — when ESPN omits a coordinate (which it usually does for FTs), the chart synthesizes a default coord at the FT line so they render in both 2D and 3D.

### Camera + interaction

- **OrbitControls** — drag to orbit, scroll to zoom, right-drag to pan. Polar angle clamped so the camera can't go below the floor.
- **Default vantage** is on the far side of the court (positive Z) at the panel's max-zoom-out distance, looking back at the scoreboard hanging over the basket. Users open zoomed-out and pan / zoom in from there.
- **Camera up/down side buttons** on the right edge of the canvas nudge the camera ±3 ft (with the OrbitControls target) like an elevator that preserves the look angle.
- **Fullscreen toggle** in the top-right uses the browser Fullscreen API. In fullscreen, OrbitControls' max zoom-out extends 50% further so users can take in the whole arena. Listens for `Esc` to keep the icon in sync.
- **Scene fog removed** — no more fade-to-black when zooming all the way out. Distant geometry stays fully lit at any camera distance.
- **Hover tooltips (2D)** lead with a jersey-number chip + player name in team color, then the play description below.

### LIVE Cinema mode (Hide History)

- **History** toggle in 3D mode: `Show` (all shots, time-scrubbable) vs `LIVE` (most-recent shot only).
- The `LIVE` label gets a green pulsing dot + fade pulse while the game is in progress.
- In LIVE mode, the court keeps **exactly one shot at a time**, displayed for **6 seconds** (animation + ~4 s dwell) before the queue advances. New incoming shots are queued chronologically so a flurry of plays plays out one-by-one with breathing room rather than blurring past.
- The figure stays in **follow-through pose** until the next shot replaces it. `liveShotId` is sticky, only swapped when the dwell expires AND there's a next shot in queue.

### Procedural player figure

- A stylized humanoid appears at the shot origin and shoots:
  - **Team-colored uniform**: jersey in primary color, shorts in secondary, white sneakers.
  - **3D jersey numbers** rendered on chest *and* back, outlined in the team's secondary color.
  - **Team logo decal** on the chest, loaded as a Three texture.
  - **Floating billboard label** above the head: `#23  Player Name`.
  - **Animated shooting motion** rigged on the shoulder: crouch → release → follow-through, synced to the ball flight via a shared progress ref.
  - **Skin tone sampled per-player** from each player's ESPN headshot pixels — the figure loads the headshot via `crossOrigin="anonymous"`, draws to a 2D canvas, samples a face-region square, filters out non-skin pixels, averages what's left, caches per URL.
  - **Height-accurate scaling** from the team roster — 5'8" players come out shorter than 6'7" players. Defaults to 6'2" (74 in) when ESPN has no height.

### In-world Jumbotron scoreboard

- A large **3D arena scoreboard** hangs above and behind the rim. **Stationary** (faces +Z toward the court interior) — no longer a Billboard, so there's a fixed "front" and the camera defaults to viewing it head-on.
- **Pulsing team-color frame** — outer border lerps between black and the shooting team's primary color via `useFrame`, ~0.4 Hz sine wave. Goes grey before any shot lands.
- **Top half**: away logo + scores · period + live clock with green live dot · home score + home logo. Game-state line ("HALFTIME", "FINAL", "TEAM TIMEOUT", etc.). Timeout-dot rows per team.
- **Bottom half**: jersey-chip + player name on top, then a result row with **emoji + points text + team logo** (🎯 `3 POINTS`, 🏀 `2 POINTS`, 🔥 `SLAM DUNK`, ✓ `1 POINT` for FT made, ❌ `MISS`), then the **shot type** at the bottom (Slam dunk, Tip-in, Alley-oop, Layup, Pull-up jumper, etc.) with **free-throw context** appended (`Free throw · 1 of 2`).
- Emojis are rendered via a `CanvasTexture` (drawn into a 2D canvas with the system color-emoji font, then mapped onto a plane) since drei's SDF-font `<Text>` can't render colored emoji glyphs.

### Stoppage / game-state detection

- New `gameStateLabel` derived in the game page from the most recent visible play's text. Classifies the live stoppage into:
  - TV / Team / Reset / generic Timeout
  - Technical / Flagrant / Shooting / Loose Ball / Offensive / Personal / generic Foul
  - Replay Review, Injury Stoppage, Jump Ball
- Halftime / End-of-period / Final from `liveStatus.type.shortDetail` always wins (structural state beats stale play classification).
- The label feeds the Jumbotron's status line, so during a stoppage the user sees "TEAM TIMEOUT" or "SHOOTING FOUL" right under the clock.

### Loading screen / WebGL resilience

- **Solid dark loading overlay** with the SyncCourt logo covers the canvas any time WebGL isn't ready, so users never see a white screen while the GPU spins up. Title is `Hang Tight, loading…`; subtext adapts to the situation.
- **Live mini-scoreboard** pinned to the top of the loading screen — scores / clock / period / timeouts keep updating in real time even while the 3D view is loading.
- **Game-state-aware messages**: `Live Game has Ended`, `Half Time`, `Waiting for Game to begin` replace the generic loading copy when those states apply.
- **Auto-retry**: while WebGL hasn't initialized, the Canvas is force-remounted every second by bumping its React `key`. Each remount creates a fresh context-creation attempt; the moment one succeeds, `onCreated` fires, the retry loop stops, and the 3D view fades in. New shot arrival also fast-tracks the next retry.
- **Context-loss listener** flips canvas-ready to false on `webglcontextlost`, restores it on `webglcontextrestored`.

### Spoiler-veil aware

- All 3D data (shots, scores, clock, period, timeouts, stoppage label, live-cinema queue) flows through the same `visiblePlays` and `delayedView` that drive the rest of the app. Set the broadcast delay in the spoiler controls and the 3D view shows that delayed state — same as the 2D chart and play-by-play feed.

### Game-page wiring

- Two new React Query fetches (`/api/wnba/teams/[id]`) load home and away team rosters with a 1-hour staleTime — derives `playerHeightsById`, `playerJerseysById`, and `playerHeadshotsById` for the 3D figure.
- Live game state (clock, period, scores, timeouts, status) is passed into the Shot Chart so the 3D scoreboard mirrors the main `ScoreboardHero`.

### Performance + safety

- 3D bundle is **dynamic-imported with `ssr: false`** — 2D-default users never download it.
- Canvas runs **without shadow-mapping** (was the heaviest GPU cost), with `dpr` capped at 1.5, and `powerPreference: high-performance` for predictable Windows GPU behavior.
- `TABS.Icon` typing in the game page tightened from `React.ElementType` to `React.ComponentType<{ size?: number }>` — installing R3F augments `JSX.IntrinsicElements` with primitives like `<mesh>` that don't accept a `size` prop, which would otherwise collapse `ElementType`'s prop intersection to `never`.

### Other UI polish in this release

- **`DarkSelect` component** — a Radix-Select-based wrapper that replaces every native `<select>` in the app (Shot Chart player filter, Play-by-Play player + play-type filters, Settings time zone + favorite team). Native dropdowns inherited OS styling and painted white backgrounds; `DarkSelect` keeps the dropdown panel on-theme with a dark frosted background, white-translucent border, purple-tinted selection, and group labels for category headers.
- **Removed** the per-team FG / 3PT summary chips that previously sat at the top of the Shot Chart — the same data is visible in the box-score tab.

### Dependencies added

- `three` ^0.184.0
- `@react-three/fiber` ^9.6.1 (React 19 compatible)
- `@react-three/drei` ^10.7.7
- `@types/three` ^0.184.1 (dev)

## What's New in v1.2

- **Team page popup menu** — on the individual team detail page (`/teams/[id]`), clicking the team name reveals a popup menu with quick links to the official WNBA team page, ESPN team page, and Wikipedia page for that team.
- **Fixed WNBA team links** — all WNBA team page links now use the correct URL format with team IDs (e.g. `https://www.wnba.com/team/1611661325/indiana-fever`), ensuring they resolve properly instead of returning "page not found."
- **Improved popup positioning** — the team info popup is intelligently positioned to the left of the team name to prevent clipping on smaller viewports or constrained container widths.

## What's New in v1.1

- **Box score team totals** — a bold Totals row at the bottom of each team's box score aggregates points, rebounds, assists, steals, blocks, turnovers, fouls, FG/3PT/FT fractions, and minutes.
- **Play-by-play filters** — filter the live play feed by individual player (dropdown) or by play type (multi-select chips: 3PT, Dunk, Steal, Block, etc.). A live count badge shows how many plays match; a Clear button resets everything.
- **Sticky mini scoreboard** — once you scroll past the main scoreboard on a game page, a compact score bar slides down and sticks to the top, showing team logos, current score, period, and clock. Dismiss it any time with the × button.
- **Full team names everywhere** — team cards and the scoreboard now show the full name (e.g. *Indiana Fever*) alongside the logo. Clicking the name opens the official WNBA team page in a new tab.
- **Richer player cards** — the quick-look player modal now includes a Career section: years of WNBA experience, college, hometown, height, and weight, pulled live from ESPN.
- **New app logo** — replaced the generic basketball icon with a custom SyncCourt mark; updated the PWA icon and navbar.

## Features

- **Live games dashboard** (`/`) — every WNBA game today with live scores, period/clock, and team-color theming. Cards involving your favorite team get a soft yellow accent.
- **Game page** (`/game/[id]`)
  - **Animated scoreboard** with team-color theming, large team-logo watermarks, and timeout dot trackers. The team-logo rings are clickable links to each team's page.
  - **Spoiler veil aware:** when broadcast delay or TV-sync mode is active, both the score and a second clock above the live one (yellow for delay, blue for TV-synced) display the **delayed** state. The live clock and live period stay visible underneath as a faded reference.
  - **Play-by-play feed** with player avatars, team-logo background watermarks, and a "Today's Stats" modal that opens when you tap an avatar.
  - **Live box score** with sortable columns (PTS / REB / AST / STL / BLK / TO / PF / FG / 3PT / FT / MIN) plus an Impact composite. Each player row's photo + name links to the full player page; clicking the stat cells opens the quick-look modal.
  - **Shot chart** — proper half-court SVG with WNBA geometry (16×19 ft lane, 22.15 ft uniform 3-pt arc), filled-dot makes / X-mark misses **color-coded by team**, per-team FG and 3PT summaries at the top, Team / Result / Period / **Player** filters, and a **time scrubber** with Q1/Q2/Q3/Q4/OT/Live tick markers (clickable to jump). Pinning the slider to the right keeps it on the live (veil-respecting) edge.
  - **3D shot chart (v3.0)** — toggle from `2D` to `3D` to fly into a procedural arena view: ballistic shot arcs, glass backboard, glowing rim, OrbitControls camera. Flip History to `LIVE` and a height-accurate procedural player figure appears at the shot origin in their team's uniform with their jersey number, shoots, and stays in follow-through pose until the next live shot. An in-world Jumbotron above the rim shows the live scoreboard + most-recent shot's result and shot type. See *What's New in v3.0* above for the full feature list.
- **Spoiler veil** — broadcast delay slider that buffers plays so play-by-play can be replayed alongside a delayed TV feed.
- **Teams browser** (`/teams`) — every WNBA team as a color-themed card with a search dropdown that finds any player by first or last name. Favorite team's card and favorite team's players in search results are tinted yellow.
- **Team page** (`/teams/[teamId]`) — team header with record + standing, full roster sorted MVP → bench by season PPG, with 🏆🥈🥉 podium emojis for the top 3 scorers and 🐣 / 🤕 markers for rookies and currently-injured players.
- **Player page** (`/teams/[teamId]/players/[playerId]`) — large headshot, position, team, health/injury status (with body part, side, and estimated return date when available), season averages with hover-to-reveal stat names, ESPN news section (with thumbnails, descriptions, source link, and relative timestamps).
- **League leaderboards** (`/leaders/[stat]`) — click any stat on a player page (PTS, REB, AST, FG%, etc.) to see the league-wide ranking with podium emojis for the top 3. Favorite team's players are tinted yellow.
- **Schedule** (`/schedule`) — upcoming games for the next 30 days, grouped by date in the user-selected time zone. Each card shows the visiting + home team logos, tip-off time, venue, city, and broadcast networks. Games involving your favorite team get a yellow accent.
- **Settings** (`/settings`) — accessed via the cog icon in the navbar:
  - **Font size** (85% – 150%) applied at the root html font-size; scales every rem-based UI element across every page. Persisted across reloads.
  - **Time zone** dropdown (Eastern / Central / Mountain / Pacific / etc., or device default). Drives all date/time displays on the schedule page.
  - **Favorite team** dropdown — picks one WNBA team for personalized highlights. The team and its players are tinted **light yellow** in lists across the app (teams grid, schedule, leaderboards, search, home page game cards).

## Tech stack

- [Next.js 16](https://nextjs.org/) with the App Router
- React 19, TypeScript
- Tailwind CSS v4
- [TanStack Query](https://tanstack.com/query) for server state
- [Framer Motion](https://www.framer.com/motion/) for animations
- [Zustand](https://github.com/pmndrs/zustand) for spoiler-veil state
- [Three.js](https://threejs.org/) + [React Three Fiber](https://r3f.docs.pmnd.rs/) + [drei](https://drei.docs.pmnd.rs/) for the 3D shot chart (dynamic-imported)
- [Lucide](https://lucide.dev/) icons
- ESPN's public WNBA endpoints (no key required)

<img width="1465" height="847" alt="image" src="https://github.com/user-attachments/assets/be87a51a-0fe9-469b-80f5-694563864361" />



## Prerequisites

- **Node.js 20+** (the project was developed against Node 24)
- **npm** (or yarn / pnpm / bun — examples below use npm)

## Getting started

```bash

# 1. Install OpenJS
  winget install OpenJS.NodeJS.LTS
  open a new terminal window after it finishes

# 2. Clone
git clone https://github.com/renehasp/WNBA.git
CHANGE DIRECTORY TO WNBA-SyncCourt

# 3. Install dependencies
winget install OpenJS.NodeJS.LTS
  open a new terminal window after it finishes
  npm install
  npm audit fix --force

# 4. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — the dev server hot-reloads on file changes.

> **Windows users:** there's also a `run.bat` in the project root that runs `npm run dev` if you'd rather double-click it.

## Docker

The project includes a `docker-compose.yml` for both development and production environments.

> **Note:** These commands use `docker compose` (the newer built-in syntax). If you have an older Docker version, use `docker-compose` instead, or install it with `apt install docker-compose` on Ubuntu/Debian or via your package manager.



### Development with Docker

Run the dev server with hot reload inside a container:

```bash
docker compose up app-dev
```

The dev server will start on [http://localhost:3000](http://localhost:3000) and automatically reload when you change files (volumes are mounted for live editing).

### Production with Docker

Production pull latest with Docker in ubuntu
```bash
git pull origin main && docker compose --profile prod up --build app-prod
From https://github.com/renehasp/WNBA-SyncCourt
```


Build and run the optimized production image:

```bash
docker compose --profile prod up app-prod
```

The production server will be available at [http://localhost:1997](http://localhost:1997).

To rebuild the production image after changes:

```bash
docker compose --profile prod up --build app-prod
```

### Stopping Docker containers

```bash
# Stop dev server
docker compose down

# Stop production server
docker compose --profile prod down
```

### Using docker-compose (legacy command)

If your system has the older `docker-compose` command instead of `docker compose`, simply replace `docker compose` with `docker-compose` in any of the commands above:

```bash
# Examples
docker-compose up app-dev
docker-compose --profile prod up app-prod
docker-compose down
```

## Run on your phone (LAN access)

You can browse the dev server from any phone or tablet on the same Wi-Fi.

1. **Find your PC's local IP** (`ipconfig` on Windows, `ifconfig` / `ip a` on macOS / Linux). Look for an `IPv4 Address` on your Wi-Fi adapter, e.g. `192.168.1.42`.
2. **Start the dev server bound to all interfaces:**
   ```bash
   npm run dev -- -H 0.0.0.0
   ```
3. **Allow port 3000 through your firewall.** Windows usually pops a prompt the first time. If you missed it, run this once as admin:
   ```cmd
   netsh advfirewall firewall add rule name="Next dev 3000" dir=in action=allow protocol=TCP localport=3000
   ```
4. **On your phone**, open `http://192.168.1.42:3000` (your actual IP). HMR works — edit on the PC, the phone refreshes.

`next.config.ts` already lists `192.168.*.*` and `100.64.*.*` (Tailscale CGNAT) under `allowedDevOrigins`, which is required by Next.js 15+ for cross-origin dev resources. Add your own subnet there if needed.

### Install as a PWA on Android

The app ships with a basic web app manifest (`public/manifest.json`) and an SVG icon (`public/icon.svg`).

- Open the app in Chrome on Android.
- Tap **⋮ menu → Install app** (or **Add to Home screen**).
- It launches like a standalone app, full-screen, no browser chrome.

For real public-internet access, deploy to [Vercel](https://vercel.com/new) — push `main` and import the repo, no config needed. Vercel gives you a free HTTPS URL accessible anywhere.

## Available scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Next.js dev server on port 3000. |
| `npm run dev -- -H 0.0.0.0` | Same, but listening on all network interfaces (for phone / LAN access). |
| `npm run build` | Production build. |
| `npm run start` | Run the production build (after `npm run build`). |
| `npm run lint` | Run ESLint. |

## Configuration

No `.env` file is required for normal use — the app talks to ESPN's public APIs through proxy routes under `/api/wnba/*`.

The proxy routes cache responses (5–60 minutes depending on volatility) so a busy page (e.g. `/teams` with 14 roster fetches behind it) only hits ESPN once until the cache expires.

### Optional: refresh player headshots

The navbar has a small refresh button that calls `POST /api/wnba/headshots/refresh`. It downloads every WNBA player's headshot to `public/headshots/` so they can be served locally instead of hot-linking ESPN's CDN. The cache directory is gitignored. Missing-headshot URLs are short-circuited with a transparent 1×1 PNG cached for 24h, so dev-server logs stay clean.

### Allowing more LAN devices

If your phone is on a non-standard subnet (a guest network, a VPN, etc.), you'll see a **"Blocked cross-origin request to Next.js dev resource"** warning on first load. Add the host to `next.config.ts`:

```ts
allowedDevOrigins: [
  "192.168.1.244",
  "192.168.*.*",
  "100.64.*.*",     // Tailscale / CGNAT
  "10.0.0.*",       // common alternate home subnet
],
```

Wildcards work; CIDR ranges (`/24`, etc.) do not — use `*` instead.

## Project layout

```
app/
├─ page.tsx                         live games dashboard
├─ game/[id]/page.tsx               game detail page (scoreboard, plays, box, shot chart)
├─ teams/page.tsx                   teams grid + player search
├─ teams/[teamId]/page.tsx          team detail + roster
├─ teams/[teamId]/players/[id]/page.tsx   player profile + season averages + news
├─ leaders/[stat]/page.tsx          league leaderboard for one stat
├─ schedule/page.tsx                upcoming games (TZ-aware, grouped by date)
├─ settings/page.tsx                font size, time zone, favorite team
└─ api/wnba/                        ESPN proxy routes
   ├─ scoreboard, summary, schedule, headshot, headshots/refresh
   ├─ teams, teams/[id], teams/[id]/leaders
   ├─ athletes/[id], players (aggregated), injuries, leaders

components/
├─ Navbar, GameCard, ScoreboardHero, LiveBoxScore, PlayByPlayFeed
├─ ShotChart (2D half-court + scrubber + player filter)
├─ ShotChart3D (R3F scene: court, backboard, ballistic arcs, player figure,
│              in-world jumbotron — dynamic-imported, ssr:false)
├─ PlayerModal, PlayerSearch, SpoilerVeilControls, Providers (with FontScaleApplier)

hooks/        useLiveGames, useGameData, useSpoilerDelay
lib/          espn (types + fetchers), teams (color palette), spoiler-engine, utils
store/        useAppStore (Zustand) — spoiler/sync mode + delay + fontScale +
              timeZone + favoriteTeamId, all persisted to localStorage
public/       icon.svg (PWA), manifest.json
```

## Data source & attribution
<img width="1073" height="1281" alt="image" src="https://github.com/user-attachments/assets/d5204def-f2bd-46d9-b4c2-1d8d1e72f555" />

All sports data and images come from [ESPN's public WNBA endpoints](https://www.espn.com/wnba/). News articles link back to the original ESPN article in a new tab. This project is unaffiliated with ESPN or the WNBA.

Copyright 2026 NBA Media Ventures, LLC. All rights reserved. No portion of WNBA.com may be duplicated, redistributed or manipulated in any form.

## License

This is a personal project — no license attached. If you fork or reuse it, please respect ESPN's terms of service for the underlying data.
