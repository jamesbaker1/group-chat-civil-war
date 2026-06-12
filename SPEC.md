# GROUP CHAT CIVIL WAR — Build Spec

**One-liner:** Philly vs New York sports-trivia war game for a basketball group chat. Civil-War themed.
The war is fought — as is historically accurate — **over New Jersey**. Deployed on Cloudflare Workers.

**Tagline (show on enlist screen):** *"Brother against brother. Cheesesteak against bacon-egg-and-cheese."*

---

## 1. Concept

- Two armies. Philadelphia = **The Brotherly Love Brigade** (🔔, colors: midnight green/silver accents). New York = **The Empire Army** (🗽, colors: navy/orange accents).
- Players **enlist** once: enter a name, pick an army. Stored server-side + localStorage. No auth, no passwords. This is a ~12-person group chat, keep friction at zero.
- Core loop: play a **Skirmish** = 10 timed trivia questions. Points push your army's total. The **front line** (a tug-of-war bar across a stylized New Jersey corridor) moves based on the ratio of army totals over the **last 7 days** (rolling window so the war stays alive; all-time totals shown separately).
- Each skirmish gets a generated name: "The Battle of {random NJ town}" — Camden, Cherry Hill, Trenton, Princeton, New Brunswick, Edison, Rahway, Newark, Hoboken, Weehawken, Secaucus, Bayonne, Perth Amboy, Hackensack, Atlantic City, Asbury Park.
- Tone: 1860s war-dispatch English colliding with modern sports trash talk. Telegram/dispatch framing everywhere ("DISPATCH FROM THE FRONT", "casualty reports", "obituaries" for wrong answers). Funny > polished. Never mean-spirited about real tragedies; punch at sports failures only.

## 2. Screens (single-page app, vanilla JS, mobile-first — group chat = phones)

