/* GROUP CHAT CIVIL WAR — front-end SPA. Vanilla JS. No framework.
   All user-supplied strings rendered via textContent (never innerHTML). */

(function () {
  "use strict";

  // ---------------- State ----------------
  var LS_KEY = "gccw_player";
  var state = {
    player: null,        // {id, name, army}
    battle: null,        // {battleId, battleName, questions:[], index, answered:{}, results:[]}
    timer: null,
    timerStart: 0,
    advanceTimeout: null,
  };

  var ARMY = {
    PHI: { emoji: "🔔", name: "Brotherly Love Brigade" },
    NY: { emoji: "🗽", name: "Empire Army" },
  };
  var TIMER_MS = 20000;
  var ADVANCE_CORRECT_MS = 2600;
  var ADVANCE_WRONG_MS = 4500;

  // Reduced-motion gate (H, M4). Confetti/flourish are skipped when true.
  function reducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // ---------------- Tiny DOM helpers ----------------
  function $(id) { return document.getElementById(id); }
  function show(id) { $(id).classList.remove("hidden"); }
  function hide(id) { $(id).classList.add("hidden"); }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function el(tag, opts) {
    var node = document.createElement(tag);
    opts = opts || {};
    if (opts.className) node.className = opts.className;
    if (opts.text != null) node.textContent = String(opts.text); // safe: textContent
    if (opts.attrs) for (var k in opts.attrs) node.setAttribute(k, opts.attrs[k]);
    return node;
  }

  function fmt(n) {
    try { return Number(n).toLocaleString("en-US"); } catch (e) { return String(n); }
  }

  // Count a number up (B, F). Calls render(value) each frame; ease-out.
  function tweenNumber(from, to, durationMs, render) {
    from = Number(from) || 0; to = Number(to) || 0;
    if (reducedMotion() || durationMs <= 0 || from === to) { render(to); return; }
    var start = null;
    function step(ts) {
      if (start == null) start = ts;
      var t = Math.min(1, (ts - start) / durationMs);
      var eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      render(Math.round(from + (to - from) * eased));
      if (t < 1) requestAnimationFrame(step);
      else render(to);
    }
    requestAnimationFrame(step);
  }

  // Confetti / cannon burst (H). Spawns emoji particles from a point.
  // wide=true → full-width burst (rank-up / perfect campaign).
  function confettiBurst(x, y, wide) {
    if (reducedMotion()) return;
    var armyEmoji = (state.player && ARMY[state.player.army]) ? ARMY[state.player.army].emoji : "🔔";
    var pool = ["⚔️", "🎖️", "🎉", armyEmoji];
    var count = wide ? 18 : 14;
    for (var i = 0; i < count; i++) {
      var piece = document.createElement("span");
      piece.className = "confetti-piece";
      piece.textContent = pool[Math.floor(Math.random() * pool.length)];
      var originX = wide ? Math.random() * window.innerWidth : x + (Math.random() - 0.5) * 40;
      var ang = (-Math.PI / 2) + (Math.random() - 0.5) * (wide ? Math.PI * 0.9 : Math.PI * 0.7);
      var dist = 60 + Math.random() * (wide ? 130 : 90);
      var dx = Math.cos(ang) * dist;
      var dy = Math.sin(ang) * dist + 120; // gravity pulls down after the toss
      piece.style.left = originX + "px";
      piece.style.top = y + "px";
      piece.style.setProperty("--dx", dx.toFixed(0) + "px");
      piece.style.setProperty("--dy", dy.toFixed(0) + "px");
      piece.style.setProperty("--rot", (Math.random() * 720 - 360).toFixed(0) + "deg");
      piece.style.animationDelay = (Math.random() * 0.12).toFixed(2) + "s";
      piece.addEventListener("animationend", function () {
        if (this.parentNode) this.parentNode.removeChild(this);
      });
      document.body.appendChild(piece);
    }
  }

  function showScreen(name) {
    ["enlist", "warroom", "battle", "report"].forEach(function (s) {
      $("screen-" + s).classList.add("hidden");
    });
    show("screen-" + name);
    window.scrollTo(0, 0);
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg; // safe
    t.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 3800);
  }

  // ---------------- API ----------------
  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || "GET", headers: {} };
    if (opts.body) {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    return fetch(path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data && data.error ? data.error : "Request failed");
          err.code = data && data.code;
          err.status = res.status;
          throw err;
        }
        return data;
      });
    }).catch(function (err) {
      if (err && (err.status || err.code)) throw err;
      // network failure → telegraph lines down
      var e = new Error("📡 The telegraph lines are down. Check your connection and try again.");
      e.code = "network";
      throw e;
    });
  }

  // ---------------- localStorage ----------------
  function loadPlayer() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (p && p.id && p.name && p.army) return p;
    } catch (e) {}
    return null;
  }
  function savePlayer(p) {
    state.player = p;
    try { localStorage.setItem(LS_KEY, JSON.stringify({ id: p.id, name: p.name, army: p.army })); } catch (e) {}
  }

  // ---------------- Enlistment ----------------
  var pickedArmy = null;
  function initEnlist() {
    var nameInput = $("enlist-name");
    var submit = $("enlist-submit");

    function refresh() {
      submit.disabled = !(nameInput.value.trim().length >= 1 && pickedArmy);
      // Hint hides once the muster roll can be signed (L).
      var hint = $("enlist-hint");
      if (hint) hint.classList.toggle("hidden", !submit.disabled);
    }
    nameInput.addEventListener("input", refresh);

    // Enter in the name field signs the roll when enabled (L).
    nameInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !submit.disabled) { ev.preventDefault(); submit.click(); }
    });

    document.querySelectorAll(".army-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        pickedArmy = btn.getAttribute("data-army");
        document.querySelectorAll(".army-btn").forEach(function (b) { b.classList.remove("selected"); });
        btn.classList.add("selected");
        refresh();
      });
    });

    submit.addEventListener("click", function () {
      var name = nameInput.value.trim();
      if (!name || !pickedArmy) return;
      submit.disabled = true;
      var body = { name: name, army: pickedArmy };
      if (state.player && state.player.id) body.playerId = state.player.id;
      api("/api/enlist", { method: "POST", body: body }).then(function (data) {
        savePlayer(data.player);
        enterWarRoom();
      }).catch(function (err) {
        toast(err.message);
        submit.disabled = false;
      });
    });
  }

  // Pre-fill enlist for "change name / switch sides"
  function openReenlist() {
    if (state.player) {
      $("enlist-name").value = state.player.name;
      pickedArmy = state.player.army;
      document.querySelectorAll(".army-btn").forEach(function (b) {
        b.classList.toggle("selected", b.getAttribute("data-army") === pickedArmy);
      });
      $("enlist-submit").disabled = false;
      var hint = $("enlist-hint");
      if (hint) hint.classList.add("hidden");
    }
    showScreen("enlist");
  }

  // ---------------- War Room ----------------
  function enterWarRoom() {
    showScreen("warroom");
    loadWar();
    loadMe();
  }

  function loadMe() {
    if (!state.player) return;
    api("/api/me?playerId=" + encodeURIComponent(state.player.id)).then(function (data) {
      renderRankCard(data);
    }).catch(function (err) {
      // If the player vanished from the DB (war was reset), re-enlist.
      if (err.status === 404) { clearPlayerAndReenlist(); return; }
      // otherwise quiet — rank card just won't update
    });
  }

  function clearPlayerAndReenlist() {
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    state.player = null;
    pickedArmy = null;
    $("enlist-name").value = "";
    document.querySelectorAll(".army-btn").forEach(function (b) { b.classList.remove("selected"); });
    $("enlist-submit").disabled = true;
    var hint = $("enlist-hint");
    if (hint) hint.classList.remove("hidden");
    toast("The records were reset. Re-enlist to rejoin the war.");
    showScreen("enlist");
  }

  function renderRankCard(data) {
    var rank = data.rank || { title: "Private", insignia: "▪" };
    $("rank-insignia").textContent = rank.insignia || "▪";
    $("rank-title").textContent = rank.title || "Private";
    $("rank-sub").textContent = fmt(data.totalScore || 0) + " pts · " + (data.battles || 0) + " battles";
    $("rank-army").textContent = ARMY[state.player.army] ? ARMY[state.player.army].emoji : "🔔";
    var nr = data.nextRank || {};
    $("rank-progress").style.width = Math.round((nr.progress != null ? nr.progress : 1) * 100) + "%";
    if (nr.next) {
      $("rank-next").textContent = "Next: " + nr.next.title + " (" + fmt(nr.next.min) + ") — " + fmt(nr.needed) + " to go";
    } else {
      $("rank-next").textContent = "Highest rank achieved. The war is yours to command.";
    }
  }

  function loadWar() {
    api("/api/war").then(function (data) {
      renderFront(data.front);
      renderBoards(data);
      renderTicker(data.recent);
    }).catch(function (err) {
      toast(err.message || "📡 The telegraph lines are down.");
    });
    // Prefetch the War Report text so the COPY button can copy SYNCHRONOUSLY
    // from memory inside the click gesture. iOS Safari blocks clipboard writes
    // that happen after an awaited fetch (outside the user-gesture window), and
    // the execCommand fallback is equally gesture-bound. Refresh on every war
    // refresh so the copied standings stay current.
    refreshWarReport();
  }

  var lastReportText = "";
  function refreshWarReport() {
    api("/api/war/report").then(function (data) {
      lastReportText = data.reportText || "";
    }).catch(function () {
      // Quietly leave the previous cached text in place; the click handler will
      // toast if there's nothing cached yet.
    });
  }

  function renderFront(front) {
    if (!front) return;
    var pos = front.position != null ? front.position : 50;
    $("front-fill-phi").style.width = pos + "%";
    $("front-marker").style.left = pos + "%";

    // 7-day totals inline under the bar (I): "🔔 3,420 — 2,180 🗽".
    var seven = front.sevenDay || { PHI: 0, NY: 0 };
    $("front-total-phi").textContent = "🔔 " + fmt(seven.PHI || 0);
    $("front-total-ny").textContent = fmt(seven.NY || 0) + " 🗽";
    var label = $("front-label");
    clear(label);
    label.appendChild(document.createTextNode("The front currently lies at "));
    var strong = el("strong", { text: (front.town || "TRENTON").toUpperCase() });
    label.appendChild(strong);
    label.appendChild(document.createTextNode("."));
  }

  function renderTicker(recent) {
    var track = $("ticker-track");
    clear(track);
    if (!recent || recent.length === 0) {
      var item = el("span", { className: "ticker-item", text: "The front is quiet. Too quiet. Be the first to fire a shot." });
      track.appendChild(item);
      return;
    }
    recent.forEach(function (r) {
      var emoji = r.army === "NY" ? "🗽" : "🔔";
      var verb = r.correct >= 7 ? "triumphed at" : (r.correct <= 3 ? "fell at" : "scrapped at");
      var txt = emoji + " " + r.name + " " + verb + " the Battle of " + r.battleName +
        " — " + r.correct + "/10 (" + fmt(r.score) + ")";
      track.appendChild(el("span", { className: "ticker-item", text: txt }));
    });
  }

  // ---------------- Leaderboards ----------------
  var lastWar = null;
  function renderBoards(data) {
    lastWar = data;
    renderSoldiers(data.soldiers);
    renderWarBoard(data.front);
    renderTraitors(data.traitors);
  }

  function renderSoldiers(soldiers) {
    var box = $("board-soldiers");
    clear(box);
    if (!soldiers || soldiers.length === 0) {
      box.appendChild(el("div", { className: "empty-state", text: "No soldiers have yet enlisted. The war awaits." }));
      return;
    }
    soldiers.forEach(function (s, i) {
      var row = el("div", { className: "row" });
      row.appendChild(el("span", { className: "row-rank", text: "#" + (i + 1) }));
      row.appendChild(el("span", { className: "row-army", text: s.army === "NY" ? "🗽" : "🔔" }));
      var main = el("div", { className: "row-main" });
      main.appendChild(el("div", { className: "row-name", text: s.name }));
      var sub = el("div", { className: "row-sub" });
      sub.appendChild(el("span", { className: "row-insignia", text: (s.rank && s.rank.insignia) || "▪" }));
      sub.appendChild(document.createTextNode(" " + (s.rank ? s.rank.title : "Private") + " · " + s.battles + " battles"));
      main.appendChild(sub);
      row.appendChild(main);
      row.appendChild(el("span", { className: "row-score", text: fmt(s.totalScore) }));
      box.appendChild(row);
    });
  }

  function renderWarBoard(front) {
    var box = $("board-war");
    clear(box);
    if (!front) return;
    var seven = front.sevenDay || { PHI: 0, NY: 0 };
    var all = front.allTime || { PHI: 0, NY: 0 };

    var split = el("div", { className: "war-split" });
    [["PHI", "phi", "🔔", "Brotherly Love"], ["NY", "ny", "🗽", "Empire Army"]].forEach(function (cfg) {
      var col = el("div", { className: "war-col " + cfg[1] });
      col.appendChild(el("div", { className: "war-col-emoji", text: cfg[2] }));
      col.appendChild(el("div", { className: "war-col-name", text: cfg[3] }));
      col.appendChild(el("div", { className: "war-num", text: fmt(seven[cfg[0]] || 0) }));
      col.appendChild(el("div", { className: "war-num-label", text: "LAST 7 DAYS" }));
      col.appendChild(el("div", { className: "war-sub", text: "all-time " + fmt(all[cfg[0]] || 0) }));
      split.appendChild(col);
    });
    box.appendChild(split);

    var total7 = (seven.PHI || 0) + (seven.NY || 0);
    var note = el("div", { className: "empty-state" });
    if (total7 === 0) {
      note.textContent = "No shots fired in the last 7 days. The front grows cold.";
    } else if (front.position > 50) {
      note.textContent = "🔔 Philadelphia presses toward New York. The front holds at " + (front.town || "").toUpperCase() + ".";
    } else if (front.position < 50) {
      note.textContent = "🗽 New York presses toward Philadelphia. The front holds at " + (front.town || "").toUpperCase() + ".";
    } else {
      note.textContent = "⚖️ Deadlocked. New Jersey holds its breath.";
    }
    box.appendChild(note);
  }

  function renderTraitors(traitors) {
    var box = $("board-traitors");
    clear(box);
    box.appendChild(el("div", { className: "traitor-note", text: "Suspected of aiding the enemy — most wrong answers about their OWN city's teams." }));
    if (!traitors || traitors.length === 0) {
      box.appendChild(el("div", { className: "empty-state", text: "No traitors yet. Loyalty reigns. For now." }));
      return;
    }
    traitors.forEach(function (t, i) {
      var row = el("div", { className: "row" });
      row.appendChild(el("span", { className: "row-rank", text: "#" + (i + 1) }));
      row.appendChild(el("span", { className: "row-army", text: t.army === "NY" ? "🗽" : "🔔" }));
      var main = el("div", { className: "row-main" });
      main.appendChild(el("div", { className: "row-name", text: t.name }));
      main.appendChild(el("div", { className: "row-sub", text: "betrayals against their own city" }));
      row.appendChild(main);
      row.appendChild(el("span", { className: "row-score", text: "☠ " + t.ownCityMisses }));
      box.appendChild(row);
    });
  }

  function initTabs() {
    document.querySelectorAll(".tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
        tab.classList.add("active");
        ["soldiers", "war", "traitors"].forEach(function (name) {
          $("board-" + name).classList.toggle("hidden", name !== tab.getAttribute("data-tab"));
        });
      });
    });
  }

  // ---------------- Battle ----------------
  var skirmishInFlight = false;
  function startSkirmish() {
    if (!state.player) { showScreen("enlist"); return; }
    if (skirmishInFlight) return; // guard double-taps (J)
    skirmishInFlight = true;
    var btn = $("start-skirmish");
    btn.disabled = true;
    api("/api/battle/start", { method: "POST", body: { playerId: state.player.id } }).then(function (data) {
      skirmishInFlight = false;
      btn.disabled = false;
      state.battle = {
        battleId: data.battleId,
        battleName: data.battleName,
        questions: data.questions || [],
        index: 0,
        answered: {},
        results: [],
        score: 0,        // running points landed (B)
        shownScore: 0,   // last value painted into the header
        streak: 0,       // consecutive correct (C)
      };
      if (state.battle.questions.length === 0) {
        toast("🪖 The armory is empty. Try again shortly.");
        return;
      }
      showScreen("battle");
      $("battle-name").textContent = "The Battle of " + data.battleName;
      $("battle-score").textContent = "⚡ 0";
      showBattleIntro(data.battleName);
    }).catch(function (err) {
      skirmishInFlight = false;
      btn.disabled = false;
      if (err.code === "armory_stocking") {
        toast(err.message);
      } else if (err.status === 404) {
        clearPlayerAndReenlist();
      } else {
        toast(err.message || "Could not start the skirmish.");
      }
    });
  }

  // Battle intro overlay (A). Teaches the rules and gates the first question +
  // timer behind a tap so the fuse never ambushes the player on arrival.
  function showBattleIntro(battleName) {
    var overlay = $("battle-intro");
    $("intro-battle").textContent = ("The Battle of " + battleName).toUpperCase();

    // Clear stale previous-battle content so it isn't faintly visible behind the
    // dim overlay when "ANOTHER SKIRMISH" reuses the battle screen.
    $("q-prompt").textContent = "";
    clear($("choices"));
    hide("feedback");
    hide("enemy-badge");
    var fill = $("fuse-fill");
    fill.style.transition = "none";
    fill.style.transform = "scaleX(1)";
    $("fuse-spark").style.left = "100%";
    fill.parentElement.classList.remove("low");

    show("battle-intro");

    var opened = false;
    function openFire(ev) {
      if (opened) return;
      opened = true;
      if (ev) ev.stopPropagation();
      overlay.onclick = null;
      $("intro-open-fire").onclick = null;
      hide("battle-intro");
      renderQuestion(); // only now does the fuse start
    }
    overlay.onclick = openFire;
    $("intro-open-fire").onclick = openFire;
  }

  function renderQuestion() {
    var b = state.battle;
    var q = b.questions[b.index];
    if (!q) { finishBattle(); return; }

    hide("feedback");
    $("battle-progress").textContent = (b.index + 1) + " / " + b.questions.length;
    $("cat-badge").textContent = q.categoryLabel || categoryLabel(q.category);
    $("q-prompt").textContent = q.prompt;

    // Espionage foreshadowing (D): flag enemy-city questions before answering.
    renderEnemyBadge(q);

    var choicesBox = $("choices");
    clear(choicesBox);
    q.choices.forEach(function (choice, idx) {
      var btn = el("button", { className: "choice", text: choice, attrs: { type: "button" } });
      btn.addEventListener("click", function () { submitAnswer(idx); });
      choicesBox.appendChild(btn);
    });

    startTimer();
  }

  function categoryLabel(cat) {
    return { trivia: "TRIVIA", quote: "WHO SAID IT", headline: "REAL OR FAKE HEADLINE", stat: "STAT DUEL AT DAWN" }[cat] || "TRIVIA";
  }

  // Enemy-intel badge (D). PHI's enemy is NY and vice versa; "BOTH" never counts.
  function renderEnemyBadge(q) {
    var badge = $("enemy-badge");
    if (!badge) return;
    var army = state.player && state.player.army;
    var enemyCity = army === "PHI" ? "NY" : (army === "NY" ? "PHI" : null);
    if (enemyCity && q.city === enemyCity) {
      badge.classList.remove("foe-ny", "foe-phi");
      badge.classList.add(enemyCity === "NY" ? "foe-ny" : "foe-phi");
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  function startTimer() {
    stopTimer();
    var fill = $("fuse-fill");
    var rail = fill.parentElement;
    rail.classList.remove("low");
    fill.style.transition = "none";
    fill.style.transform = "scaleX(1)";
    $("fuse-spark").style.left = "100%";
    // force reflow then animate
    void fill.offsetWidth;
    state.timerStart = Date.now();

    var tick = function () {
      var elapsed = Date.now() - state.timerStart;
      var remain = Math.max(0, TIMER_MS - elapsed);
      var frac = remain / TIMER_MS;
      fill.style.transition = "none";
      fill.style.transform = "scaleX(" + frac + ")";
      $("fuse-spark").style.left = (frac * 100) + "%";
      if (frac < 0.25) rail.classList.add("low");
      if (remain <= 0) {
        stopTimer();
        submitAnswer(-1, true); // timeout
        return;
      }
    };
    tick();
    state.timer = setInterval(tick, 80);
  }

  function stopTimer() {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
  }

  function submitAnswer(choiceIndex, isTimeout) {
    var b = state.battle;
    if (!b) return;
    var q = b.questions[b.index];
    if (!q || b.answered[q.id]) return; // guard double-fire
    b.answered[q.id] = true;
    stopTimer();

    var elapsed = Math.min(TIMER_MS, Date.now() - state.timerStart);

    // Disable choices, mark the chosen one immediately as "pending".
    var choiceButtons = $("choices").querySelectorAll(".choice");
    choiceButtons.forEach(function (btn) { btn.disabled = true; });

    api("/api/battle/answer", {
      method: "POST",
      body: {
        battleId: b.battleId,
        playerId: state.player.id,
        questionId: q.id,
        choiceIndex: isTimeout ? -1 : choiceIndex,
        elapsedMs: elapsed,
      },
    }).then(function (res) {
      // Mark correct / wrong on the buttons.
      choiceButtons.forEach(function (btn, i) {
        if (i === res.answerIndex) btn.classList.add("correct");
        else if (i === choiceIndex && !res.correct) btn.classList.add("wrong");
        else btn.classList.add("dim");
      });
      b.results.push({
        questionId: q.id,
        correct: res.correct,
        points: res.points,
        espionage: res.espionage,
        prompt: q.prompt,
        correctAnswer: q.choices[res.answerIndex],
      });

      // Running score (B) + streak (C).
      if (res.correct) {
        b.score += (res.points || 0);
        b.streak += 1;
      } else {
        b.streak = 0;
      }
      updateBattleScore(b);
      showFeedback(res, isTimeout);
    }).catch(function (err) {
      // Re-enable on failure so they can retry.
      b.answered[q.id] = false;
      choiceButtons.forEach(function (btn) { btn.disabled = false; });
      toast(err.message || "The dispatch did not reach HQ. Try again.");
    });
  }

  function showFeedback(res, isTimeout) {
    var fb = $("feedback");
    var inner = $("feedback-inner");
    clear(inner);
    fb.classList.remove("correct-fb", "wrong-fb");

    if (res.correct) {
      fb.classList.add("correct-fb");
      // Streak fire (C): 3+ consecutive correct gets a prominent banner.
      if (state.battle && state.battle.streak >= 3) {
        inner.appendChild(el("div", { className: "fb-streak", text: "🔥 " + state.battle.streak + " IN A ROW" }));
      }
      var pts = el("span", { className: "fb-points good", text: "+" + res.points + " — A HIT!" });
      inner.appendChild(pts);
      inner.appendChild(el("div", { text: res.flavor || "A clean hit." }));
      if (res.espionage) {
        inner.appendChild(el("span", { className: "fb-espionage", text: "🕵️ ESPIONAGE BONUS +50" }));
      }
    } else {
      fb.classList.add("wrong-fb");
      var head = el("span", { className: "fb-points bad", text: isTimeout ? "☠️ TOO SLOW — THE FUSE BURNED OUT" : "☠️ CASUALTY REPORT" });
      inner.appendChild(head);
      inner.appendChild(el("div", { text: res.roast || "A soldier fell believing a falsehood." }));
      var truth = el("div", { className: "casualty-a" });
      truth.appendChild(document.createTextNode("The truth: "));
      truth.appendChild(el("strong", { text: state.battle.results[state.battle.results.length - 1].correctAnswer || "—" }));
      inner.appendChild(truth);
    }
    show("feedback");

    // Variable auto-advance (E): readable obituaries get more time; tap skips.
    var advanceMs = res.correct ? ADVANCE_CORRECT_MS : ADVANCE_WRONG_MS;

    // Draining progress strip (E): pure CSS animation, duration set from JS.
    var drain = $("fb-drain");
    if (drain) {
      drain.classList.remove("run");
      drain.style.animationDuration = advanceMs + "ms";
      void drain.offsetWidth; // restart the animation
      drain.classList.add("run");
    }

    // Small confetti burst near the feedback box on every correct answer (H).
    if (res.correct && !reducedMotion()) {
      var r = fb.getBoundingClientRect();
      confettiBurst(r.left + r.width / 2, r.top + 10, false);
    }

    if (state.advanceTimeout) clearTimeout(state.advanceTimeout);
    state.advanceTimeout = setTimeout(advance, advanceMs);
    fb.onclick = function () { advance(); };
  }

  // Running-score header (B): fast count-up tween + bump pulse on change.
  function updateBattleScore(b) {
    var elScore = $("battle-score");
    if (!elScore) return;
    var from = b.shownScore || 0;
    var to = b.score || 0;
    b.shownScore = to;
    if (to !== from) {
      elScore.classList.remove("bump");
      void elScore.offsetWidth;
      elScore.classList.add("bump");
    }
    tweenNumber(from, to, 400, function (v) {
      elScore.textContent = "⚡ " + fmt(v);
    });
  }

  function advance() {
    if (state.advanceTimeout) { clearTimeout(state.advanceTimeout); state.advanceTimeout = null; }
    $("feedback").onclick = null;
    var b = state.battle;
    if (!b) return;
    b.index++;
    if (b.index >= b.questions.length) {
      finishBattle();
    } else {
      renderQuestion();
    }
  }

  // ---------------- Finish / After-action ----------------
  function finishBattle() {
    stopTimer();
    var b = state.battle;
    if (!b) { enterWarRoom(); return; }

    // Show the report screen immediately; hide the retry panel while in flight.
    showScreen("report");
    showFinishPending(b);

    var retryBtn = $("retry-finish");
    if (retryBtn) retryBtn.disabled = true;

    api("/api/battle/finish", {
      method: "POST",
      body: { battleId: b.battleId, playerId: state.player.id },
    }).then(function (data) {
      // SUCCESS: points are now filed server-side — safe to render & drop the battle.
      state.battle = null;
      renderReport(data);
    }).catch(function (err) {
      // FAILURE: do NOT discard state.battle — the points are still unfiled.
      // Stay on the report screen and offer a retry that re-calls finish.
      toast(err.message || "Could not file the after-action report.");
      showFinishRetry(err);
    });
  }

  // Put the report screen into "filing in progress / failed" mode: hide the
  // normal report body so we don't show a stale/blank 0-score report, and show
  // the retry panel (caller toggles its visibility).
  function showFinishPending(b) {
    var retry = $("report-retry");
    var actions = $("report-actions");
    if (retry) retry.classList.add("hidden");
    if (actions) actions.classList.add("hidden");
    $("report-battle").textContent = "The Battle of " + ((b && b.battleName) || "—");
    $("report-score").textContent = "…";
    $("report-correct").textContent = "Filing the after-action report…";
    $("report-front").textContent = "";
    $("report-espionage").classList.add("hidden");
    $("rankup-banner").classList.add("hidden");
    clear($("casualties"));
    $("casualties-head").classList.add("hidden");
  }

  function showFinishRetry(err) {
    var retry = $("report-retry");
    var actions = $("report-actions");
    var msg = $("report-retry-msg");
    if (msg) {
      msg.textContent = (err && err.message)
        ? err.message + " Your points are unfiled — retry below."
        : "📡 The dispatch never reached HQ. Your points are unfiled — retry below.";
    }
    if (retry) retry.classList.remove("hidden");
    if (actions) actions.classList.add("hidden");
    $("report-correct").textContent = "Report not yet filed.";
    var retryBtn = $("retry-finish");
    if (retryBtn) retryBtn.disabled = false;
  }

  var lastDispatch = "";
  function renderReport(data) {
    showScreen("report");
    lastDispatch = data.dispatchText || "";

    // Filed successfully — reveal the normal actions, hide any retry panel.
    var retry = $("report-retry");
    var actions = $("report-actions");
    if (retry) retry.classList.add("hidden");
    if (actions) actions.classList.remove("hidden");

    $("report-battle").textContent = "The Battle of " + (data.battleName || "—");
    // Score count-up 0 → final, ease-out ~900ms (F).
    tweenNumber(0, data.score || 0, 900, function (v) {
      $("report-score").textContent = fmt(v);
    });
    $("report-correct").textContent = (data.correctCount || 0) + " / " + (data.total || 10) + " correct";
    $("report-front").textContent = data.frontDelta ? data.frontDelta.text : "";

    var esp = $("report-espionage");
    if (data.espionageCount && data.espionageCount > 0) {
      esp.textContent = "🕵️ Espionage bonus x" + data.espionageCount + " — you know the enemy too well.";
      esp.classList.remove("hidden");
    } else {
      esp.classList.add("hidden");
    }

    // Perfect campaign (G) takes the banner; otherwise the rank-up moment.
    var banner = $("rankup-banner");
    var total = data.total || 10;
    var perfect = (data.correctCount || 0) === total && total > 0;
    var celebrate = false;
    if (perfect) {
      banner.textContent = "🎖️ A PERFECT CAMPAIGN — " + total + "/" + total + ". The enemy generals are resigning.";
      banner.classList.remove("hidden");
      celebrate = true;
    } else if (data.rankUp) {
      banner.textContent = "🎖️ FIELD PROMOTION! You are now a " + (data.rankUp.to || "").toUpperCase() + " " + (data.rankUp.insignia || "");
      banner.classList.remove("hidden");
      celebrate = true;
    } else {
      banner.classList.add("hidden");
    }
    // Full-width confetti burst for rank-up / perfect campaign (H).
    if (celebrate && !reducedMotion()) {
      setTimeout(function () { confettiBurst(window.innerWidth / 2, 90, true); }, 250);
    }

    // Casualties
    var casBox = $("casualties");
    clear(casBox);
    var head = $("casualties-head");
    if (data.casualties && data.casualties.length > 0) {
      head.classList.remove("hidden");
      data.casualties.forEach(function (c) {
        var card = el("div", { className: "casualty" });
        card.appendChild(el("div", { className: "casualty-roast", text: c.roast || "A soldier fell." }));
        card.appendChild(el("div", { className: "casualty-q", text: c.prompt || "" }));
        var ans = el("div", { className: "casualty-a" });
        ans.appendChild(document.createTextNode("Correct answer: "));
        ans.appendChild(el("strong", { text: c.correctAnswer || "—" }));
        card.appendChild(ans);
        casBox.appendChild(card);
      });
    } else {
      head.classList.add("hidden");
      casBox.appendChild(el("div", { className: "empty-state", text: "No casualties. A flawless campaign. The enemy trembles. 🎖️" }));
    }
  }

  // ---------------- Clipboard ----------------
  function copyText(text, okMsg) {
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        var ok = document.execCommand("copy");
        toast(ok ? okMsg : "Copy failed — long-press to select instead.");
      } catch (e) {
        toast("Copy failed — long-press to select instead.");
      }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, fallback);
    } else {
      fallback();
    }
  }

  function initCopyButtons() {
    var copyDispatch = $("copy-dispatch");
    copyDispatch.addEventListener("click", function () {
      if (!lastDispatch) { toast("No dispatch to copy yet."); return; }
      copyText(lastDispatch, "📜 Dispatch copied ✔ — paste it into the chat!");
    });

    // Native share (K): only when supported. Becomes the primary action; the
    // copy button drops to a secondary ghost style (already set in HTML).
    var shareBtn = $("share-dispatch");
    if (shareBtn && navigator.share) {
      shareBtn.classList.remove("hidden");
      shareBtn.addEventListener("click", function () {
        if (!lastDispatch) { toast("No dispatch to share yet."); return; }
        navigator.share({ text: lastDispatch }).catch(function (err) {
          if (err && err.name === "AbortError") return; // user canceled — ignore
          copyText(lastDispatch, "📜 Dispatch copied ✔ — paste it into the chat!");
        });
      });
    }
    $("copy-report").addEventListener("click", function () {
      // Copy SYNCHRONOUSLY from the prefetched text so iOS Safari keeps us
      // inside the click gesture window (see refreshWarReport).
      if (lastReportText) {
        copyText(lastReportText, "📜 War report copied ✔ — go stir up the chat!");
        // Opportunistically refresh for next time (does not block this copy).
        refreshWarReport();
        return;
      }
      // Nothing cached yet (war hasn't loaded / fetch failed) — fetch then copy,
      // and refresh the cache so the next click is synchronous.
      toast("Fetching the latest standings — tap COPY again in a moment.");
      refreshWarReport();
    });
  }

  // ---------------- Wiring ----------------
  function init() {
    initEnlist();
    initTabs();
    initCopyButtons();

    $("start-skirmish").addEventListener("click", startSkirmish);
    var rematch = $("rematch");
    if (rematch) rematch.addEventListener("click", startSkirmish); // one-tap rematch (J)
    $("back-to-warroom").addEventListener("click", enterWarRoom);
    $("warroom-reenlist").addEventListener("click", openReenlist);
    var retryFinish = $("retry-finish");
    if (retryFinish) retryFinish.addEventListener("click", finishBattle);

    state.player = loadPlayer();
    if (state.player) {
      enterWarRoom();
    } else {
      showScreen("enlist");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
