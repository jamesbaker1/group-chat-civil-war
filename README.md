# GROUP CHAT CIVIL WAR ⚔️

Philadelphia vs New York sports-trivia war game for a basketball group chat. Civil-War themed.
The war is fought — as is historically accurate — **over New Jersey**. Cloudflare Workers + D1.

> *"Brother against brother. Cheesesteak against bacon-egg-and-cheese."*

- **Philadelphia** = The Brotherly Love Brigade 🔔 (midnight green / silver)
- **New York** = The Empire Army 🗽 (navy / orange)

Enlist once, play 10-question timed **skirmishes**, push your army's total. The **front line** (a tug-of-war
across a stylized New Jersey corridor) moves on the ratio of army scores over the **last 7 days**. Every battle
generates a **War Dispatch** you copy-paste into the chat to talk trash.

## Quickstart (5 lines)

```bash
npm install
npx wrangler d1 create civil-war-db                 # copy the returned database_id into wrangler.jsonc
npx wrangler d1 migrations apply civil-war-db --remote   # run migrations/0001_init.sql
npx wrangler deploy                                  # ship it
# (local dev: `npx wrangler dev` after `... migrations apply civil-war-db --local`)
```

After `d1 create`, paste the real `database_id` into `wrangler.jsonc` (replace the
`00000000-0000-0000-0000-000000000000` placeholder). Assets in `public/` are served automatically.

## Reset the war

Wipe all scores/soldiers but keep the schema:

```bash
npx wrangler d1 execute civil-war-db --remote --command "DELETE FROM battles; DELETE FROM players;"
```

Or nuke and recreate: `npx wrangler d1 delete civil-war-db` then repeat the create + migrate steps.
(Players whose records vanish are prompted to re-enlist on next visit.)

## Where to edit questions

The bank lives in `data/questions/*.json` and is **compiled into the Worker** (imported as JSON modules — no
runtime fetch). Four files:

| file | category | count | choices |
|---|---|---|---|
| `trivia.json` | `trivia` | 60 | 4 |
| `who-said-it.json` | `quote` | 40 | 4 (quote is the prompt, choices are people) |
| `headlines.json` | `headline` | 30 | 2 — `["Real","Fake"]` |
| `stat-duel.json` | `stat` | 30 | 2 |

Each question: `{ id, category, city (PHI|NY|BOTH), prompt, choices[], answer_index, flavor, roast, difficulty }`.
The loader (`src/questions.js`) tolerates an empty/partial bank without crashing; if the bank has **fewer than 10
questions**, `POST /api/battle/start` returns a 503 ("the armory is still being stocked"). Edit the JSON, redeploy.

`GET /api/health` reports bank size + integrity (counts by category/city, skipped invalid/duplicate ids) and
never leaks answers.

## How it works (tech)

- **`src/index.js`** — the Worker. API routes + static-asset passthrough. **Server-side scoring only**: the
  client never receives `answer_index` / `flavor` / `roast` in `/api/battle/start`; it gets them only after
  submitting each answer.
- **`src/questions.js`** — merges + integrity-checks the bank.
- **`public/`** — vanilla HTML/CSS/JS parchment SPA (no framework, no build step).
- **`migrations/0001_init.sql`** — D1 schema (`players`, `battles`).

### Scoring & rules

- 20s timer per question. Correct = `100 + round(100 * remaining_ms / 20000)` (max 200). Wrong/timeout = 0.
- **Espionage bonus**: a correct answer about the *enemy* city → +50 (labeled in UI + dispatch).
- Server caps `elapsed_ms` at 20000, ignores already-answered questions (idempotent), rejects answers to
  battles older than 30 min, and counts unanswered questions as casualties at finish.
- **Ranks** (cumulative all-time): Private 0 · Corporal 1,000 · Sergeant 2,500 · Lieutenant 5,000 ·
  Captain 10,000 · Major 20,000 · Colonel 35,000 · General 50,000.
- **Front math**: `position = 50 + 50 * (PHI7d - NY7d) / max(PHI7d + NY7d, 1)`, clamped 5..95; >50 = Philly
  gaining ground (pushing right toward NY).

## API

| method | route | purpose |
|---|---|---|
| POST | `/api/enlist` | `{name, army, playerId?}` → `{player}` (re-enlist updates name/army) |
| GET | `/api/me?playerId=` | `{player, rank, totalScore, battles, nextRank}` |
| GET | `/api/war` | front position/town, 7-day + all-time army totals, soldiers, traitors, recent |
| GET | `/api/war/report` | server-rendered "War Report" text for copy-to-chat |
| POST | `/api/battle/start` | `{playerId}` → `{battleId, battleName, questions[]}` (NO answers) |
| POST | `/api/battle/answer` | `{battleId, playerId, questionId, choiceIndex, elapsedMs}` → result |
| POST | `/api/battle/finish` | `{battleId, playerId}` → score, casualties, frontDelta, rankUp, dispatchText |
| GET | `/api/health` | bank readiness + integrity (no answers) |

When D1 is unreachable the API returns a 503 with a "📡 telegraph lines are down" message; the UI shows a toast.
