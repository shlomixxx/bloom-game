  // ============ 1v1 DUEL SYSTEM ============
  function showDuelModal() {
    var existing = document.getElementById('duel-modal');
    if (existing) existing.remove();
    var modal = document.createElement('div');
    modal.id = 'duel-modal';
    modal.className = 'info-modal';
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    modal.innerHTML = '<div class="info-card" style="max-width:340px;direction:rtl">' +
      '<div style="font-size:16px;font-weight:700;margin-bottom:12px">⚔️ דו-קרב 1v1</div>' +
      '<div style="font-size:12px;color:#6F6E68;margin-bottom:12px">אתגר שחקן ספציפי! שניכם משחקים על אותו לוח — מי שמשיג יותר נקודות מנצח.</div>' +
      '<div style="font-size:11px;font-weight:600;margin-bottom:4px">קוד היריב</div>' +
      '<input id="duel-opponent" placeholder="BLOOM-XXXX" maxlength="10" style="width:100%;padding:8px;border:1px solid rgba(0,0,0,0.12);border-radius:8px;font-family:inherit;font-size:14px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;text-align:center;box-sizing:border-box;margin-bottom:8px">' +
      '<div style="font-size:11px;font-weight:600;margin-bottom:4px">💪 רמת קושי (לשניכם)</div>' +
      '<div id="duel-difficulty" style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">' +
        '<button type="button" class="diff-pill selected" data-diff="default" style="flex:1;min-width:60px;padding:5px 8px;font-size:11px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#1C1A18;color:#FAC775;font-weight:600;cursor:pointer">📦 רגיל</button>' +
        '<button type="button" class="diff-pill" data-diff="easy" style="flex:1;min-width:60px;padding:5px 8px;font-size:11px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#F5F2EC;color:#1C1A18;font-weight:600;cursor:pointer">😊 קל</button>' +
        '<button type="button" class="diff-pill" data-diff="medium" style="flex:1;min-width:60px;padding:5px 8px;font-size:11px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#F5F2EC;color:#1C1A18;font-weight:600;cursor:pointer">🎯 בינוני</button>' +
        '<button type="button" class="diff-pill" data-diff="hard" style="flex:1;min-width:60px;padding:5px 8px;font-size:11px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#F5F2EC;color:#1C1A18;font-weight:600;cursor:pointer">🔥 קשה</button>' +
        '<button type="button" class="diff-pill" data-diff="insane" style="flex:1;min-width:60px;padding:5px 8px;font-size:11px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#F5F2EC;color:#1C1A18;font-weight:600;cursor:pointer">💀 גהינום</button>' +
      '</div>' +
      '<div style="font-size:11px;font-weight:600;margin-bottom:4px">הימור (אופציונלי)</div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">' +
        '<input type="number" id="duel-amount" value="0" min="0" style="width:80px;padding:6px;border:1px solid rgba(0,0,0,0.12);border-radius:8px;font-family:inherit;font-size:14px;text-align:center;font-weight:700">' +
        '<span style="font-size:12px;color:#6F6E68">💎 · המנצח לוקח הכל (minus 5% עמלה)</span>' +
      '</div>' +
      '<button class="btn" id="duel-send" style="width:100%;margin-bottom:10px">שלח אתגר ⚔️</button>' +
      '<div id="duel-error" style="color:#C8472F;font-size:12px;text-align:center;min-height:18px"></div>' +
      '<div style="border-top:1px solid rgba(0,0,0,0.06);margin-top:10px;padding-top:10px">' +
        '<div style="font-size:12px;font-weight:600;margin-bottom:6px">הדו-קרבות שלי</div>' +
        '<div id="duel-list" style="font-size:12px;color:#6F6E68">טוען...</div>' +
      '</div>' +
      '<button class="btn secondary" style="width:100%;margin-top:10px" onclick="this.closest(\'.info-modal\').remove()">סגור</button>' +
    '</div>';
    document.body.appendChild(modal);

    // Load my duels
    loadMyDuels();

    // Difficulty pill picker (challenger picks one — both players get it)
    var selectedDuelDifficulty = 'default';
    modal.querySelectorAll('.diff-pill').forEach(function(pill) {
      pill.onclick = function() {
        modal.querySelectorAll('.diff-pill').forEach(function(p) {
          p.classList.remove('selected');
          p.style.background = '#F5F2EC';
          p.style.color = '#1C1A18';
        });
        pill.classList.add('selected');
        pill.style.background = '#1C1A18';
        pill.style.color = '#FAC775';
        selectedDuelDifficulty = pill.getAttribute('data-diff') || 'default';
      };
    });

    // Send challenge
    document.getElementById('duel-send').onclick = async function() {
      var opp = (document.getElementById('duel-opponent').value || '').trim().toUpperCase();
      var amt = parseInt(document.getElementById('duel-amount').value, 10) || 0;
      var errEl = document.getElementById('duel-error');
      errEl.textContent = '';
      if (!opp || opp.length < 6) { errEl.textContent = 'נא להזין קוד שחקן (BLOOM-XXXX)'; return; }
      if (amt > 0 && playerBalance < amt) { errEl.textContent = '💎 אין מספיק קרדיטים (' + playerBalance + ')'; return; }
      this.disabled = true; this.textContent = '...';
      try {
        var r = await fetch(API_BASE + '/api/duels', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: deviceId, opponentCode: opp, amount: amt, difficulty: selectedDuelDifficulty })
        });
        var d = await r.json();
        this.disabled = false; this.textContent = 'שלח אתגר ⚔️';
        if (d && d.ok) {
          if (amt > 0) { playerBalance -= amt; updateBalanceDisplay(); }
          errEl.style.color = '#2E8B6F';
          errEl.textContent = '✅ אתגר נשלח! מתחיל את המשחק שלך…';
          // Auto-start the challenger's game IMMEDIATELY. Without this the
          // challenger has to refresh and click "Play" manually — the bug
          // the user reported ("המשחק לא מצליח עד שעושה רענון"). The server
          // now accepts score submissions while the duel is still 'pending',
          // and settlement waits for both sides to submit.
          var duelRow = d.duel || {
            id: d.duelId,
            board_seed: d.seed,
            difficulty_label: d.difficulty,
            difficulty_weights: null,
            difficulty_speed_pct: null
          };
          activeDuelOpponentName = duelRow.opponent_name || opp;
          setTimeout(function() {
            var m = document.getElementById('duel-modal');
            if (m) m.remove();
            startDuelGame(duelRow.id, duelRow.board_seed, duelRow);
          }, 600); // brief confirmation flash before transitioning
        } else {
          var msgs = { self_duel: 'לא ניתן לאתגר את עצמך', opponent_not_found: 'שחקן לא נמצא', insufficient_balance: 'אין מספיק 💎', duels_disabled: 'דו-קרבות מושבתים' };
          errEl.textContent = msgs[d.reason] || 'שגיאה';
        }
      } catch(e) { this.disabled = false; this.textContent = 'שלח אתגר ⚔️'; errEl.textContent = 'שגיאת רשת'; }
    };
  }

  async function loadMyDuels() {
    var el = document.getElementById('duel-list');
    if (!el) return;
    try {
      var r = await fetch(API_BASE + '/api/duels/mine?deviceId=' + encodeURIComponent(deviceId));
      var d = await r.json();
      if (!d || !d.duels || !d.duels.length) { el.textContent = 'אין דו-קרבות'; return; }
      var html = '';
      d.duels.forEach(function(duel) {
        var isChallenger = duel.challenger_device === deviceId;
        var otherName = isChallenger ? (duel.opponent_name || duel.opponent_code) : (duel.challenger_name || duel.challenger_code);
        var statusMap = { pending: '⏳ ממתין', accepted: '🎮 משחקים', settled: '✅ הסתיים', tie: '🤝 תיקו', expired: '⏰ פג תוקף' };
        var statusText = statusMap[duel.status] || duel.status;
        var amtText = (duel.amount | 0) > 0 ? ' · ' + duel.amount + '💎' : '';
        var winText = '';
        if (duel.status === 'settled' && duel.winner_device) {
          winText = duel.winner_device === deviceId ? ' · <strong style="color:#2E8B6F">ניצחת!</strong>' : ' · <span style="color:#C8472F">הפסדת</span>';
        }
        var actionBtn = '';
        if (duel.status === 'pending' && !isChallenger) {
          actionBtn = '<button class="btn sm" style="font-size:10px;padding:3px 8px" onclick="acceptDuel(' + duel.id + ')">קבל ⚔️</button>';
        } else if (duel.status === 'accepted') {
          var myScore = isChallenger ? duel.challenger_score : duel.opponent_score;
          if (myScore == null) {
            actionBtn = '<button class="btn sm" style="font-size:10px;padding:3px 8px;background:#BA7517" onclick="playDuel(' + duel.id + ')">🎮 שחק</button>';
          } else {
            actionBtn = '<span style="font-size:10px;color:#2E8B6F">✓ סיימת (' + (myScore|0).toLocaleString() + ')</span>';
          }
        }
        html += '<div style="padding:6px 0;border-top:1px solid rgba(0,0,0,0.04)">' +
          '<span style="font-weight:600">vs ' + otherName + '</span>' + amtText + ' · ' + statusText + winText + ' ' + actionBtn +
        '</div>';
      });
      el.innerHTML = html;
    } catch(e) { el.textContent = 'שגיאה בטעינה'; }
  }

  window.acceptDuel = async function(id) {
    var r = await fetch(API_BASE + '/api/duels/' + id + '/accept', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId })
    });
    var d = await r.json();
    if (d && d.ok) {
      fetchPlayerCode();
      loadMyDuels();
      activeDuelOpponentName = d.duel ? (d.duel.challenger_name || d.duel.challenger_code || 'יריב') : 'יריב';
      startDuelGame(id, d.duel.board_seed, d.duel);
    } else {
      var msgs = { not_opponent: 'אתה לא היריב', not_pending: 'כבר קיבלת', expired: 'פג תוקף', insufficient_balance: 'אין מספיק 💎' };
      alert(msgs[d && d.reason] || 'שגיאה');
    }
  };

  window.playDuel = async function(id) {
    try {
      var r = await fetch(API_BASE + '/api/duels/mine?deviceId=' + encodeURIComponent(deviceId));
      var d = await r.json();
      if (!d || !d.duels) return;
      var duel = d.duels.find(function(dd) { return dd.id === id; });
      if (!duel || duel.status !== 'accepted') { alert('הדו-קרב לא פעיל'); return; }
      var isChallenger = duel.challenger_device === deviceId;
      activeDuelOpponentName = isChallenger ? (duel.opponent_name || duel.opponent_code || 'יריב') : (duel.challenger_name || duel.challenger_code || 'יריב');
      startDuelGame(id, duel.board_seed, duel);
    } catch(e) { alert('שגיאת רשת'); }
  };

  // Active duel state
  var activeDuelId = null;
  var activeDuelOpponentName = 'יריב';

  function startDuelGame(duelId, seed, duelRow) {
    activeDuelId = duelId;
    // Close the duel modal
    var modal = document.getElementById('duel-modal');
    if (modal) modal.remove();
    // Hide home if open
    hideHome();
    // Start the game with the duel's seed
    mode = 'practice'; // engine uses practice mode
    window._duelMode = true; // flag for UI
    window._duelOpponentName = activeDuelOpponentName || 'יריב';
    dailyDate = todayInIsrael();
    // Apply the challenger-chosen difficulty (both sides get the same one).
    // Falls back to admin globals if the duel row predates the difficulty
    // columns or the challenger picked 'default'.
    if (duelRow && duelRow.difficulty_weights) {
      sessionDifficulty = {
        label: duelRow.difficulty_label || 'custom',
        weights: duelRow.difficulty_weights,
        speed_pct: duelRow.difficulty_speed_pct || null
      };
    } else {
      sessionDifficulty = null;
    }
    grid = Array.from({length: getBoardRows()}, function() { return Array(getBoardCols()).fill(0); });
    score = 0; highestTier = 1; busy = false; dropsCount = 0;
    currentGameMaxChain = 0;
    tierUpHit = {};
    gameMergesPerTier = {};
    gamePointsPerTier = {};
    gameBestMergeTier = 0;
    gameTotalMerges = 0;
    gameStartTime = Date.now();
    // Use the duel's board seed for deterministic RNG
    rng = mulberry32(seed);
    dailySubmitted = false;
    nextPiece = pickPiece();
    updateModeBar();
    render();
    playMusic('game');
    ensureAudio();
    startEventSystem();
    trackEvent('duel_start', { duelId: duelId });
  }

  // Called from game-over to submit duel score
  function submitDuelScore(finalScore) {
    if (!activeDuelId) return;
    var duelId = activeDuelId;
    var oppName = window._duelOpponentName || 'יריב';
    activeDuelId = null;
    window._duelMode = false;
    fetch(API_BASE + '/api/duels/' + duelId + '/score', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, score: finalScore })
    }).then(function(r) { return r.json(); }).then(function(d) {
      showDuelResultOverlay(d, finalScore, oppName);
      if (d && (d.result === 'tie' || (d.result === 'settled' && d.winner === 'you'))) fetchPlayerCode();
      trackEvent('duel_score', { duelId: duelId, result: d && d.result });
      // If we're still 'waiting' for the opponent, poll the duel state so we
      // can flip the overlay from "..." to the real result the moment the
      // opponent finishes. Bug 4: previously the overlay stayed stuck on
      // "ממתין ליריב..." forever, even after opponent had submitted.
      // ALSO: attach a live spectator view of the opponent's actual game so
      // the player can watch instead of staring at a "..." spinner.
      if (d && d.result === 'waiting') {
        pollDuelUntilSettled(duelId, finalScore, oppName);
        attachDuelLiveSpectator(duelId, finalScore, oppName);
      }
    }).catch(function() {
      showDuelResultOverlay({ result: 'error' }, finalScore, oppName);
    });
  }

  // Poll a duel after we submitted but the opponent hasn't yet. Stops as soon
  // as the duel becomes 'settled' or 'tie', or after 5 minutes (whichever
  // comes first). Updates the in-flight result overlay in place.
  function pollDuelUntilSettled(duelId, myScore, oppName) {
    var attempts = 0;
    var maxAttempts = 150; // 150 × 2s = 5 minutes
    var poller = setInterval(function() {
      attempts++;
      if (attempts > maxAttempts) { clearInterval(poller); return; }
      fetch(API_BASE + '/api/duels/' + duelId, { method: 'GET' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(resp) {
          if (!resp || !resp.duel) return;
          var u = resp.duel;
          if (u.status === 'settled' || u.status === 'tie') {
            clearInterval(poller);
            // Tear down the live-spectator poller too, if any.
            stopDuelLiveSpectator();
            var isChallenger = u.challenger_device === deviceId;
            var oppScore = isChallenger ? u.opponent_score : u.challenger_score;
            var winner = null;
            if (u.status === 'settled') {
              winner = u.winner_device === deviceId ? 'you' : 'opponent';
            }
            // Compute prize from amount * 2 minus 5% rake (mirrors server)
            var prize = u.amount ? Math.round((u.amount | 0) * 2 * 0.95) : 0;
            replaceDuelResultOverlay({
              result: u.status === 'tie' ? 'tie' : 'settled',
              winner: winner,
              opponentScore: oppScore,
              prize: prize
            }, myScore, oppName);
            if (winner === 'you' || u.status === 'tie') fetchPlayerCode();
          }
        })
        .catch(function() {});
    }, 2000);
  }

  // ============================================================
  // DUEL LIVE SPECTATOR — embed an actual live view of the opponent
  // inside the "waiting" overlay so the player watches them play
  // in real time, not a mirror, not a spinner. Polls the universal
  // /api/live-state/:deviceId endpoint (fed by 5s heartbeats).
  // ============================================================
  var _duelSpectatorPoller = null;
  var _duelSpectatorTargetId = null;

  function stopDuelLiveSpectator() {
    if (_duelSpectatorPoller) { clearInterval(_duelSpectatorPoller); _duelSpectatorPoller = null; }
    _duelSpectatorTargetId = null;
  }

  function attachDuelLiveSpectator(duelId, myScore, oppName) {
    // Fetch the duel row once to learn the opponent's deviceId, then start
    // the live-state poller and inject a mini-board into the waiting overlay.
    fetch(API_BASE + '/api/duels/' + duelId, { method: 'GET' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(resp) {
        if (!resp || !resp.duel) return;
        var u = resp.duel;
        var oppDeviceId = (u.challenger_device === deviceId) ? u.opponent_device : u.challenger_device;
        if (!oppDeviceId) return;
        _duelSpectatorTargetId = oppDeviceId;
        injectDuelSpectatorWidget(myScore, oppName);
        // First poll immediately, then every 1.5s. Cheap: opponent's
        // heartbeat refreshes server-side every 5s, so we get a fresh
        // snapshot ≈3× per heartbeat — feels live without spamming.
        pollDuelLiveState();
        _duelSpectatorPoller = setInterval(pollDuelLiveState, 1500);
      })
      .catch(function() {});
  }

  function injectDuelSpectatorWidget(myScore, oppName) {
    var overlay = document.querySelector('[data-duel-result-overlay]');
    if (!overlay) return;
    // Find the inner card (the dark rounded box). It's the only direct child div.
    var card = overlay.querySelector('div');
    if (!card) return;
    // Don't inject twice
    if (overlay.querySelector('[data-duel-spec-widget]')) return;
    var ROWS = getBoardRows(), COLS = getBoardCols();
    var cellsHtml = '';
    for (var i = 0; i < ROWS * COLS; i++) cellsHtml += '<div class="dspec-cell" data-i="' + i + '"></div>';
    var widget = document.createElement('div');
    widget.setAttribute('data-duel-spec-widget', '1');
    widget.style.cssText = 'margin-top:14px;padding:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:14px;direction:rtl';
    widget.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:10px">' +
        '<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#9FE1CB">' +
          '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#2E8B6F;animation:dspecPulse 1.2s ease-in-out infinite"></span>' +
          '<span>צופה ב-' + escapeHtml(oppName) + ' חי</span>' +
        '</div>' +
        '<div style="font-size:11px;color:#A8A6A0" data-dspec-status>מתחבר…</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:center;gap:18px;margin-bottom:10px;font-size:11px">' +
        '<div style="text-align:center"><div style="color:#A8A6A0">ניקוד שלו</div><div data-dspec-score style="font-size:20px;font-weight:900;color:#FAC775">—</div></div>' +
        '<div style="text-align:center"><div style="color:#A8A6A0">הניקוד שלך</div><div style="font-size:20px;font-weight:900;color:#9FE1CB">' + myScore.toLocaleString() + '</div></div>' +
      '</div>' +
      // direction:ltr matches the main game's .grid-wrap (also ltr); without
      // this the cells flow right-to-left from the rtl widget parent and the
      // board reads as a horizontal mirror of what the opponent actually sees.
      '<div class="dspec-grid" style="direction:ltr;display:grid;grid-template-columns:repeat(' + COLS + ',1fr);gap:3px;background:#0E0D0C;padding:6px;border-radius:8px;max-width:200px;margin:0 auto">' + cellsHtml + '</div>' +
      '<style>' +
        '.dspec-cell{aspect-ratio:1;background:#2A2724;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:14px}' +
        '@keyframes dspecPulse{0%,100%{opacity:1}50%{opacity:0.3}}' +
      '</style>';
    // Insert before the "Play Again" button — last child of card.
    var btn = card.querySelector('button');
    if (btn && btn.parentNode === card) card.insertBefore(widget, btn);
    else card.appendChild(widget);
  }

  function pollDuelLiveState() {
    if (!_duelSpectatorTargetId) return;
    // If the player dismissed the waiting overlay (e.g. clicked "play again"),
    // the widget is gone — tear down the poller so we don't keep hammering
    // the live-state endpoint in the background.
    if (!document.querySelector('[data-duel-spec-widget]')) {
      stopDuelLiveSpectator();
      return;
    }
    fetch(API_BASE + '/api/live-state/' + encodeURIComponent(_duelSpectatorTargetId))
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(d) {
        var statusEl = document.querySelector('[data-dspec-status]');
        var scoreEl = document.querySelector('[data-dspec-score]');
        var gridHost = document.querySelector('[data-duel-spec-widget] .dspec-grid');
        if (!gridHost) return; // widget gone (overlay closed)
        if (!d) {
          if (statusEl) statusEl.textContent = '🔴 לא מחובר';
          return;
        }
        if (statusEl) statusEl.textContent = '🟢 מתעדכן';
        if (scoreEl) scoreEl.textContent = (d.score | 0).toLocaleString();
        if (!Array.isArray(d.grid)) return;
        var tiers = getActiveTiers();
        var cells = gridHost.children;
        var idx = 0;
        for (var r = 0; r < d.grid.length; r++) {
          var row = d.grid[r] || [];
          for (var c = 0; c < row.length; c++) {
            var cell = cells[idx];
            if (cell) {
              var t = row[c] | 0;
              if (t > 0 && tiers[t]) {
                cell.style.background = tiers[t].bg;
                cell.style.color = tiers[t].fg;
                cell.innerHTML = tiers[t].svg || '';
              } else {
                cell.style.background = '#2A2724';
                cell.style.color = '';
                cell.innerHTML = '';
              }
            }
            idx++;
          }
        }
      })
      .catch(function() {
        var statusEl = document.querySelector('[data-dspec-status]');
        if (statusEl) statusEl.textContent = '⚠️ שגיאת רשת';
      });
  }

  // Swap the existing "waiting" overlay for a fresh result overlay. Called
  // by the poller above when the opponent's score lands.
  function replaceDuelResultOverlay(d, myScore, oppName) {
    // Remove any open duel-result overlay (created by showDuelResultOverlay
    // — identified by the dark backdrop with the inline border style).
    document.querySelectorAll('[data-duel-result-overlay]').forEach(function(el) {
      el.remove();
    });
    showDuelResultOverlay(d, myScore, oppName);
  }

  function showDuelResultOverlay(d, myScore, oppName) {
    var emoji, title, detail, color, showConfettiFlag = false;
    if (d && d.result === 'settled' && d.winner === 'you') {
      emoji = '🏆'; title = 'ניצחת!'; color = '#2E8B6F'; showConfettiFlag = true;
      detail = '<div style="font-size:14px;color:#9FE1CB;margin-top:6px">+' + (d.prize || 0) + ' 💎 פרס</div>';
    } else if (d && d.result === 'settled' && d.winner === 'opponent') {
      emoji = '😔'; title = 'הפסדת'; color = '#C8472F';
      detail = '<div style="font-size:14px;color:#F5C4B3;margin-top:6px">היריב היה טוב יותר הפעם</div>';
    } else if (d && d.result === 'tie') {
      emoji = '🤝'; title = 'תיקו!'; color = '#BA7517';
      detail = '<div style="font-size:14px;color:#FAC775;margin-top:6px">ההימור הוחזר</div>';
    } else if (d && d.result === 'waiting') {
      emoji = '⏳'; title = 'ממתין ליריב...'; color = '#6B5CE7';
      detail = '<div style="font-size:13px;color:#B5B3F0;margin-top:6px">הניקוד שלך נשלח. נעדכן כשהיריב יסיים</div>';
    } else {
      emoji = '⚔️'; title = 'דו-קרב נשלח'; color = '#6B5CE7';
      detail = '';
    }

    // Build scores comparison
    var oppScore = (d && d.opponentScore) ? d.opponentScore : null;
    var scoresHtml = '<div style="display:flex;justify-content:center;gap:20px;margin:14px 0;font-size:13px">' +
      '<div style="text-align:center"><div style="font-size:11px;color:#A8A6A0">אתה</div><div style="font-size:22px;font-weight:900;color:#FAC775">' + myScore.toLocaleString() + '</div></div>' +
      '<div style="align-self:center;font-size:18px;color:#A8A6A0">vs</div>' +
      '<div style="text-align:center"><div style="font-size:11px;color:#A8A6A0">' + escapeHtml(oppName) + '</div><div style="font-size:22px;font-weight:900;color:' + (oppScore != null ? '#FAC775' : '#555') + '">' + (oppScore != null ? oppScore.toLocaleString() : '...') + '</div></div>' +
    '</div>';

    var overlay = document.createElement('div');
    overlay.setAttribute('data-duel-result-overlay', '1');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;direction:rtl';
    overlay.innerHTML =
      '<div style="background:#1C1A18;border-radius:20px;padding:28px 24px;max-width:320px;width:90%;text-align:center;border:2px solid ' + color + ';box-shadow:0 0 40px ' + color + '33">' +
        '<div style="font-size:48px;margin-bottom:8px">' + emoji + '</div>' +
        '<div style="font-size:24px;font-weight:900;color:' + color + '">' + title + '</div>' +
        scoresHtml +
        detail +
        '<button onclick="this.closest(\'div[style]\').parentElement.remove();init(\'practice\',{fresh:true})" style="margin-top:18px;width:100%;padding:12px;border:none;border-radius:12px;background:#FAC775;color:#412402;font-size:16px;font-weight:800;cursor:pointer;font-family:inherit">שחק שוב</button>' +
      '</div>';
    document.body.appendChild(overlay);

    if (showConfettiFlag && typeof showConfetti === 'function') showConfetti(40);
    if (showConfettiFlag) buzz([80, 40, 80, 40, 80]);
    if (d && d.result === 'settled' && d.winner === 'you') shakeGrid(4);
  }

  function showDuelResultToast(text) {
    // Kept for backward compat — but overlay is used now
    var t = document.createElement('div');
    t.className = 'credit-toast';
    t.style.background = 'linear-gradient(135deg, #1C1A18, #2C2A28)';
    t.style.color = '#FAC775';
    t.style.fontSize = '14px';
    t.innerHTML = '<span>' + text + '</span>';
    document.body.appendChild(t);
    setTimeout(function() { t.classList.add('show'); }, 10);
    setTimeout(function() { t.classList.remove('show'); setTimeout(function() { t.remove(); }, 400); }, 4000);
  }

  // ============================================================
  // INCOMING-DUEL NOTIFICATIONS (Bug 2 fix)
  // ============================================================
  // Polls /api/duels/mine on boot and every 60s while the app is visible.
  // Shows a top-right toast for:
  //  - pending duels I haven't accepted yet (someone challenged me)
  //  - settled duels I haven't seen the result of (notify of win/loss)
  // Tracks already-seen duel IDs in sessionStorage so we don't spam on
  // every poll. sessionStorage is per-tab and clears on close, so a player
  // who closes and re-opens the app DOES see the badge again — that's the
  // desired re-notification behavior.
  var SEEN_DUELS_KEY = 'bloom_seen_duel_notifications';
  function loadSeenDuels() {
    try { return JSON.parse(sessionStorage.getItem(SEEN_DUELS_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function markDuelSeen(duelId, status) {
    try {
      var seen = loadSeenDuels();
      seen[String(duelId)] = status;
      sessionStorage.setItem(SEEN_DUELS_KEY, JSON.stringify(seen));
    } catch (e) {}
  }
  function showDuelNotificationBanner(opts) {
    // opts: { kind: 'invite'|'won'|'lost'|'tie', name, score?, onTap }
    var existing = document.querySelector('[data-duel-notif="' + opts.id + '"]');
    if (existing) return; // already showing
    var b = document.createElement('div');
    b.setAttribute('data-duel-notif', opts.id);
    var bg = '#1C1A18', border = '#6B5CE7', emoji = '⚔️', title = 'אתגר חדש', sub = '';
    if (opts.kind === 'invite') {
      emoji = '⚔️'; title = (opts.name || 'מישהו') + ' אתגר/ה אותך!'; sub = 'לחץ לקבל'; border = '#6B5CE7';
    } else if (opts.kind === 'won') {
      emoji = '🏆'; title = 'ניצחת בדו-קרב!'; sub = 'מול ' + (opts.name || 'יריב'); border = '#2E8B6F';
    } else if (opts.kind === 'lost') {
      emoji = '😔'; title = 'הפסדת בדו-קרב'; sub = 'מול ' + (opts.name || 'יריב'); border = '#C8472F';
    } else if (opts.kind === 'tie') {
      emoji = '🤝'; title = 'תיקו בדו-קרב'; sub = 'מול ' + (opts.name || 'יריב'); border = '#BA7517';
    }
    b.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%) translateY(-20px);' +
      'opacity:0;transition:opacity 240ms ease-out,transform 240ms ease-out;' +
      'z-index:9999;background:' + bg + ';color:#FAC775;border:2px solid ' + border + ';' +
      'border-radius:14px;padding:10px 16px;direction:rtl;font-family:inherit;font-size:13px;' +
      'box-shadow:0 8px 24px rgba(0,0,0,0.35);cursor:pointer;max-width:320px;width:calc(100vw - 32px);';
    b.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px">' +
        '<div style="font-size:22px">' + emoji + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:800;color:#FFFFFF;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escDuelHtml(title) + '</div>' +
          (sub ? '<div style="font-size:11px;color:#A8A6A0;margin-top:2px">' + escDuelHtml(sub) + '</div>' : '') +
        '</div>' +
        '<div style="font-size:11px;color:#A8A6A0">✕</div>' +
      '</div>';
    document.body.appendChild(b);
    requestAnimationFrame(function() {
      b.style.opacity = '1';
      b.style.transform = 'translateX(-50%) translateY(0)';
    });
    var dismiss = function() {
      b.style.opacity = '0';
      b.style.transform = 'translateX(-50%) translateY(-20px)';
      setTimeout(function() { b.remove(); }, 250);
    };
    b.onclick = function() {
      if (opts.onTap) try { opts.onTap(); } catch (e) {}
      dismiss();
    };
    setTimeout(dismiss, 7000);
  }
  function escDuelHtml(s) {
    return String(s).replace(/[&<>"']/g, function(c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  async function checkIncomingDuels() {
    if (!deviceId) return;
    if (document.visibilityState === 'hidden') return;
    try {
      var r = await fetch(API_BASE + '/api/duels/mine?deviceId=' + encodeURIComponent(deviceId));
      if (!r.ok) return;
      var d = await r.json();
      if (!d || !d.duels) return;
      var seen = loadSeenDuels();
      var myCode = '';
      try { myCode = localStorage.getItem('bloom_player_code') || ''; } catch (e) {}
      d.duels.forEach(function(duel) {
        var prevSeen = seen[String(duel.id)];
        // Skip duels currently being played (mid-game) — they'll get a result overlay.
        if (activeDuelId && duel.id === activeDuelId) return;

        if (duel.status === 'pending') {
          // Pending where I'm the opponent → I was challenged. Notify once.
          var iAmOpponent = duel.opponent_device === deviceId ||
            (myCode && duel.opponent_code === myCode);
          var iAmChallenger = duel.challenger_device === deviceId;
          if (iAmOpponent && prevSeen !== 'pending') {
            showDuelNotificationBanner({
              id: duel.id,
              kind: 'invite',
              name: duel.challenger_name || duel.challenger_code,
              onTap: function() { showDuelModal(); }
            });
            markDuelSeen(duel.id, 'pending');
          } else if (iAmChallenger && duel.challenger_score == null && prevSeen !== 'pending-c') {
            // I sent it and haven't played yet. Don't notify — just track.
            markDuelSeen(duel.id, 'pending-c');
          }
        } else if ((duel.status === 'settled' || duel.status === 'tie') && prevSeen !== duel.status) {
          // Result available, haven't seen it yet — but only notify if we
          // actually played this duel (have a score). The overlay shown
          // by submitDuelScore handles the same-session case; this banner
          // covers the cross-session case (closed app, opponent finished).
          var iPlayed = (duel.challenger_device === deviceId && duel.challenger_score != null) ||
                        (duel.opponent_device === deviceId && duel.opponent_score != null);
          if (iPlayed) {
            var iAmChall = duel.challenger_device === deviceId;
            var opponentName = iAmChall ? (duel.opponent_name || duel.opponent_code) : (duel.challenger_name || duel.challenger_code);
            var kind = 'tie';
            if (duel.status === 'settled') {
              kind = (duel.winner_device === deviceId) ? 'won' : 'lost';
            }
            showDuelNotificationBanner({
              id: duel.id,
              kind: kind,
              name: opponentName,
              onTap: function() { showDuelModal(); }
            });
          }
          markDuelSeen(duel.id, duel.status);
        }
      });
    } catch (e) {}
  }
  // Expose for boot.
  window.__bloomCheckIncomingDuels = checkIncomingDuels;

  // ============ IN-GAME TILE SHOP ============
  var tilePrices = null; // fetched once from server

  var powerupPrices = null;

  async function loadTilePrices() {
    if (tilePrices) return;
    try {
      var r = await fetch(API_BASE + '/api/tile-prices');
      var d = await r.json();
      if (d && d.ok && d.enabled) tilePrices = d.prices;
      else tilePrices = null;
    } catch (e) { tilePrices = null; }
    // Load power-up prices from config
    try {
      var r2 = await fetch(API_BASE + '/api/tile-prices');
      // Power-up prices are in the config too — fetch them via the config endpoint fallback
      powerupPrices = {
        random_tile: 15, choose_tile: 40, random_row: 60, choose_row: 100 // defaults
      };
    } catch(e) {}
  }

  function updateBalanceDisplay() {
    var el = document.getElementById('balance-display');
    if (!el) return;
    var b = playerBalance;
    var text = b >= 100000 ? Math.round(b / 1000) + 'K'
      : b >= 10000 ? (b / 1000).toFixed(1).replace('.0', '') + 'K'
      : b >= 1000 ? (b / 1000).toFixed(1).replace('.0', '') + 'K'
      : String(b);
    el.textContent = text;
  }

  // Active power-up mode
  var activePowerup = null;
  var activePowerupCost = 0;

  function showTileShop() {
    if (!tilePrices) { loadTilePrices().then(showTileShop); return; }
    if (busy) return;
    var existing = document.getElementById('tile-shop-modal');
    if (existing) { existing.remove(); return; }

    var modal = document.createElement('div');
    modal.id = 'tile-shop-modal';
    var html = '<button class="ts-close" id="ts-close-btn">✕</button>';
    html += '<div class="ts-header"><span>🛒 חנות משחק</span><span style="color:#BA7517;font-weight:700">💎 ' + playerBalance + '</span></div>';

    // Section 1: Buy tiles
    html += '<div class="ts-section-label">קנה אריח</div>';
    html += '<div class="ts-grid">';
    for (var t = 2; t <= MAX_TIER; t++) {
      var ti = getActiveTiers()[t];
      var price = tilePrices[t] || 0;
      var canBuy = playerBalance >= price;
      html += '<button class="ts-tile' + (!canBuy ? ' ts-locked' : '') + '" data-tier="' + t + '" data-price="' + price + '"' + (!canBuy ? ' disabled' : '') + '>' +
        '<div class="ts-icon" style="background:' + ti.bg + ';color:' + ti.fg + '">' + ti.svg + '</div>' +
        '<div class="ts-name">' + ti.name + '</div>' +
        '<div class="ts-price">' + price + ' 💎</div>' +
      '</button>';
    }
    html += '</div>';

    // Section 2: Power-ups
    var pp = powerupPrices || { random_tile: 15, choose_tile: 40, random_row: 60, choose_row: 100 };
    html += '<div class="ts-section-label">כלי עזר</div>';
    html += '<div class="ts-powerups">';
    html += '<button class="ts-power" data-power="random_tile"' + (playerBalance < pp.random_tile ? ' disabled' : '') + '>' +
      '<span class="ts-power-icon">🎲</span><span class="ts-power-name">מחק אריח<br>אקראי</span><span class="ts-power-price">' + pp.random_tile + ' 💎</span></button>';
    html += '<button class="ts-power" data-power="choose_tile"' + (playerBalance < pp.choose_tile ? ' disabled' : '') + '>' +
      '<span class="ts-power-icon">🎯</span><span class="ts-power-name">מחק אריח<br>לבחירתך</span><span class="ts-power-price">' + pp.choose_tile + ' 💎</span></button>';
    html += '<button class="ts-power" data-power="random_row"' + (playerBalance < pp.random_row ? ' disabled' : '') + '>' +
      '<span class="ts-power-icon">🎲</span><span class="ts-power-name">פנה שורה<br>אקראית</span><span class="ts-power-price">' + pp.random_row + ' 💎</span></button>';
    html += '<button class="ts-power ts-power-premium" data-power="choose_row"' + (playerBalance < pp.choose_row ? ' disabled' : '') + '>' +
      '<span class="ts-power-icon">👑</span><span class="ts-power-name">פנה שורה<br>לבחירתך</span><span class="ts-power-price">' + pp.choose_row + ' 💎</span></button>';
    html += '</div>';
    html += '<div class="ts-hint">🎲 = המערכת בוחרת · 🎯 = אתה בוחר · 👑 = פרימיום</div>';

    modal.innerHTML = html;
    document.getElementById('grid-wrap').appendChild(modal);

    document.getElementById('ts-close-btn').onclick = function() { modal.remove(); };
    modal.addEventListener('pointerdown', function(e) { if (e.target === modal) modal.remove(); });

    // Wire tile buy buttons
    modal.querySelectorAll('.ts-tile:not([disabled])').forEach(function(btn) {
      btn.onclick = function() {
        var tier = parseInt(this.getAttribute('data-tier'), 10);
        var self = this;
        self.style.opacity = '0.5';
        fetch(API_BASE + '/api/player/buy-tile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: deviceId, tier: tier })
        }).then(function(r) { return r.json(); }).then(function(d) {
          if (d && d.ok) {
            playerBalance = d.newBalance;
            try { localStorage.setItem(PLAYER_BALANCE_KEY, String(d.newBalance)); } catch(e) {}
            updateBalanceDisplay();
            nextPiece = tier;
            render();
            modal.remove();
            showCreditToast(-d.cost, getActiveTiers()[tier].name);
            trackEvent('purchase', { item: 'tile', tier: tier, cost: d.cost });
          } else {
            self.style.opacity = '1';
            self.querySelector('.ts-price').textContent = d.reason === 'insufficient_balance' ? 'אין 💎' : 'שגיאה';
          }
        }).catch(function() { self.style.opacity = '1'; });
      };
    });

    // Wire power-up buttons
    modal.querySelectorAll('.ts-power:not([disabled])').forEach(function(btn) {
      btn.onclick = function() {
        // Block double-buy
        if (activePowerup) {
          modal.remove();
          return;
        }
        var power = this.getAttribute('data-power');
        var self = this;
        self.style.opacity = '0.5';
        var configKey = 'powerup_' + power;
        fetch(API_BASE + '/api/player/buy-powerup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: deviceId, powerup: configKey })
        }).then(function(r) { return r.json(); }).then(function(d) {
          if (d && d.ok) {
            playerBalance = d.newBalance;
            try { localStorage.setItem(PLAYER_BALANCE_KEY, String(d.newBalance)); } catch(e) {}
            updateBalanceDisplay();
            modal.remove();
            executePowerup(power, d.cost);
            trackEvent('purchase', { item: 'powerup', type: power, cost: d.cost });
          } else {
            self.style.opacity = '1';
          }
        }).catch(function() { self.style.opacity = '1'; });
      };
    });
  }

  function executePowerup(type, cost) {
    if (type === 'random_tile') {
      var filled = [];
      for (var r = 0; r < getBoardRows(); r++)
        for (var c = 0; c < getBoardCols(); c++)
          if (grid[r][c] > 0) filled.push([r, c]);
      if (filled.length === 0) return;
      var pick = filled[Math.floor(Math.random() * filled.length)];
      // Roulette animation → then delete
      animateRouletteTile(filled, pick, function() {
        grid[pick[0]][pick[1]] = 0;
        applyGravity();
        render();
        showCreditToast(-cost, 'פינוי אריח 🎲');
        if (mode === 'practice') savePracticeGameState();
      });
    }
    else if (type === 'choose_tile') {
      activePowerup = 'choose_tile';
      activePowerupCost = cost;
      showPowerupHint('🎯 לחץ על האריח שרוצה לפנות');
      showCreditToast(-cost, 'בחר אריח לפינוי');
    }
    else if (type === 'random_row') {
      var filledRows = [];
      for (var r = 0; r < getBoardRows(); r++) {
        if (grid[r].some(function(c) { return c > 0; })) filledRows.push(r);
      }
      if (filledRows.length === 0) return;
      var rowIdx = filledRows[Math.floor(Math.random() * filledRows.length)];
      // Slot machine animation → then delete
      animateRouletteRow(filledRows, rowIdx, function() {
        for (var c = 0; c < getBoardCols(); c++) grid[rowIdx][c] = 0;
        applyGravity();
        render();
        showCreditToast(-cost, 'פינוי שורה 🎲');
        if (mode === 'practice') savePracticeGameState();
      });
    }
    else if (type === 'choose_row') {
      activePowerup = 'choose_row';
      activePowerupCost = cost;
      showPowerupHint('👑 לחץ על השורה שרוצה לפנות');
      showCreditToast(-cost, 'בחר שורה לפינוי');
    }
  }

  // Roulette animation for random tile: rapidly highlights tiles, slows down, explodes target
  function animateRouletteTile(candidates, target, onDone) {
    var gridEl = document.getElementById('grid');
    if (!gridEl) { onDone(); return; }
    var COLS = getBoardCols();
    var steps = 18 + Math.floor(Math.random() * 6); // 18-24 flashes
    var step = 0;
    var prevCell = null;

    function tick() {
      // Remove previous highlight
      if (prevCell) { prevCell.classList.remove('roulette-flash'); prevCell.style.removeProperty('box-shadow'); }
      if (step >= steps) {
        // Land on target → explode!
        var targetCell = gridEl.children[target[0] * COLS + target[1]];
        if (targetCell) {
          targetCell.classList.add('roulette-hit');
          setTimeout(function() {
            targetCell.classList.remove('roulette-hit');
            onDone();
          }, 500);
        } else { onDone(); }
        return;
      }
      // Pick random candidate (last 4 steps → force closer to target)
      var pick = step >= steps - 3 ? target : candidates[Math.floor(Math.random() * candidates.length)];
      var cell = gridEl.children[pick[0] * COLS + pick[1]];
      if (cell) {
        cell.classList.add('roulette-flash');
        cell.style.boxShadow = '0 0 12px 4px rgba(250,199,117,0.7)';
        prevCell = cell;
      }
      step++;
      // Slow down: starts fast (60ms), ends slow (200ms)
      var delay = 60 + Math.pow(step / steps, 2.5) * 200;
      setTimeout(tick, delay);
    }
    tick();
  }

  // Slot machine animation for random row: cycles rows up/down, slows down, explodes target row
  function animateRouletteRow(candidateRows, targetRow, onDone) {
    var gridEl = document.getElementById('grid');
    if (!gridEl) { onDone(); return; }
    var COLS = getBoardCols();
    var steps = 12 + Math.floor(Math.random() * 4);
    var step = 0;
    var prevRow = -1;

    function clearRowHighlight(row) {
      for (var c = 0; c < COLS; c++) {
        var cell = gridEl.children[row * COLS + c];
        if (cell) { cell.classList.remove('roulette-flash'); cell.style.removeProperty('box-shadow'); }
      }
    }
    function highlightRow(row) {
      for (var c = 0; c < COLS; c++) {
        var cell = gridEl.children[row * COLS + c];
        if (cell) { cell.classList.add('roulette-flash'); cell.style.boxShadow = '0 0 12px 4px rgba(250,199,117,0.7)'; }
      }
    }

    function tick() {
      if (prevRow >= 0) clearRowHighlight(prevRow);
      if (step >= steps) {
        // Land on target row → explode all cells!
        highlightRow(targetRow);
        setTimeout(function() {
          for (var c = 0; c < COLS; c++) {
            var cell = gridEl.children[targetRow * COLS + c];
            if (cell) { cell.classList.remove('roulette-flash'); cell.classList.add('roulette-hit'); }
          }
          setTimeout(function() {
            for (var c = 0; c < COLS; c++) {
              var cell = gridEl.children[targetRow * COLS + c];
              if (cell) cell.classList.remove('roulette-hit');
            }
            onDone();
          }, 500);
        }, 300);
        return;
      }
      // Cycle through rows (last 3 steps → target)
      var row = step >= steps - 2 ? targetRow : candidateRows[step % candidateRows.length];
      highlightRow(row);
      prevRow = row;
      step++;
      var delay = 80 + Math.pow(step / steps, 2.5) * 250;
      setTimeout(tick, delay);
    }
    tick();
  }

  function showPowerupHint(text) {
    var existing = document.getElementById('powerup-hint');
    if (existing) existing.remove();
    var hint = document.createElement('div');
    hint.id = 'powerup-hint';
    hint.className = 'powerup-hint';
    hint.innerHTML = '<span>' + text + '</span><button id="powerup-cancel-btn" class="powerup-cancel">✕ ביטול</button>';
    var wrap = document.getElementById('grid-wrap');
    if (wrap) wrap.appendChild(hint);
    document.getElementById('powerup-cancel-btn').onclick = function(e) {
      e.stopPropagation();
      cancelPowerup();
    };
  }

  function cancelPowerup() {
    if (!activePowerup) return;
    // Refund credits
    if (activePowerupCost > 0) {
      playerBalance += activePowerupCost;
      try { localStorage.setItem(PLAYER_BALANCE_KEY, String(playerBalance)); } catch(e) {}
      updateBalanceDisplay();
      showCreditToast(activePowerupCost, 'ביטול — החזר 💎');
      // Server refund
      fetch(API_BASE + '/api/player/buy-powerup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId, powerup: 'refund', refundAmount: activePowerupCost })
      }).catch(function() {});
    }
    activePowerup = null;
    activePowerupCost = 0;
    var hint = document.getElementById('powerup-hint');
    if (hint) hint.remove();
  }

  function handlePowerupClick(row, col) {
    if (!activePowerup) return false;
    if (activePowerup === 'choose_tile') {
      if (grid[row][col] > 0) {
        // Explosion animation then delete
        var gridEl = document.getElementById('grid');
        var COLS = getBoardCols();
        var cell = gridEl ? gridEl.children[row * COLS + col] : null;
        if (cell) {
          cell.classList.add('roulette-hit');
          setTimeout(function() {
            grid[row][col] = 0;
            applyGravity();
            render();
            if (mode === 'practice') savePracticeGameState();
          }, 450);
        } else {
          grid[row][col] = 0; applyGravity(); render();
          if (mode === 'practice') savePracticeGameState();
        }
      }
      activePowerup = null; activePowerupCost = 0;
      var hint = document.getElementById('powerup-hint');
      if (hint) hint.remove();
      return true;
    }
    if (activePowerup === 'choose_row') {
      var allMax = grid[row].every(function(c) { return c === MAX_TIER; });
      if (allMax) {
        showPowerupHint('❌ שורה מלאת כתרים! בחר שורה אחרת');
        return true;
      }
      // Explosion animation for entire row
      var gridEl = document.getElementById('grid');
      var COLS = getBoardCols();
      for (var c = 0; c < COLS; c++) {
        var cell = gridEl ? gridEl.children[row * COLS + c] : null;
        if (cell) cell.classList.add('roulette-hit');
      }
      setTimeout(function() {
        for (var c = 0; c < getBoardCols(); c++) grid[row][c] = 0;
        applyGravity();
        render();
        if (mode === 'practice') savePracticeGameState();
      }, 450);
      activePowerup = null; activePowerupCost = 0;
      var hint = document.getElementById('powerup-hint');
      if (hint) hint.remove();
      return true;
    }
    return false;
  }

  // Same idea for board dimensions (added in Step 2 below).
  const BEST_KEY = 'bloom_best_score';
  const NAME_KEY = 'bloom_player_name';
  const DEVICE_KEY = 'bloom_device_id';
  const DAILY_PLAYED_PREFIX = 'bloom_daily_';
  const MUTE_KEY = 'bloom_muted';
  const MUSIC_MUTE_KEY = 'bloom_muted_music';
  const SFX_MUTE_KEY = 'bloom_muted_sfx';
  const STREAK_KEY = 'bloom_streak';
  const ACH_KEY = 'bloom_achievements';
  const GAMES_COUNT_KEY = 'bloom_games_played';
  // Onboarding progress: 0=fresh, 1=saw "tap a column", 2=saw "merge!", 3=saw "chain!" / done.
  const ONBOARD_KEY = 'bloom_onboard_step';
  function getOnboardStep() { return parseInt(localStorage.getItem(ONBOARD_KEY) || '0', 10) || 0; }
  function setOnboardStep(n) { try { localStorage.setItem(ONBOARD_KEY, String(n | 0)); } catch (e) {} }
  // Lifetime "personal bests" — only ever grow.
  const BEST_TIER_KEY  = 'bloom_best_tier_ever';
  const BEST_CHAIN_KEY = 'bloom_best_chain_ever';
  const BEST_STREAK_KEY = 'bloom_best_streak_ever';
  const TOTAL_SCORE_KEY = 'bloom_total_lifetime_score';

  // Same-origin API. When the game is served from the Express backend, this
  // works as-is. When opened from file:// the leaderboard simply won't load.