1. **Enlistment** (first visit): name input + two big army buttons. Flavor text under each (e.g. PHI: "We threw snowballs at Santa and we'd do it again." NY: "Home of 27 rings and the world's most expensive sadness (the Knicks).") After enlisting → War Room.
2. **War Room** (home): 
   - Front-line bar: stylized horizontal NJ corridor, Philly on left, NYC on right, front position marker with current held town labeled ("The front currently lies at TRENTON").
   - Big "⚔️ START SKIRMISH" button.
   - Leaderboards (tabs): **Soldiers** (individual all-time score, rank insignia, army emoji, battles fought), **The War** (army totals: 7-day and all-time), **Traitor Watch** (most wrong answers about your OWN city's teams — label: "Suspected of aiding the enemy").
   - Player's own rank card: rank title + insignia, total score, next-rank progress bar.
3. **Battle**: one question at a time. 20-second timer bar (musket-fuse styled). 10 questions. Category badge shown ("WHO SAID IT", "STAT DUEL AT DAWN", "REAL OR FAKE HEADLINE", "TRIVIA"). After each answer: instant feedback — correct: flavor line + points (+ "🕵️ ESPIONAGE BONUS" tag when it was an enemy-city question); wrong: the **obituary/roast line** in a dispatch box ("☠️ CASUALTY REPORT: …"). Then auto-advance after ~2.5s (tap to skip wait).
4. **After-Action Report**: battle name, score, X/10 correct, casualties list (the questions missed, with correct answers), points earned for the army, front-line movement caused ("The front advances 1.2 miles toward New York"), rank-up announcement if crossed a threshold (big moment: "FIELD PROMOTION: You are now a SERGEANT"), and the **share button** (see §5).

## 3. Game rules

- 10 questions per skirmish, drawn server-side: random but balanced — at least 3 about each city, at least 3 categories represented. Avoid repeats: exclude question ids the player saw in their last 3 battles (track in D1; if pool exhausted, allow repeats).
- Timer: 20s per question. Points for a correct answer: `base 100 + speed bonus round(100 * remaining_ms / 20000)` → max 200. Wrong/timeout = 0.
- **Espionage Bonus**: correct answer on a question whose `city` is the ENEMY city → +50 flat, labeled in UI.
- Server-side scoring only. The client NEVER receives `answer_index`/`roast`/`flavor` with the question — only after submitting. Server stores battle state, computes points, caps `elapsed_ms` at 20000, ignores answers for already-answered questions, rejects answers to battles older than 30 min.
- **Ranks** (cumulative all-time score): Private 0, Corporal 1,000, Sergeant 2,500, Lieutenant 5,000, Captain 10,000, Major 20,000, Colonel 35,000, General 50,000. Insignia = simple unicode/emoji chevrons (e.g. ▪, ▪▪, ▪▪▪, ★…) — no image assets.

## 4. Question bank

Lives in `data/questions/*.json`, compiled into the Worker (imported as JSON modules — no runtime fetch). Four files:

| file | category key | count | format |
|---|---|---|---|
| `trivia.json` | `trivia` | 60 | 4 choices |
| `who-said-it.json` | `quote` | 40 | 4 choices (the quote is the prompt; choices are people) |
| `headlines.json` | `headline` | 30 | 2 choices: ["Real", "Fake"] |
| `stat-duel.json` | `stat` | 30 | 2 choices (the two compared things; prompt asks which is higher) |

Question object schema (identical across files):
```json
{
  "id": "trivia-001",           // "<category>-<zero-padded n>", unique across ALL files
  "category": "trivia",          // trivia | quote | headline | stat
  "city": "PHI",                 // PHI | NY | BOTH  (which city's teams the question is about)
  "prompt": "string",
  "choices": ["A","B","C","D"],  // 2 or 4 entries per category table above
  "answer_index": 0,
  "flavor": "shown when correct — short, funny, dispatch-toned",
  "roast": "shown when wrong — the obituary. Funny, specific, dispatch-toned.",
  "difficulty": 1                // 1 easy, 2 medium, 3 hard
}
```

Content rules:
- Audience is a **basketball** group chat: ~40% of trivia/quotes/stats should be NBA (Sixers/Knicks/Nets), rest spread across NFL (Eagles/Giants/Jets), MLB (Phillies/Yankees/Mets), NHL (Flyers/Rangers/Islanders), and city culture (cheesesteaks, bodegas, Rocky, subway, Wawa).
- Facts must be REAL and verifiable — famous, settled facts (championships, draft years, famous plays, retired numbers, infamous quotes). No stats that drift with active seasons unless phrased as "career" totals of retired players or pinned to a season ("In the 2015-16 season…").
- Fake headlines must be invented-but-plausible AND funny; real headlines must be actual famous ones (e.g. butt-fumble coverage, "Process" era, snowballs at Santa, Carmelo trade sagas).
- Roasts are the soul of the game. Style: *"☠️ Here lies Private {nothing — server doesn't know names in content}, who believed the Giants play in New York. They play in New Jersey. Which is, of course, what this war is about."* Write them generic (no name placeholder needed; UI adds framing).
- Difficulty mix per file: ~40% easy / 40% medium / 20% hard.

## 5. The Share Dispatch (CRITICAL FEATURE)

After every battle, a **"📜 COPY WAR DISPATCH"** button copies a plain-text block to the clipboard (use `navigator.clipboard.writeText`, with a fallback `<textarea>` select-copy, and a visible "copied ✔" confirmation). Format (single text block, emoji included, designed to look great pasted into iMessage/WhatsApp):

```
⚔️ WAR DISPATCH — Battle of Trenton ⚔️
Sgt. Jimmy of the Brotherly Love Brigade 🔔
Score: 1,240 (8/10 correct) — 2 casualties
🕵️ Espionage bonus x2 (knows the enemy too well)
The front advances toward NEW YORK. 🗽 hold Newark — for now.
Enlist or surrender: {APP_URL}
```

Vary the last taunt line based on outcome (a small pool of lines for: great score / mid score / disgraceful score, e.g. disgraceful: "A score this low constitutes desertion. The firing squad has been notified."). Include the deployed URL so new chat members can enlist.

Also: a "📜 COPY WAR REPORT" button in the War Room that copies the current standings (front position, top 3 soldiers, army totals) for posting whenever the chat needs stirring up.

## 6. Tech stack & layout

- **Cloudflare Worker** (plain modules Worker, no framework needed — Hono allowed if it keeps code cleaner) + **static assets** via wrangler `assets` config + **D1** for persistence.
- No build step for the frontend (plain HTML/CSS/JS in `public/`). No frontend framework. Keep the Worker in TypeScript if convenient, plain JS also fine — but NO bundler config beyond what wrangler does natively.
- Project layout:
```
wrangler.jsonc          # name: "group-chat-civil-war", assets binding, D1 binding "DB", compatibility_date current
package.json            # devDep: wrangler only (plus vitest if tests are written)
src/index.(ts|js)       # Worker: API routes + serves assets
src/questions.(ts|js)   # imports the 4 JSON files, exports merged bank + integrity check
data/questions/*.json   # the 4 category files
migrations/0001_init.sql
public/index.html, public/app.js, public/style.css
README.md               # what it is + how to run/deploy/reset the war
```
- D1 schema (migrations/0001_init.sql):
```sql
CREATE TABLE players (
  id TEXT PRIMARY KEY,            -- crypto.randomUUID()
  name TEXT NOT NULL,             -- 1..20 chars, trimmed; uniqueness NOT enforced (it's a small chat)
  army TEXT NOT NULL CHECK (army IN ('PHI','NY')),
  created_at INTEGER NOT NULL
);
CREATE TABLE battles (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  battle_name TEXT NOT NULL,
  question_ids TEXT NOT NULL,     -- JSON array of 10 ids
  answers TEXT NOT NULL DEFAULT '{}',  -- JSON object qid -> {choice, points, correct}
  score INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  own_city_misses INTEGER NOT NULL DEFAULT 0,   -- for Traitor Watch
  completed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_battles_player ON battles(player_id, created_at);
```
- API (all JSON; player identified by `playerId` in body/query — fine for this trust level):
  - `POST /api/enlist {name, army}` → `{player}` (also returns existing player if the same localStorage id re-enlists — client sends `playerId` if it has one)
  - `GET /api/me?playerId=` → `{player, rank, totalScore, nextRank}` 
  - `GET /api/war` → `{front: {position 0..100, town, sevenDay: {PHI, NY}, allTime: {PHI, NY}}, soldiers: [{name, army, rank, totalScore, battles}], traitors: [{name, army, ownCityMisses}]}`
  - `POST /api/battle/start {playerId}` → `{battleId, battleName, questions: [{id, category, city, prompt, choices}]}` — NO answers.
  - `POST /api/battle/answer {battleId, playerId, questionId, choiceIndex, elapsedMs}` → `{correct, answerIndex, points, espionage, flavor|roast}`
  - `POST /api/battle/finish {battleId, playerId}` → `{score, correctCount, casualties: [...], frontDelta, rankUp: null|{from,to}, dispatchText}` — dispatchText is server-rendered so taunt logic lives in one place.
- Front position math: `position = 50 + 50 * (PHI7d - NY7d) / max(PHI7d + NY7d, 1)`, clamped 5..95. Map position to the NJ town list (PHI pushing right = toward NY). Position > 50 means Philly is winning ground.
- Unanswered questions when a battle finishes count as misses (0 points, casualty).

## 7. Visual style

- Civil-war parchment aesthetic: aged-paper background (CSS gradients/noise, no image files), ink-brown text, wax-seal red accents, army colors for the two sides. Google Fonts: **"Rye"** or **"IM Fell English"** for headers, a readable serif (e.g. "Crimson Text") for body. Load via fonts.googleapis.com link tags.
- Mobile-first (max-width container ~480px, scales up fine on desktop). Big tap targets. The timer is a burning-fuse bar. Buttons look like dispatch stamps/wax seals.
- Small touches: section headers like "☆ MUSTER ROLL ☆" (leaderboard), "⚜ THE FRONT ⚜"; a marquee-style ticker of recent battle results in the War Room ("Pvt. Dave fell at the Battle of Rahway — 3/10").
  (Recent battles: derive from the battles table, last 8 completed.)

## 8. Quality bar

- Server must never leak answers pre-submission (check the /battle/start payload).
- Handle: double-submit of same question (idempotent), battle finish with missing answers, empty leaderboards (funny empty states: "No soldiers have yet enlisted. The war awaits."), name XSS (escape all user strings in HTML — use textContent, never innerHTML with user data), D1 unavailable (show a "telegraph lines are down" error toast).
- `npx wrangler deploy --dry-run` must pass. If vitest tests are written, they must pass; do not add heavy test infra.
- README: 5-line quickstart (create D1 db, run migration, deploy), how to reset the war (delete/recreate D1 or a wipe SQL), where to edit questions.
