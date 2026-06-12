// GROUP CHAT CIVIL WAR — Cloudflare Worker
// Philly (Brotherly Love Brigade 🔔) vs New York (Empire Army 🗽), fought over New Jersey.
// Server-side scoring only. The client never sees answer_index/flavor/roast pre-submit.

import { BANK, questionById, bankReady, publicQuestion, integrity } from "./questions.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QUESTIONS_PER_BATTLE = 10;
const TIMER_MS = 20000;
const BASE_POINTS = 100;
const MAX_SPEED_BONUS = 100;
const ESPIONAGE_BONUS = 50;
const BATTLE_STALE_MS = 30 * 60 * 1000; // 30 minutes
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const ARMIES = {
  PHI: { name: "Brotherly Love Brigade", emoji: "🔔", short: "PHI" },
  NY: { name: "Empire Army", emoji: "🗽", short: "NY" },
};

// NJ corridor. Index 0 = deep Philly side, last = deep NY side.
// Front position 0..100 maps across this list (PHI pushing right toward NY).
// ODD length (15) on purpose: a dead-center position (50) lands on the exact
// middle town (Rahway, index 7) for a neutral, off-no-one's-side opening map,
// instead of skewing toward the NY side via Math.round(6.5)=7.
const NJ_TOWNS = [
  "Camden",
  "Cherry Hill",
  "Trenton",
  "Princeton",
  "New Brunswick",
  "Edison",
  "Metuchen",
  "Rahway",
  "Perth Amboy",
  "Bayonne",
  "Secaucus",
  "Weehawken",
  "Hoboken",
  "Newark",
  "Hackensack",
];

// Battle-name town pool (spec §1 list).
const BATTLE_TOWNS = [
  "Camden",
  "Cherry Hill",
  "Trenton",
  "Princeton",
  "New Brunswick",
  "Edison",
  "Rahway",
  "Newark",
  "Hoboken",
  "Weehawken",
  "Secaucus",
  "Bayonne",
  "Perth Amboy",
  "Hackensack",
  "Atlantic City",
  "Asbury Park",
];

// Ranks (cumulative all-time score) with unicode insignia — no image assets.
const RANKS = [
  { title: "Private", min: 0, insignia: "▪", abbr: "Pvt." },
  { title: "Corporal", min: 1000, insignia: "▪▪", abbr: "Cpl." },
  { title: "Sergeant", min: 2500, insignia: "▪▪▪", abbr: "Sgt." },
  { title: "Lieutenant", min: 5000, insignia: "★", abbr: "Lt." },
  { title: "Captain", min: 10000, insignia: "★★", abbr: "Capt." },
  { title: "Major", min: 20000, insignia: "★★★", abbr: "Maj." },
  { title: "Colonel", min: 35000, insignia: "✦✦✦", abbr: "Col." },
  { title: "General", min: 50000, insignia: "✪", abbr: "Gen." },
];

const CATEGORY_LABELS = {
  trivia: "TRIVIA",
  quote: "WHO SAID IT",
  headline: "REAL OR FAKE HEADLINE",
  stat: "STAT DUEL AT DAWN",
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function errorJson(message, status = 400, code = "error") {
  return json({ error: message, code }, status);
}

function rankForScore(score) {
  let current = RANKS[0];
  for (const r of RANKS) {
    if (score >= r.min) current = r;
    else break;
  }
  return current;
}

function nextRankInfo(score) {
  const current = rankForScore(score);
  const idx = RANKS.indexOf(current);
  const next = RANKS[idx + 1] || null;
  let progress = 1;
  let needed = 0;
  if (next) {
    const span = next.min - current.min;
    progress = span > 0 ? Math.min(1, Math.max(0, (score - current.min) / span)) : 1;
    needed = Math.max(0, next.min - score);
  }
  return {
    current: { title: current.title, insignia: current.insignia, abbr: current.abbr, min: current.min },
    next: next
      ? { title: next.title, insignia: next.insignia, abbr: next.abbr, min: next.min }
      : null,
    progress,
    needed,
  };
}

function rng() {
  return Math.random();
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom(arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function clampName(raw) {
  if (typeof raw !== "string") return "";
  // Collapse whitespace, trim, cap at 20 chars.
  const cleaned = raw.replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 20);
}

function safeJsonParse(str, fallback) {
  try {
    const v = JSON.parse(str);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Question selection (spec §3): random but balanced.
// >=3 about each city, >=3 categories represented. Avoid recently-seen ids.
// If the pool can't satisfy a constraint, degrade gracefully (never crash).
// ---------------------------------------------------------------------------

function selectQuestions(excludeIds) {
  const exclude = new Set(excludeIds || []);
  let pool = BANK.filter((q) => !exclude.has(q.id));
  // If exclusion starves us below a playable count, allow repeats (spec §3).
  if (pool.length < QUESTIONS_PER_BATTLE) {
    pool = BANK.slice();
  }

  const chosen = [];
  const chosenIds = new Set();

  const add = (q) => {
    if (!q || chosenIds.has(q.id) || chosen.length >= QUESTIONS_PER_BATTLE) return false;
    chosen.push(q);
    chosenIds.add(q.id);
    return true;
  };

  const avail = () => pool.filter((q) => !chosenIds.has(q.id));

  // 1) Guarantee >=3 questions about PHI and >=3 about NY (BOTH counts for neither
  //    of these specific quotas, but is fine filler later).
  for (const city of ["PHI", "NY"]) {
    let have = chosen.filter((q) => q.city === city).length;
    const candidates = shuffle(avail().filter((q) => q.city === city));
    for (const q of candidates) {
      if (have >= 3) break;
      if (add(q)) have++;
    }
  }

  // 2) Guarantee >=3 distinct categories represented.
  const catsPresent = () => new Set(chosen.map((q) => q.category));
  for (const q of shuffle(avail())) {
    if (catsPresent().size >= 3) break;
    if (chosen.length >= QUESTIONS_PER_BATTLE) break;
    if (!catsPresent().has(q.category)) add(q);
  }

  // 3) Fill the rest at random.
  for (const q of shuffle(avail())) {
    if (chosen.length >= QUESTIONS_PER_BATTLE) break;
    add(q);
  }

  // 4) If STILL short (tiny bank + heavy exclusion edge), allow repeats from full bank.
  if (chosen.length < QUESTIONS_PER_BATTLE) {
    const filler = shuffle(BANK.slice());
    let i = 0;
    while (chosen.length < QUESTIONS_PER_BATTLE && BANK.length > 0) {
      chosen.push(filler[i % filler.length]);
      i++;
      if (i > QUESTIONS_PER_BATTLE * 4) break; // safety
    }
  }

  return shuffle(chosen).slice(0, QUESTIONS_PER_BATTLE);
}

async function recentlySeenIds(db, playerId) {
  // Exclude question ids from the player's last 3 battles.
  try {
    const { results } = await db
      .prepare(
        "SELECT question_ids FROM battles WHERE player_id = ?1 ORDER BY created_at DESC LIMIT 3"
      )
      .bind(playerId)
      .all();
    const ids = new Set();
    for (const row of results || []) {
      const arr = safeJsonParse(row.question_ids, []);
      if (Array.isArray(arr)) for (const id of arr) ids.add(id);
    }
    return ids;
  } catch {
    return new Set();
  }
}

// ---------------------------------------------------------------------------
// War math (spec §6)
// ---------------------------------------------------------------------------

function frontPosition(phi7, ny7) {
  const denom = Math.max(phi7 + ny7, 1);
  let pos = 50 + (50 * (phi7 - ny7)) / denom;
  pos = Math.min(95, Math.max(5, pos));
  return pos;
}

function townForPosition(pos) {
  // Map 0..100 across NJ_TOWNS (clamped range 5..95). PHI pushing right = toward NY.
  const idx = Math.min(
    NJ_TOWNS.length - 1,
    Math.max(0, Math.round(((pos - 5) / 90) * (NJ_TOWNS.length - 1)))
  );
  return NJ_TOWNS[idx];
}

// ---------------------------------------------------------------------------
// Dispatch + report text (server-rendered so taunt logic lives in one place)
// ---------------------------------------------------------------------------

const TAUNTS = {
  great: [
    "The enemy's lines break. Songs will be sung of this.",
    "A rout. Somewhere a Knicks fan weeps into a $19 beer.",
    "Magnificent carnage. The generals salute you.",
  ],
  good: [
    "A solid day's fighting. The front holds.",
    "Honorable work, soldier. Resupply and return.",
    "The enemy retreats — but only to regroup.",
  ],
  mid: [
    "A muddy, inconclusive scrap. Nobody writes ballads about a draw.",
    "You held the line. Barely. Mostly by accident.",
    "Adequate. The war effort notes your participation.",
  ],
  bad: [
    "A score this low constitutes desertion. The firing squad has been notified.",
    "The obituaries page ran long today, and most of them are yours.",
    "Historians will record this as 'a learning experience.' They are being polite.",
  ],
};

function tauntFor(correctCount, score) {
  if (correctCount >= 9 || score >= 1600) return pickRandom(TAUNTS.great);
  if (correctCount >= 7) return pickRandom(TAUNTS.good);
  if (correctCount >= 4) return pickRandom(TAUNTS.mid);
  return pickRandom(TAUNTS.bad);
}

function espionageLine(count) {
  if (count <= 0) return null;
  return `🕵️ Espionage bonus x${count} (knows the enemy too well)`;
}

function buildDispatchText({
  battleName,
  rankAbbr,
  playerName,
  army,
  score,
  correctCount,
  casualties,
  espionageCount,
  frontTown,
  appUrl,
}) {
  const armyInfo = ARMIES[army] || ARMIES.PHI;
  const enemy = army === "PHI" ? ARMIES.NY : ARMIES.PHI;
  const lines = [];
  lines.push(`⚔️ WAR DISPATCH — Battle of ${battleName} ⚔️`);
  lines.push(`${rankAbbr} ${playerName} of the ${armyInfo.name} ${armyInfo.emoji}`);
  lines.push(
    `Score: ${score.toLocaleString("en-US")} (${correctCount}/${QUESTIONS_PER_BATTLE} correct) — ${casualties} ${
      casualties === 1 ? "casualty" : "casualties"
    }`
  );
  const esp = espionageLine(espionageCount);
  if (esp) lines.push(esp);
  // Direction of the front + taunt. A 0-score battle moves nothing — match
  // frontDelta's "wasted volley" instead of falsely claiming an advance.
  const advanceTeam = army === "PHI" ? "NEW YORK" : "PHILADELPHIA";
  if (score > 0) {
    lines.push(
      `The front advances toward ${advanceTeam}. ${enemy.emoji} hold ${frontTown} — for now.`
    );
  } else {
    lines.push(
      `The front does not move — a wasted volley. ${enemy.emoji} still hold ${frontTown}, untroubled.`
    );
  }
  lines.push(tauntFor(correctCount, score));
  lines.push(`Enlist or surrender: ${appUrl}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// DB bootstrap-on-demand: tolerate "migration not yet applied" by failing soft.
// (We do NOT auto-create tables; the orchestrator runs the migration. But we
//  detect a missing-table error and surface the friendly "telegraph down" code.)
// ---------------------------------------------------------------------------

function isDbDownError(err) {
  const m = String(err && err.message ? err.message : err).toLowerCase();
  return (
    m.includes("no such table") ||
    m.includes("d1_") ||
    m.includes("database") ||
    m.includes("not found") ||
    m.includes("network") ||
    m.includes("storage")
  );
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function getPlayer(db, playerId) {
  if (!playerId || typeof playerId !== "string") return null;
  const row = await db
    .prepare("SELECT id, name, army, created_at FROM players WHERE id = ?1")
    .bind(playerId)
    .first();
  return row || null;
}

async function handleEnlist(db, body) {
  const name = clampName(body && body.name);
  const army = body && body.army;
  const playerId = body && body.playerId;

  if (!name || name.length < 1) {
    return errorJson("A soldier must have a name to enlist.", 400, "bad_name");
  }
  if (army !== "PHI" && army !== "NY") {
    return errorJson("Pick an army, deserter.", 400, "bad_army");
  }

  // Re-enlist: same localStorage id returns the existing player (army may change sides —
  // we let them; a small chat allows defection, the obituaries will judge them).
  if (playerId) {
    const existing = await getPlayer(db, playerId);
    if (existing) {
      // Update name/army to whatever they just submitted (lets them fix typos / defect).
      await db
        .prepare("UPDATE players SET name = ?1, army = ?2 WHERE id = ?3")
        .bind(name, army, playerId)
        .run();
      return json({ player: { id: playerId, name, army, created_at: existing.created_at } });
    }
  }

  const id = crypto.randomUUID();
  const created_at = Date.now();
  await db
    .prepare("INSERT INTO players (id, name, army, created_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(id, name, army, created_at)
    .run();
  return json({ player: { id, name, army, created_at } });
}

async function playerTotalScore(db, playerId) {
  const row = await db
    .prepare(
      "SELECT COALESCE(SUM(score),0) AS total, COUNT(*) AS battles FROM battles WHERE player_id = ?1 AND completed = 1"
    )
    .bind(playerId)
    .first();
  return { total: row ? Number(row.total) : 0, battles: row ? Number(row.battles) : 0 };
}

async function handleMe(db, playerId) {
  const player = await getPlayer(db, playerId);
  if (!player) return errorJson("No such soldier on the muster roll.", 404, "no_player");
  const { total, battles } = await playerTotalScore(db, playerId);
  const nr = nextRankInfo(total);
  return json({
    player,
    rank: nr.current,
    totalScore: total,
    battles,
    nextRank: nr,
  });
}

async function handleWar(db) {
  const now = Date.now();
  const since = now - SEVEN_DAYS_MS;

  // Army totals: 7-day (rolling) and all-time. Join battles to players for army.
  const armyRows = await db
    .prepare(
      `SELECT p.army AS army,
              COALESCE(SUM(CASE WHEN b.created_at >= ?1 THEN b.score ELSE 0 END),0) AS seven,
              COALESCE(SUM(b.score),0) AS allt
       FROM battles b JOIN players p ON p.id = b.player_id
       WHERE b.completed = 1
       GROUP BY p.army`
    )
    .bind(since)
    .all();

  const sevenDay = { PHI: 0, NY: 0 };
  const allTime = { PHI: 0, NY: 0 };
  for (const r of armyRows.results || []) {
    if (r.army === "PHI" || r.army === "NY") {
      sevenDay[r.army] = Number(r.seven);
      allTime[r.army] = Number(r.allt);
    }
  }

  const pos = frontPosition(sevenDay.PHI, sevenDay.NY);
  const town = townForPosition(pos);

  // Soldiers leaderboard (all-time individual score).
  const soldierRows = await db
    .prepare(
      `SELECT p.id AS id, p.name AS name, p.army AS army,
              COALESCE(SUM(CASE WHEN b.completed = 1 THEN b.score ELSE 0 END),0) AS total,
              COALESCE(SUM(CASE WHEN b.completed = 1 THEN 1 ELSE 0 END),0) AS battles
       FROM players p LEFT JOIN battles b ON b.player_id = p.id
       GROUP BY p.id
       ORDER BY total DESC, p.created_at ASC
       LIMIT 50`
    )
    .all();

  const soldiers = (soldierRows.results || []).map((r) => {
    const total = Number(r.total);
    const rk = rankForScore(total);
    return {
      name: r.name,
      army: r.army,
      rank: { title: rk.title, insignia: rk.insignia, abbr: rk.abbr },
      totalScore: total,
      battles: Number(r.battles),
    };
  });

  // Traitor Watch: most wrong answers about your OWN city's teams.
  const traitorRows = await db
    .prepare(
      `SELECT p.name AS name, p.army AS army,
              COALESCE(SUM(b.own_city_misses),0) AS misses
       FROM players p JOIN battles b ON b.player_id = p.id
       WHERE b.completed = 1
       GROUP BY p.id
       HAVING misses > 0
       ORDER BY misses DESC
       LIMIT 10`
    )
    .all();

  const traitors = (traitorRows.results || []).map((r) => ({
    name: r.name,
    army: r.army,
    ownCityMisses: Number(r.misses),
  }));

  // Recent battles ticker (last 8 completed).
  const recentRows = await db
    .prepare(
      `SELECT p.name AS name, p.army AS army, b.battle_name AS battle_name,
              b.correct_count AS correct, b.score AS score
       FROM battles b JOIN players p ON p.id = b.player_id
       WHERE b.completed = 1
       ORDER BY b.created_at DESC
       LIMIT 8`
    )
    .all();

  const recent = (recentRows.results || []).map((r) => ({
    name: r.name,
    army: r.army,
    battleName: r.battle_name,
    correct: Number(r.correct),
    score: Number(r.score),
  }));

  return json({
    front: { position: pos, town, sevenDay, allTime },
    soldiers,
    traitors,
    recent,
  });
}

async function handleBattleStart(db, body) {
  const playerId = body && body.playerId;
  const player = await getPlayer(db, playerId);
  if (!player) return errorJson("Enlist before you march.", 404, "no_player");

  if (!bankReady()) {
    return errorJson(
      "🪖 The armory is still being stocked — the blacksmiths are forging trivia as we speak. Try again in a moment.",
      503,
      "armory_stocking"
    );
  }

  const seen = await recentlySeenIds(db, playerId);
  const chosen = selectQuestions(seen);
  if (chosen.length < QUESTIONS_PER_BATTLE) {
    // Bank too small to field a full skirmish even with repeats.
    return errorJson(
      "🪖 The armory is still being stocked — not enough questions to field a full skirmish yet.",
      503,
      "armory_stocking"
    );
  }

  const battleId = crypto.randomUUID();
  const battleName = pickRandom(BATTLE_TOWNS);
  const questionIds = chosen.map((q) => q.id);
  const created_at = Date.now();

  await db
    .prepare(
      `INSERT INTO battles (id, player_id, battle_name, question_ids, answers, score, correct_count, own_city_misses, completed, created_at)
       VALUES (?1, ?2, ?3, ?4, '{}', 0, 0, 0, 0, ?5)`
    )
    .bind(battleId, playerId, battleName, JSON.stringify(questionIds), created_at)
    .run();

  return json({
    battleId,
    battleName,
    questions: chosen.map((q) => ({
      ...publicQuestion(q),
      categoryLabel: CATEGORY_LABELS[q.category] || "TRIVIA",
    })),
  });
}

async function handleBattleAnswer(db, body) {
  const { battleId, playerId, questionId } = body || {};
  let { choiceIndex, elapsedMs } = body || {};

  if (!battleId || !playerId || !questionId) {
    return errorJson("Malformed answer dispatch.", 400, "bad_request");
  }

  // Sanitize inputs once (independent of the battle row).
  choiceIndex = Number.isInteger(choiceIndex) ? choiceIndex : -1;
  elapsedMs = Number(elapsedMs);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) elapsedMs = TIMER_MS;
  elapsedMs = Math.min(elapsedMs, TIMER_MS); // cap

  // Optimistic-concurrency loop: read the battle (incl. its current answers
  // blob), compute the new blob, then UPDATE ... WHERE answers = <the blob we
  // read>. If a concurrent answer to a DIFFERENT question slipped in between,
  // 0 rows change and we re-read + retry. Without this, two concurrent answers
  // do read-modify-write on the same JSON blob and one is silently dropped
  // (last-write-wins). Self-harm only, but still a real lost-points bug.
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const battle = await db
      .prepare("SELECT * FROM battles WHERE id = ?1")
      .bind(battleId)
      .first();
    if (!battle) return errorJson("No such battle.", 404, "no_battle");
    if (battle.player_id !== playerId)
      return errorJson("This is not your battle to fight.", 403, "wrong_player");

    // Reject answers to stale battles (>30 min).
    if (Date.now() - Number(battle.created_at) > BATTLE_STALE_MS) {
      return errorJson("This battle is long over. The dead do not answer roll.", 410, "battle_stale");
    }
    if (Number(battle.completed) === 1) {
      return errorJson("The battle has already been decided.", 409, "battle_done");
    }

    // The question must belong to this battle.
    const qids = safeJsonParse(battle.question_ids, []);
    if (!Array.isArray(qids) || !qids.includes(questionId)) {
      return errorJson("That question is not part of this battle.", 400, "not_in_battle");
    }

    const question = questionById(questionId);
    if (!question)
      return errorJson("That question has vanished from the records.", 404, "no_question");

    const prevAnswersRaw = typeof battle.answers === "string" ? battle.answers : "{}";
    const answers = safeJsonParse(prevAnswersRaw, {});

    // Idempotent: if already answered, return the recorded result (no double-scoring).
    if (answers[questionId]) {
      const prev = answers[questionId];
      return json({
        correct: !!prev.correct,
        answerIndex: question.answer_index,
        points: Number(prev.points) || 0,
        espionage: !!prev.espionage,
        ...(prev.correct ? { flavor: question.flavor } : { roast: question.roast }),
        alreadyAnswered: true,
      });
    }

    const correct = choiceIndex === question.answer_index;

    // Determine the answering player's army (for espionage / own-city misses).
    const player = await getPlayer(db, playerId);
    const playerArmy = player ? player.army : "PHI";
    const enemyCity = playerArmy === "PHI" ? "NY" : "PHI";
    const ownCity = playerArmy; // "PHI" or "NY"

    let points = 0;
    let espionage = false;
    if (correct) {
      const remaining = Math.max(0, TIMER_MS - elapsedMs);
      const speedBonus = Math.round((MAX_SPEED_BONUS * remaining) / TIMER_MS);
      points = BASE_POINTS + speedBonus; // 100..200
      if (question.city === enemyCity) {
        espionage = true;
        points += ESPIONAGE_BONUS;
      }
    }

    // own_city miss: wrong answer about your own city's teams (BOTH is shared,
    // we only count exact own-city).
    const ownCityMiss = !correct && question.city === ownCity ? 1 : 0;

    const nextAnswers = { ...answers };
    nextAnswers[questionId] = {
      choice: choiceIndex,
      points,
      correct,
      espionage,
    };

    const newScore = Number(battle.score) + points;
    const newCorrect = Number(battle.correct_count) + (correct ? 1 : 0);
    const newMisses = Number(battle.own_city_misses) + ownCityMiss;

    // Guarded write: only commit if the answers blob is still exactly what we
    // read. A concurrent writer (different question) changes it → 0 rows → retry.
    const result = await db
      .prepare(
        "UPDATE battles SET answers = ?1, score = ?2, correct_count = ?3, own_city_misses = ?4 WHERE id = ?5 AND answers = ?6"
      )
      .bind(
        JSON.stringify(nextAnswers),
        newScore,
        newCorrect,
        newMisses,
        battleId,
        prevAnswersRaw
      )
      .run();

    const changed = result && result.meta ? result.meta.changes : undefined;
    if (changed === 0) {
      // Lost the optimistic race — re-read and retry.
      continue;
    }

    return json({
      correct,
      answerIndex: question.answer_index,
      points,
      espionage,
      ...(correct ? { flavor: question.flavor } : { roast: question.roast }),
    });
  }

  // Exhausted retries under heavy concurrent contention.
  return errorJson(
    "The lines are jammed with fire — your dispatch could not be filed. Try once more.",
    409,
    "answer_contended"
  );
}

async function handleBattleFinish(db, body, appUrl) {
  const { battleId, playerId } = body || {};
  if (!battleId || !playerId) return errorJson("Malformed dispatch.", 400, "bad_request");

  const battle = await db.prepare("SELECT * FROM battles WHERE id = ?1").bind(battleId).first();
  if (!battle) return errorJson("No such battle.", 404, "no_battle");
  if (battle.player_id !== playerId)
    return errorJson("This is not your battle to finish.", 403, "wrong_player");

  const player = await getPlayer(db, playerId);
  if (!player) return errorJson("No such soldier.", 404, "no_player");

  // Reject finishing stale battles (>30 min). Mirror the staleness guard in
  // handleBattleAnswer so abandoned battles can't be filed days later and yank
  // the leaderboard around with ancient timestamps. (Already-completed battles
  // are still allowed below for idempotent re-reads.)
  if (
    Number(battle.completed) !== 1 &&
    Date.now() - Number(battle.created_at) > BATTLE_STALE_MS
  ) {
    return errorJson(
      "This battle is lost to history. Start a new skirmish.",
      410,
      "battle_stale"
    );
  }

  // Score BEFORE this battle counts toward rank (for rank-up detection).
  const before = await playerTotalScore(db, playerId);

  const qids = safeJsonParse(battle.question_ids, []);
  const answers = safeJsonParse(battle.answers, {});

  // Compute casualties = unanswered or wrong. Unanswered count as misses (0 pts).
  const casualties = [];
  let ownCityMisses = Number(battle.own_city_misses);
  let recomputeMisses = 0;
  for (const qid of qids) {
    const q = questionById(qid);
    const a = answers[qid];
    const wasAnswered = !!a;
    const wasCorrect = wasAnswered && a.correct;
    if (!wasCorrect) {
      // casualty
      if (q) {
        casualties.push({
          prompt: q.prompt,
          correctAnswer: q.choices[q.answer_index],
          roast: q.roast,
          city: q.city,
          category: q.category,
        });
      }
      // Unanswered own-city question also counts as a traitor miss.
      if (!wasAnswered && q && q.city === player.army) {
        recomputeMisses += 1;
      }
    }
  }

  // Add unanswered own-city misses to the stored count (answered ones already counted).
  ownCityMisses += recomputeMisses;

  const wasAlreadyCompleted = Number(battle.completed) === 1;

  if (!wasAlreadyCompleted) {
    await db
      .prepare("UPDATE battles SET completed = 1, own_city_misses = ?1 WHERE id = ?2")
      .bind(ownCityMisses, battleId)
      .run();
  }

  const score = Number(battle.score);
  const correctCount = Number(battle.correct_count);

  // After-score for rank-up: if this is the first finish, add this battle's score.
  const afterTotal = wasAlreadyCompleted ? before.total : before.total + score;
  const rankBefore = rankForScore(before.total);
  const rankAfter = rankForScore(afterTotal);
  let rankUp = null;
  if (!wasAlreadyCompleted && rankAfter.min > rankBefore.min) {
    rankUp = { from: rankBefore.title, to: rankAfter.title, insignia: rankAfter.insignia };
  }

  // Front movement caused by this battle (rough miles for flavor):
  // map score contribution to a small distance. Direction = toward enemy.
  const towardNY = player.army === "PHI";
  const miles = Math.round((score / 200) * 10) / 100; // ~0..1.0 mi per battle
  const frontDelta = {
    miles,
    towardNY,
    text:
      score > 0
        ? `The front advances ${miles.toFixed(1)} mile${miles === 1 ? "" : "s"} toward ${
            towardNY ? "New York" : "Philadelphia"
          }.`
        : "The front does not move. A wasted volley.",
  };

  // Espionage count for dispatch.
  let espionageCount = 0;
  for (const qid of qids) {
    const a = answers[qid];
    if (a && a.correct && a.espionage) espionageCount++;
  }

  // Current front town (post-battle) for the dispatch line.
  const now = Date.now();
  const since = now - SEVEN_DAYS_MS;
  const armyRows = await db
    .prepare(
      `SELECT p.army AS army, COALESCE(SUM(b.score),0) AS seven
       FROM battles b JOIN players p ON p.id = b.player_id
       WHERE b.completed = 1 AND b.created_at >= ?1
       GROUP BY p.army`
    )
    .bind(since)
    .all();
  const seven = { PHI: 0, NY: 0 };
  for (const r of armyRows.results || []) {
    if (r.army === "PHI" || r.army === "NY") seven[r.army] = Number(r.seven);
  }
  const frontTown = townForPosition(frontPosition(seven.PHI, seven.NY));

  const rankAbbr = rankAfter.abbr;
  const dispatchText = buildDispatchText({
    battleName: battle.battle_name,
    rankAbbr,
    playerName: player.name,
    army: player.army,
    score,
    correctCount,
    casualties: casualties.length,
    espionageCount,
    frontTown,
    appUrl,
  });

  return json({
    battleName: battle.battle_name,
    score,
    correctCount,
    total: QUESTIONS_PER_BATTLE,
    casualties,
    espionageCount,
    frontDelta,
    rankUp,
    newTotalScore: afterTotal,
    nextRank: nextRankInfo(afterTotal),
    dispatchText,
  });
}

// War report (War Room copy button) — server-rendered standings text.
async function handleWarReport(db, appUrl) {
  const warRes = await handleWar(db);
  const data = await warRes.json();
  const { front, soldiers, allTime } = data;
  const phiAll = data.front.allTime.PHI;
  const nyAll = data.front.allTime.NY;
  const top3 = soldiers.slice(0, 3);

  const lines = [];
  lines.push("📜 WAR REPORT FROM THE FRONT 📜");
  lines.push(`The front currently lies at ${front.town.toUpperCase()}.`);
  if (front.position > 50) lines.push("🔔 The Brotherly Love Brigade holds the advantage.");
  else if (front.position < 50) lines.push("🗽 The Empire Army holds the advantage.");
  else lines.push("⚖️ The lines are deadlocked. New Jersey trembles.");
  lines.push("");
  lines.push(`Army totals (all-time): 🔔 PHI ${phiAll.toLocaleString("en-US")} — 🗽 NY ${nyAll.toLocaleString("en-US")}`);
  lines.push(
    `Last 7 days: 🔔 ${front.sevenDay.PHI.toLocaleString("en-US")} — 🗽 ${front.sevenDay.NY.toLocaleString("en-US")}`
  );
  lines.push("");
  lines.push("☆ TOP SOLDIERS ☆");
  if (top3.length === 0) {
    lines.push("No soldiers have yet distinguished themselves. The war awaits.");
  } else {
    top3.forEach((s, i) => {
      const army = s.army === "PHI" ? "🔔" : "🗽";
      lines.push(`${i + 1}. ${s.rank.abbr} ${s.name} ${army} — ${s.totalScore.toLocaleString("en-US")}`);
    });
  }
  lines.push("");
  lines.push(`Enlist and join the fight: ${appUrl}`);
  return json({ reportText: lines.join("\n") });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const appUrl = `${url.origin}/`;

    // Health / integrity (handy for the orchestrator; never leaks answers).
    if (path === "/api/health") {
      return json({
        ok: true,
        bankReady: bankReady(),
        bankSize: BANK.length,
        integrity: {
          total: integrity.total,
          byCategory: integrity.byCategory,
          byCity: integrity.byCity,
          skippedInvalid: integrity.skippedInvalid,
          skippedDuplicate: integrity.skippedDuplicate,
        },
      });
    }

    if (path.startsWith("/api/")) {
      const db = env.DB;
      if (!db) {
        return errorJson(
          "📡 The telegraph lines are down — no connection to headquarters (D1).",
          503,
          "db_down"
        );
      }

      try {
        if (request.method === "POST" && path === "/api/enlist") {
          return await handleEnlist(db, await readJson(request));
        }
        if (request.method === "GET" && path === "/api/me") {
          return await handleMe(db, url.searchParams.get("playerId"));
        }
        if (request.method === "GET" && path === "/api/war") {
          return await handleWar(db);
        }
        if (request.method === "GET" && path === "/api/war/report") {
          return await handleWarReport(db, appUrl);
        }
        if (request.method === "POST" && path === "/api/battle/start") {
          return await handleBattleStart(db, await readJson(request));
        }
        if (request.method === "POST" && path === "/api/battle/answer") {
          return await handleBattleAnswer(db, await readJson(request));
        }
        if (request.method === "POST" && path === "/api/battle/finish") {
          return await handleBattleFinish(db, await readJson(request), appUrl);
        }
        return errorJson("No such dispatch route.", 404, "no_route");
      } catch (err) {
        if (isDbDownError(err)) {
          return errorJson(
            "📡 The telegraph lines are down — headquarters cannot be reached. Try again shortly.",
            503,
            "db_down"
          );
        }
        // Log the real exception server-side; never leak internal text to clients.
        console.error(err);
        return errorJson(
          "An unexpected mortar struck the command tent.",
          500,
          "server_error"
        );
      }
    }

    // Static assets (parchment frontend).
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not found", { status: 404 });
  },
};

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
