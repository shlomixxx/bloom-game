  // ============ 1v1 DUEL SYSTEM ============
  // DU.2 — read the shared wager input (applies to ALL three modes: friend
  // duel, random duel, live race). Clamped to a non-negative integer.
  function _readDuelWager(modal) {
    var el = (modal || document).querySelector('#duel-amount');
    var w = parseInt((el && el.value) || '0', 10) || 0;
    return Math.max(0, w);
  }
  // Returns true if the player can afford the wager; otherwise paints an
  // inline error (never a blocking alert) and returns false.
  function _wagerAffordable(modal, wager) {
    if (!(wager > 0)) return true;
    if (typeof playerBalance === 'number' && playerBalance >= wager) return true;
    var errEl = (modal || document).querySelector('#duel-error');
    if (errEl) {
      errEl.style.color = '#C8472F';
      errEl.textContent = '💎 אין מספיק יהלומים להימור (' + (playerBalance | 0) + ') — הורד את ההימור או קנה יהלומים';
    }
    return false;
  }

  // opts: { prefillSuffix } — used when launching from leaderboard "challenge" buttons
  function showDuelModal(opts) {
    opts = opts || {};
    var pre = (opts.prefillSuffix || '').toString().toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 4);
    var existing = document.getElementById('duel-modal');
    if (existing) existing.remove();
    var modal = document.createElement('div');
    modal.id = 'duel-modal';
    modal.className = 'info-modal';
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    var myCodePill = '';
    if (typeof playerCode !== 'undefined' && playerCode) {
      myCodePill = '<div id="duel-my-code" style="font-size:11px;background:#FFF7E6;border:1px solid #FAC775;border-radius:8px;padding:6px 10px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer" title="הקוד שלי — לחץ כדי להעתיק ולשלוח לחבר">' +
        '<span style="color:#6F6E68">הקוד שלי</span>' +
        '<strong style="font-family:ui-monospace,monospace;letter-spacing:0.08em">' + playerCode + '</strong>' +
        '<span style="color:#BA7517">📋 העתק</span>' +
      '</div>';
    }
    modal.innerHTML = '<div class="info-card" style="max-width:340px;direction:rtl">' +
      '<div style="font-size:16px;font-weight:700;margin-bottom:12px">⚔️ דו-קרב 1v1</div>' +
      '<div style="font-size:12px;color:#6F6E68;margin-bottom:12px">אתגר שחקן ספציפי! שניכם משחקים על אותו לוח — מי שמשיג יותר נקודות מנצח.</div>' +
      myCodePill +
      // Friends picker — list of existing friends with one-tap "challenge".
      // Way faster than typing a 4-char code, and the user can search by
      // name when the list grows. Hidden until fetchFriends resolves so a
      // player with no friends doesn't see an empty panel.
      '<div id="duel-friends-panel" style="display:none;margin-bottom:10px;border:1px solid rgba(0,0,0,0.08);border-radius:10px;background:#FFFDF8;overflow:hidden">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding:7px 10px;background:linear-gradient(135deg,#FFF7E6,#FFEBD0);border-bottom:1px solid rgba(0,0,0,0.06)">' +
          '<div style="font-size:11px;font-weight:700;color:#7A4A07">👥 החברים שלך · <span id="duel-friends-count">0</span></div>' +
          '<input id="duel-friends-search" type="text" placeholder="🔍 חפש שם או קוד" style="flex:1;max-width:140px;padding:4px 8px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;font-size:11px;font-family:inherit;background:#FFF;outline:none">' +
        '</div>' +
        '<div id="duel-friends-list" style="max-height:148px;overflow-y:auto;padding:6px"></div>' +
        '<div id="duel-friends-empty-search" style="display:none;padding:10px;text-align:center;font-size:11px;color:#A8A6A0">לא נמצאו חברים תואמים</div>' +
      '</div>' +
      '<div style="font-size:11px;font-weight:600;margin-bottom:4px">קוד היריב</div>' +
      // direction:ltr — the code "BLOOM-XXXX" is LTR English text, so the
      // pill must sit on the LEFT and the suffix input on the RIGHT, even
      // though the surrounding modal is RTL Hebrew. Without this override
      // the flex children flip and the user reads "XXXX-BLOOM" backwards.
      '<div class="duel-code-input" dir="ltr" style="display:flex;align-items:stretch;border:1px solid rgba(0,0,0,0.12);border-radius:8px;overflow:hidden;margin-bottom:8px;background:#FFFFFF;direction:ltr">' +
        '<span style="background:#1C1A18;color:#FAC775;padding:8px 10px;font-weight:700;letter-spacing:0.08em;font-family:ui-monospace,monospace;display:flex;align-items:center">BLOOM-</span>' +
        '<input id="duel-opponent-suffix" dir="ltr" maxlength="4" inputmode="latin" autocapitalize="characters" autocomplete="off" placeholder="XXXX" value="' + pre + '" style="flex:1;padding:8px;border:0;font-family:ui-monospace,monospace;font-size:16px;text-transform:uppercase;letter-spacing:0.2em;font-weight:700;text-align:center;outline:none;background:transparent;direction:ltr">' +
      '</div>' +
      '<div style="font-size:11px;font-weight:600;margin-bottom:4px">💪 רמת קושי (לשניכם)</div>' +
      '<div id="duel-difficulty" style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">' +
        '<button type="button" class="diff-pill selected" data-diff="default" style="flex:1;min-width:60px;padding:5px 8px;font-size:11px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#1C1A18;color:#FAC775;font-weight:600;cursor:pointer">📦 רגיל</button>' +
        '<button type="button" class="diff-pill" data-diff="easy" style="flex:1;min-width:60px;padding:5px 8px;font-size:11px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#F5F2EC;color:#1C1A18;font-weight:600;cursor:pointer">😊 קל</button>' +
        '<button type="button" class="diff-pill" data-diff="medium" style="flex:1;min-width:60px;padding:5px 8px;font-size:11px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#F5F2EC;color:#1C1A18;font-weight:600;cursor:pointer">🎯 בינוני</button>' +
        '<button type="button" class="diff-pill" data-diff="hard" style="flex:1;min-width:60px;padding:5px 8px;font-size:11px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#F5F2EC;color:#1C1A18;font-weight:600;cursor:pointer">🔥 קשה</button>' +
        '<button type="button" class="diff-pill" data-diff="insane" style="flex:1;min-width:60px;padding:5px 8px;font-size:11px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#F5F2EC;color:#1C1A18;font-weight:600;cursor:pointer">💀 גהינום</button>' +
      '</div>' +
      '<div style="font-size:11px;font-weight:600;margin-bottom:4px">💎 הימור (לכל המצבים)</div>' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap">' +
        '<input type="number" id="duel-amount" value="0" min="0" style="width:72px;padding:6px;border:1px solid rgba(0,0,0,0.12);border-radius:8px;font-family:inherit;font-size:14px;text-align:center;font-weight:700">' +
        '<button type="button" class="wager-chip" data-wager="0" style="padding:4px 9px;font-size:11px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#1C1A18;color:#FAC775;font-weight:700;cursor:pointer">חינם</button>' +
        '<button type="button" class="wager-chip" data-wager="50" style="padding:4px 9px;font-size:11px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#F5F2EC;color:#1C1A18;font-weight:700;cursor:pointer">50</button>' +
        '<button type="button" class="wager-chip" data-wager="100" style="padding:4px 9px;font-size:11px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#F5F2EC;color:#1C1A18;font-weight:700;cursor:pointer">100</button>' +
        '<button type="button" class="wager-chip" data-wager="250" style="padding:4px 9px;font-size:11px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#F5F2EC;color:#1C1A18;font-weight:700;cursor:pointer">250</button>' +
        '<button type="button" class="wager-chip" data-wager="500" style="padding:4px 9px;font-size:11px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#F5F2EC;color:#1C1A18;font-weight:700;cursor:pointer">500</button>' +
      '</div>' +
      '<div style="font-size:11px;color:#6F6E68;margin-bottom:12px">💎 ' + (typeof playerBalance === 'number' ? (playerBalance | 0) : 0) + ' זמינים · המנצח לוקח הכל (פחות 5% עמלה)</div>' +
      '<button class="btn" id="duel-send" style="width:100%;margin-bottom:8px">⚔️ דו-קרב חבר · ♾️ משחק מלא · בלי שעון</button>' +
      // A6 — Random matchmaking. Solo players who don't have a BLOOM code
      // to type can hit this and get paired with another waiting player.
      '<button class="btn" id="duel-random" style="width:100%;margin-bottom:8px;background:linear-gradient(135deg,#3E6FD9,#7FA8F0);color:#FFF;font-weight:800;line-height:1.35">🎲 דו-קרב אקראי<br><span style="font-size:10px;font-weight:600;opacity:0.92">זר אקראי · ♾️ משחק מלא · בלי שעון</span></button>' +
      // A5 — Live PvP Race. 60-second real-time race against another player.
      '<button class="btn" id="duel-live" style="width:100%;margin-bottom:6px;background:linear-gradient(135deg,#FF4D6D,#FF8DA1);color:#FFF;font-weight:800;line-height:1.35">⚡ מרוץ חי<br><span style="font-size:10px;font-weight:600;opacity:0.92">זר אקראי · אותו לוח · ⏱ 60 שניות</span></button>' +
      // Send gift — peaceful counterpart to a duel. Same input (BLOOM-XXXX
      // suffix), small gem amount, optional message. Recipient sees a
      // toast banner next time they open the app.
      '<button class="btn" id="duel-gift" style="width:100%;margin-bottom:10px;background:transparent;color:#BA7517;border:1px solid #FAC775">🎁 שלח מתנה לחבר</button>' +
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

    // Friends picker — fetch the friend list, populate, wire search +
    // per-row click. Each row click stuffs the 4-char suffix into the
    // input below so the player just taps "שלח אתגר". Rows are built
    // via DOM API (createElement + textContent) — friend names come
    // from the server and we never trust them for HTML.
    (function initFriendsPicker() {
      if (typeof window.fetchFriends !== 'function') return;
      var panel = document.getElementById('duel-friends-panel');
      var listHost = document.getElementById('duel-friends-list');
      var countEl = document.getElementById('duel-friends-count');
      var searchEl = document.getElementById('duel-friends-search');
      var emptyEl = document.getElementById('duel-friends-empty-search');
      if (!panel || !listHost) return;

      var allFriends = [];

      function buildRow(f) {
        var suffix = '';
        if (f.code) {
          var m = String(f.code).match(/BLOOM-([A-HJ-NP-Z2-9]{4})/i);
          if (m) suffix = m[1].toUpperCase();
        }
        if (!suffix) return null;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'duel-friend-pick';
        btn.setAttribute('data-suffix', suffix);
        btn.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;margin:0 0 4px 0;border:1px solid rgba(0,0,0,0.08);border-radius:8px;background:#FFF;cursor:pointer;text-align:right;font-family:inherit';

        var avatar = document.createElement('div');
        avatar.style.cssText = 'width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#FFE194,#FAC775);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0';
        avatar.textContent = '👤';
        btn.appendChild(avatar);

        var body = document.createElement('div');
        body.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:1px';
        var nameDiv = document.createElement('div');
        nameDiv.style.cssText = 'font-size:12px;font-weight:700;color:#1C1A18;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        nameDiv.textContent = f.name || 'אנונימי';
        var codeDiv = document.createElement('div');
        codeDiv.style.cssText = 'font-size:10px;color:#6F6E68;font-family:ui-monospace,monospace;letter-spacing:0.05em';
        codeDiv.textContent = f.code || '';
        body.appendChild(nameDiv);
        body.appendChild(codeDiv);
        btn.appendChild(body);

        var right = document.createElement('div');
        right.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0';
        var status = document.createElement('span');
        if (f.onlineNow) {
          status.style.cssText = 'font-size:9px;color:#2E8B6F;font-weight:700';
          status.textContent = '🟢 פעיל';
        } else if (f.playedToday) {
          status.style.cssText = 'font-size:9px;color:#BA7517;font-weight:700';
          status.textContent = '✓ שיחק היום';
        } else {
          status.style.cssText = 'font-size:9px;color:#A8A6A0';
          status.textContent = '⏰ לא פעיל';
        }
        right.appendChild(status);
        var pickHint = document.createElement('span');
        pickHint.style.cssText = 'font-size:11px;color:#7A4A07;font-weight:700';
        pickHint.textContent = '⚔️ בחר';
        right.appendChild(pickHint);
        btn.appendChild(right);

        btn.onclick = function() {
          var input = document.getElementById('duel-opponent-suffix');
          if (input) {
            input.value = suffix;
            try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
            try { input.focus(); } catch (e) {}
          }
          var siblings = listHost.querySelectorAll('.duel-friend-pick');
          for (var i = 0; i < siblings.length; i++) {
            siblings[i].style.background = '#FFF';
            siblings[i].style.borderColor = 'rgba(0,0,0,0.08)';
          }
          btn.style.background = 'linear-gradient(135deg,#FFE194,#FAC775)';
          btn.style.borderColor = '#BA7517';
        };
        return btn;
      }

      function applyFilter() {
        var q = ((searchEl && searchEl.value) || '').trim().toLowerCase();
        var filtered = !q ? allFriends : allFriends.filter(function(f) {
          var name = (f.name || '').toLowerCase();
          var code = (f.code || '').toLowerCase();
          return name.indexOf(q) >= 0 || code.indexOf(q) >= 0;
        });
        while (listHost.firstChild) listHost.removeChild(listHost.firstChild);
        for (var i = 0; i < filtered.length; i++) {
          var row = buildRow(filtered[i]);
          if (row) listHost.appendChild(row);
        }
        if (emptyEl) emptyEl.style.display = (filtered.length === 0 && q) ? 'block' : 'none';
      }

      window.fetchFriends(false).then(function(d) {
        if (!d || !d.ok) return;
        allFriends = (d.friends || []).filter(function(f) { return f && f.code; });
        if (!allFriends.length) return;
        panel.style.display = 'block';
        if (countEl) countEl.textContent = String(allFriends.length);
        applyFilter();
      });

      if (searchEl) {
        var debTimer = null;
        searchEl.addEventListener('input', function() {
          if (debTimer) clearTimeout(debTimer);
          debTimer = setTimeout(applyFilter, 100);
        });
      }
    })();

    // Gift-to-friend opens a dedicated modal — uses the SAME suffix as
    // the duel form is pre-filled with (if the player typed one) so a
    // single typed code can be reused for either "challenge" or "gift".
    var giftBtn = document.getElementById('duel-gift');
    if (giftBtn) giftBtn.onclick = function() {
      var prefSuf = ((document.getElementById('duel-opponent-suffix') || {}).value || '').trim().toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '');
      showGiftFriendModal(prefSuf);
    };

    // A6 — Random match button. Closes the duel modal + opens the
    // matchmaking overlay which polls /find-random every 3s.
    var randomBtn = document.getElementById('duel-random');
    if (randomBtn) randomBtn.onclick = function() {
      var diffPill = modal.querySelector('.diff-pill.selected');
      var diff = diffPill ? (diffPill.getAttribute('data-diff') || 'default') : 'default';
      var wager = _readDuelWager(modal);
      if (!_wagerAffordable(modal, wager)) return;
      modal.remove();
      startRandomMatchmaking(diff, wager);
    };

    // A5 — Live PvP Race button. Same matchmaking flow but targets the
    // live queue; on match, runs a 60-second real-time race instead of
    // an async duel.
    var liveBtn = document.getElementById('duel-live');
    if (liveBtn) liveBtn.onclick = function() {
      var diffPill = modal.querySelector('.diff-pill.selected');
      var diff = diffPill ? (diffPill.getAttribute('data-diff') || 'default') : 'default';
      var wager = _readDuelWager(modal);
      if (!_wagerAffordable(modal, wager)) return;
      modal.remove();
      startLiveRaceMatchmaking(diff, wager);
    };

    // Difficulty pill picker (challenger picks one — both players get it).
    // Initialize from whichever pill is currently selected so a rematch's
    // pre-selected difficulty (DU.2) flows into the friend-challenge path.
    var _initSelPill = modal.querySelector('.diff-pill.selected');
    var selectedDuelDifficulty = _initSelPill ? (_initSelPill.getAttribute('data-diff') || 'default') : 'default';
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

    // DU.2 — wager preset chips. Tapping a chip fills the number input and
    // highlights itself. Typing in the input clears the chip highlight.
    (function wireWagerChips() {
      var input = document.getElementById('duel-amount');
      var chips = modal.querySelectorAll('.wager-chip');
      function paint(active) {
        chips.forEach(function(c) {
          var on = (active != null) && (parseInt(c.getAttribute('data-wager'), 10) === active);
          c.style.background = on ? '#1C1A18' : '#F5F2EC';
          c.style.color = on ? '#FAC775' : '#1C1A18';
        });
      }
      chips.forEach(function(c) {
        c.onclick = function() {
          var w = parseInt(c.getAttribute('data-wager'), 10) || 0;
          if (input) input.value = String(w);
          paint(w);
        };
      });
      if (input) input.addEventListener('input', function() {
        paint(parseInt(input.value, 10));
      });
      // DU.2 — rematch pre-fills the same wager.
      var pw = opts.prefillWager | 0;
      if (pw > 0 && input) { input.value = String(pw); paint(pw); }
      else paint(0);
    })();

    // DU.2 — rematch pre-selects the same difficulty pill.
    if (opts.prefillDiff && opts.prefillDiff !== 'default') {
      var preDiffPill = modal.querySelector('.diff-pill[data-diff="' + opts.prefillDiff + '"]');
      if (preDiffPill) {
        modal.querySelectorAll('.diff-pill').forEach(function(p) {
          p.classList.remove('selected'); p.style.background = '#F5F2EC'; p.style.color = '#1C1A18';
        });
        preDiffPill.classList.add('selected');
        preDiffPill.style.background = '#1C1A18'; preDiffPill.style.color = '#FAC775';
      }
    }

    // "My code" pill — copy to clipboard
    var myPill = document.getElementById('duel-my-code');
    if (myPill) {
      myPill.onclick = function() {
        if (typeof playerCode === 'undefined' || !playerCode) return;
        var copy = function() {
          var orig = myPill.innerHTML;
          myPill.innerHTML = '<span style="color:#2E8B6F;font-weight:700">✓ הקוד הועתק! שלח לחבר שיאתגר אותך</span>';
          setTimeout(function() { myPill.innerHTML = orig; }, 1800);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(playerCode).then(copy, copy);
        } else { copy(); }
      };
    }

    // Suffix input: strip "BLOOM-" prefix on paste, enforce charset
    var suffixEl = document.getElementById('duel-opponent-suffix');
    if (suffixEl) {
      suffixEl.addEventListener('paste', function(e) {
        var t = (e.clipboardData || window.clipboardData).getData('text') || '';
        var cleaned = t.toUpperCase().replace(/^BLOOM-/, '').replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 4);
        if (cleaned) {
          e.preventDefault();
          suffixEl.value = cleaned;
        }
      });
      suffixEl.addEventListener('input', function() {
        var v = (suffixEl.value || '').toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 4);
        if (v !== suffixEl.value) suffixEl.value = v;
      });
      setTimeout(function() { try { suffixEl.focus(); } catch(_) {} }, 50);
    }

    // Send challenge
    document.getElementById('duel-send').onclick = async function() {
      var suf = ((document.getElementById('duel-opponent-suffix') || {}).value || '').trim().toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '');
      var opp = 'BLOOM-' + suf;
      var amt = parseInt(document.getElementById('duel-amount').value, 10) || 0;
      var errEl = document.getElementById('duel-error');
      errEl.style.color = '#C8472F';
      errEl.textContent = '';
      if (suf.length !== 4) { errEl.textContent = 'הקוד חייב להיות 4 תווים (אותיות וספרות)'; return; }
      if (amt > 0 && playerBalance < amt) { errEl.textContent = '💎 אין מספיק קרדיטים (' + playerBalance + ')'; return; }
      this.disabled = true; this.textContent = '...';
      try {
        var r = await fetch(API_BASE + '/api/duels', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: deviceId, token: deviceToken, opponentCode: opp, amount: amt, difficulty: selectedDuelDifficulty })
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
          // First-time social action = ideal moment to ask for push
          // permission. The pre-prompt has its own 3-day cooldown so
          // this can be called liberally.
          try {
            if (typeof window.__bloomMaybeAskPush === 'function') {
              window.__bloomMaybeAskPush('כשהיריב יקבל / יסרב / יסיים — תקבל הודעה מיד, גם כשהמשחק סגור.');
            }
          } catch (e) {}
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

  // Provide a no-op fallback so this file works even if 05a-home-v2.js
  // is concatenated later than expected.
  function markDuelAcknowledged(id) {
    if (typeof window.__bloomMarkDuelAcknowledged === 'function') window.__bloomMarkDuelAcknowledged(id);
  }
  function markAllDuelsAcknowledged(ids) {
    if (typeof window.__bloomMarkAllDuelsAcknowledged === 'function') window.__bloomMarkAllDuelsAcknowledged(ids);
  }

  async function loadMyDuels() {
    var el = document.getElementById('duel-list');
    if (!el) return;
    try {
      var r = await fetch(API_BASE + '/api/duels/mine?deviceId=' + encodeURIComponent(deviceId));
      var d = await r.json();
      if (!d || !d.duels || !d.duels.length) { el.textContent = 'אין דו-קרבות'; return; }
      // Opening the modal = the user is now LOOKING at the list.
      // Mark every currently-visible duel as acknowledged so the red
      // badge on the home action button clears on next render.
      markAllDuelsAcknowledged(d.duels.map(function(x) { return x.id; }));
      var html = '';
      d.duels.forEach(function(duel) {
        var isChallenger = duel.challenger_device === deviceId;
        var otherName = isChallenger ? (duel.opponent_name || duel.opponent_code) : (duel.challenger_name || duel.challenger_code);
        var statusMap = { pending: '⏳ ממתין', accepted: '🎮 משחקים', settled: '✅ הסתיים', tie: '🤝 תיקו', expired: '⏰ פג תוקף', declined: '✕ נדחה' };
        var statusText = statusMap[duel.status] || duel.status;
        var amtText = (duel.amount | 0) > 0 ? ' · ' + duel.amount + '💎' : '';
        var winText = '';
        // Render the actual score line on every terminal duel — settled
        // OR tie. Players were leaving the list none the wiser about by
        // how much they won/lost; the scores are the whole satisfaction
        // of a duel.
        var myScoreRow = isChallenger ? duel.challenger_score : duel.opponent_score;
        var oppScoreRow = isChallenger ? duel.opponent_score : duel.challenger_score;
        var scoreLine = '';
        if ((duel.status === 'settled' || duel.status === 'tie') && myScoreRow != null && oppScoreRow != null) {
          scoreLine = ' · <span style="color:#6F6E68;font-size:11px">' +
            (myScoreRow | 0).toLocaleString() + ' vs ' + (oppScoreRow | 0).toLocaleString() +
          '</span>';
        }
        if (duel.status === 'settled' && duel.winner_device) {
          winText = duel.winner_device === deviceId ? ' · <strong style="color:#2E8B6F">ניצחת!</strong>' : ' · <span style="color:#C8472F">הפסדת</span>';
        }
        var actionBtn = '';
        if (duel.status === 'pending' && !isChallenger) {
          // Two-button row: accept + decline. The decline path is what the
          // user explicitly asked for — previously the only way out of a
          // pending duel was to play it. Now: ✕ דחה calls the new
          // /api/duels/:id/decline (refunds the challenger's wager).
          actionBtn =
            '<span style="display:inline-flex;gap:4px">' +
              '<button class="btn sm" style="font-size:10px;padding:3px 8px" onclick="acceptDuel(' + duel.id + ')">קבל ⚔️</button>' +
              '<button class="btn sm" style="font-size:10px;padding:3px 8px;background:transparent;border:1px solid rgba(0,0,0,0.15);color:#6F6E68" onclick="declineDuel(' + duel.id + ')">✕ דחה</button>' +
            '</span>';
        } else if (duel.status === 'declined') {
          actionBtn = '<span style="font-size:10px;color:#6F6E68">דחיתי ✕</span>';
        } else if (duel.status === 'accepted') {
          var myScore = isChallenger ? duel.challenger_score : duel.opponent_score;
          if (myScore == null) {
            actionBtn = '<button class="btn sm" style="font-size:10px;padding:3px 8px;background:#BA7517" onclick="playDuel(' + duel.id + ')">🎮 שחק</button>';
          } else {
            actionBtn = '<span style="font-size:10px;color:#2E8B6F">✓ סיימת (' + (myScore|0).toLocaleString() + ')</span>';
          }
        }
        // Rematch ⚔️ — let the player re-challenge the same opponent on
        // any terminal-state row (settled/tie/declined/expired). Pulls
        // the opponent's BLOOM code (suffix) from the duel row and
        // re-opens the duel modal pre-filled. This is a major retention
        // lever — the closest BLOOM gets to a "play again" loop is the
        // FRIEND already in this list; surfacing a one-tap rematch turns
        // the duel list into a personal opponent leaderboard.
        var rematchBtn = '';
        var isTerminal = duel.status === 'settled' || duel.status === 'tie' ||
                         duel.status === 'declined' || duel.status === 'expired';
        if (isTerminal) {
          var otherCode = isChallenger ? duel.opponent_code : duel.challenger_code;
          if (otherCode) {
            var sufRematch = String(otherCode).replace(/^BLOOM-/i, '').toUpperCase().slice(0, 4);
            if (sufRematch.length === 4) {
              // DU.2 — carry the same wager + difficulty into the rematch so
              // the player relives the exact same stakes with one tap.
              var rmWager = duel.amount | 0;
              var rmDiff = (duel.difficulty_label || 'default').replace(/[^a-z]/gi, '').slice(0, 12);
              rematchBtn = ' <button class="btn sm" title="אתגר שוב" style="font-size:11px;padding:3px 10px;background:#FAC775;color:#412402;border:none;font-weight:700" onclick="rematchDuel(\'' + sufRematch + '\',' + rmWager + ',\'' + rmDiff + '\')">⚔️ שוב</button>';
            }
          }
        }
        html += '<div style="padding:6px 0;border-top:1px solid rgba(0,0,0,0.04);display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
          '<span style="flex:1;min-width:0">' +
            '<span style="font-weight:600">vs ' + otherName + '</span>' + amtText + ' · ' + statusText + winText + scoreLine +
          '</span>' +
          actionBtn + rematchBtn +
        '</div>';
      });
      el.innerHTML = html;
    } catch(e) { el.textContent = 'שגיאה בטעינה'; }
  }

  window.acceptDuel = async function(id) {
    var r = await fetch(API_BASE + '/api/duels/' + id + '/accept', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: deviceToken })
    });
    var d = await r.json();
    if (d && d.ok) {
      markDuelAcknowledged(id); // clear it from the badge count
      fetchPlayerCode();
      loadMyDuels();
      activeDuelOpponentName = d.duel ? (d.duel.challenger_name || d.duel.challenger_code || 'יריב') : 'יריב';
      startDuelGame(id, d.duel.board_seed, d.duel);
    } else {
      var msgs = { not_opponent: 'אתה לא היריב', not_pending: 'כבר קיבלת', expired: 'פג תוקף', insufficient_balance: 'אין מספיק 💎' };
      showToast(msgs[d && d.reason] || 'שגיאה', 'error');
    }
  };

  // Decline a pending duel. Opponent-only; refunds the challenger's
  // wager on the server. A tiny native confirm() guards the click so
  // a fat-finger tap on a tiny mobile row doesn't kill the duel.
  window.declineDuel = async function(id) {
    if (!window.confirm('לדחות את הדו-קרב? היריב יקבל את ההימור בחזרה.')) return;
    try {
      var r = await fetch(API_BASE + '/api/duels/' + id + '/decline', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId, token: deviceToken })
      });
      var d = await r.json();
      if (d && d.ok) {
        // Mark as acknowledged so the home badge clears too.
        if (typeof markDuelAcknowledged === 'function') markDuelAcknowledged(id);
        loadMyDuels();
        if (typeof window.__bloomToast === 'function') window.__bloomToast('דו-קרב נדחה', 'info');
      } else {
        var msgs = {
          not_opponent: 'אתה לא היריב',
          not_pending: 'כבר טופל',
          not_found: 'הדו-קרב לא נמצא',
          race: 'הדו-קרב כבר השתנה. רענן ונסה שוב',
          missing_token: 'התחבר מחדש',
          bad_token: 'התחבר מחדש'
        };
        showToast(msgs[d && d.reason] || 'שגיאה', 'error');
      }
    } catch (e) {
      showToast('שגיאה בחיבור', 'error');
    }
  };

  // Re-challenge an opponent from a terminal-state duel row. The list
  // sits INSIDE the duel modal, so we close + reopen it pre-filled
  // with the opponent's 4-char suffix. The player taps "שלח אתגר" and
  // the existing flow takes over from there.
  window.rematchDuel = function(suffix, wager, diff) {
    var clean = String(suffix || '').toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 4);
    if (clean.length !== 4) return;
    var existing = document.getElementById('duel-modal');
    if (existing) existing.remove();
    showDuelModal({ prefillSuffix: clean, prefillWager: Math.max(0, wager | 0), prefillDiff: diff || 'default' });
  };

  window.playDuel = async function(id) {
    try {
      var r = await fetch(API_BASE + '/api/duels/mine?deviceId=' + encodeURIComponent(deviceId));
      var d = await r.json();
      if (!d || !d.duels) return;
      var duel = d.duels.find(function(dd) { return dd.id === id; });
      if (!duel || duel.status !== 'accepted') { showToast('הדו-קרב לא פעיל', 'warning'); return; }
      var isChallenger = duel.challenger_device === deviceId;
      activeDuelOpponentName = isChallenger ? (duel.opponent_name || duel.opponent_code || 'יריב') : (duel.challenger_name || duel.challenger_code || 'יריב');
      startDuelGame(id, duel.board_seed, duel);
    } catch(e) { showToast('שגיאת רשת', 'error'); }
  };

  // Active duel state
  var activeDuelId = null;
  var activeDuelOpponentName = 'יריב';

  // ============================================================
  // LIVE OPPONENT HUD — visible during the player's active duel game
  // ============================================================
  // The user's ask: "players want to see their opponent's score while
  // playing". Previously you could only see the opponent's score AFTER
  // you submitted yours. That turned every duel into 2 separate games
  // stitched at the end. This HUD turns it into an actual race — every
  // tap of YOUR board is a reaction to the live score next to you.
  //
  // Data path:
  //   - GET /api/duels/:id every 3s gives us the opponent's committed
  //     state (final score if set, otherwise their assigned device_id)
  //   - GET /api/live-state/:opponentDeviceId every 3s gives us the
  //     opponent's IN-PROGRESS score (fed by their 5s heartbeats)
  //   - We merge the two: final score wins; otherwise live score; else
  //     "waiting to accept".
  // ============================================================
  var _duelHudPoller = null;
  var _duelHudDuelRow = null;
  // Bug #16 / Task #10 — captured at submit time (before the HUD teardown
  // nulls _duelHudDuelRow) so the result overlay can offer a one-tap rematch
  // even when the poller surfaces the result minutes later.
  var _lastDuelRematchCtx = null;
  var _duelHudLastOppScore = null;  // for "score jump" flash animation
  var _duelHudFinalized = false;    // stops polling once opponent finalized
  var _duelHudOppFinishedAnnounced = false; // single big-toast on transition

  function startDuelOpponentHud(duelRow) {
    if (!duelRow) return;
    stopDuelOpponentHud();
    _duelHudDuelRow = duelRow;
    _duelHudLastOppScore = null;
    _duelHudFinalized = false;
    _duelHudOppFinishedAnnounced = false;
    renderDuelHud();
    // First tick fires immediately so the HUD isn't empty for 2s
    refreshDuelHudData();
    // Tightened from 3s → 2s. The /api/duels/:id query is cheap (single
    // row read) and the lag was noticeable when an opponent merged —
    // the player's eye sees the action in real life faster than the
    // HUD reflected it. 2s gets us inside the perception window.
    _duelHudPoller = setInterval(refreshDuelHudData, 2000);
    // Also update the "my score" side via a fast tick that just reads
    // the game's score global — no network needed.
    _duelHudMyScoreTick = setInterval(syncDuelHudMyScore, 500);
  }

  function stopDuelOpponentHud() {
    if (_duelHudPoller) { clearInterval(_duelHudPoller); _duelHudPoller = null; }
    if (_duelHudMyScoreTick) { clearInterval(_duelHudMyScoreTick); _duelHudMyScoreTick = null; }
    var hud = document.getElementById('duel-hud');
    if (hud) hud.remove();
    // Restore the .top + .stats row for the next non-duel game.
    try { document.body.classList.remove('duel-active'); } catch (e) {}
    _duelHudDuelRow = null;
    _duelHudLastOppScore = null;
    _duelHudFinalized = false;
    _duelHudOppFinishedAnnounced = false;
  }

  // Big toast that fires once when the opponent transitions from
  // 'playing' to 'finished' during the player's own duel game. This
  // is the dramatic moment the user explicitly asked for — the
  // player needs to FEEL "your opponent locked in their score, you
  // now have a target". HUD color change alone is too subtle.
  function showOpponentFinishedToast(oppScore) {
    var oppName = window._duelOpponentName || 'יריב';
    var myScore = (typeof score === 'number') ? score : 0;
    var diff = (myScore | 0) - (oppScore | 0);
    var rallyText, color;
    if (diff > 0) {
      rallyText = 'אתה מוביל ב-' + diff.toLocaleString() + ' — תשמור על זה!';
      color = '#2E8B6F';
    } else if (diff < 0) {
      rallyText = 'צריך עוד ' + Math.abs(diff).toLocaleString() + ' נקודות כדי לנצח!';
      color = '#FF6B6B';
    } else {
      rallyText = 'אתם תיקו — כל merge קובע!';
      color = '#BA7517';
    }
    var t = document.createElement('div');
    t.id = 'duel-opp-finished-toast';
    t.style.cssText =
      'position:fixed;left:50%;top:max(72px, env(safe-area-inset-top));' +
      'transform:translateX(-50%) translateY(-30px);opacity:0;' +
      'transition:opacity 280ms ease-out, transform 280ms ease-out;' +
      'z-index:9700;background:linear-gradient(135deg,#1C1A18,#2A2724);' +
      'border:2px solid ' + color + ';border-radius:16px;padding:14px 18px;' +
      'direction:rtl;font-family:inherit;color:#F2EFE9;' +
      'box-shadow:0 12px 32px rgba(0,0,0,0.5);max-width:340px;' +
      'width:calc(100vw - 32px);text-align:center;';
    t.innerHTML =
      '<div style="font-size:30px;line-height:1;margin-bottom:4px">🏁</div>' +
      '<div style="font-size:14px;font-weight:800;color:#FFF;line-height:1.3">' +
        escDuelHtml(oppName) + ' סיים/ה עם <span style="color:' + color + '">' +
        (oppScore | 0).toLocaleString() + '</span></div>' +
      '<div style="font-size:12px;color:#FAC775;margin-top:4px;font-weight:600">' + rallyText + '</div>';
    document.body.appendChild(t);
    requestAnimationFrame(function() {
      t.style.opacity = '1';
      t.style.transform = 'translateX(-50%) translateY(0)';
    });
    // Tactile cue: short buzz so the player feels the moment
    try { if (typeof buzz === 'function') buzz([18, 40, 18]); } catch (e) {}
    setTimeout(function() {
      t.style.opacity = '0';
      t.style.transform = 'translateX(-50%) translateY(-30px)';
      setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }, 3800);
  }
  var _duelHudMyScoreTick = null;

  function renderDuelHud() {
    if (document.getElementById('duel-hud')) return;
    var iAmChallenger = _duelHudDuelRow && _duelHudDuelRow.challenger_device === deviceId;
    var oppName = iAmChallenger
      ? (_duelHudDuelRow.opponent_name || _duelHudDuelRow.opponent_code || 'יריב')
      : (_duelHudDuelRow.challenger_name || _duelHudDuelRow.challenger_code || 'יריב');
    var hud = document.createElement('div');
    hud.id = 'duel-hud';
    hud.className = 'duel-hud';
    hud.innerHTML =
      '<div class="duel-hud-side duel-hud-me">' +
        '<div class="duel-hud-label">אתה</div>' +
        '<div class="duel-hud-score" id="duel-hud-my-score">0</div>' +
      '</div>' +
      '<div class="duel-hud-vs">' +
        '<div class="duel-hud-vs-icon">⚔️</div>' +
        '<div class="duel-hud-delta" id="duel-hud-delta">--</div>' +
        '<div class="duel-hud-status" id="duel-hud-status">טוען...</div>' +
        // DU.2 — async duels have NO clock. Make that explicit so the player
        // never confuses this with the 60s live race.
        '<div class="duel-hud-noclock" style="font-size:9px;color:#FAC775;opacity:0.85;margin-top:2px;font-weight:700">♾️ משחק מלא · בלי שעון</div>' +
      '</div>' +
      '<div class="duel-hud-side duel-hud-opp">' +
        '<div class="duel-hud-label">' + escDuelHtml(oppName) + '</div>' +
        '<div class="duel-hud-score" id="duel-hud-opp-score">--</div>' +
      '</div>' +
      // Exit button — taps to confirm + submit current score as final.
      // Gives the player a graceful way out of a duel they don't want
      // to finish, without forfeiting their accumulated points.
      '<button class="duel-hud-exit" id="duel-hud-exit" aria-label="צא מהדו-קרב" type="button">✕</button>';
    // Append to document.body (NOT .app) — .app has overflow:hidden
    // which has clipped fixed children on some Safari versions. Body
    // is the safest containing block for a position:fixed element.
    document.body.appendChild(hud);
    // Flag body so CSS can hide the redundant .top + .stats row during
    // a duel — the HUD already shows my score + opponent score, and
    // killing the duplicate row reclaims ~80px for the grid (TB.1+TB.2
    // pattern). Removed in stopDuelOpponentHud.
    try { document.body.classList.add('duel-active'); } catch (e) {}
    // Wire the exit handler. Uses native confirm() so a fat-finger tap
    // can't accidentally end the duel.
    var exitBtn = document.getElementById('duel-hud-exit');
    if (exitBtn) exitBtn.onclick = function(e) {
      e.stopPropagation();
      exitDuelEarly();
    };
    try { console.info('[duel-hud] mounted', { iAmChallenger: iAmChallenger, oppName: oppName }); } catch (e) {}
  }

  // §Bug 2 — graceful exit. Submits the player's current score as the
  // final value (so the opponent still gets a target to beat), then
  // tears down the duel game and routes back to home. The native
  // confirm() shows the actual current score so the player knows
  // exactly what they're locking in.
  function exitDuelEarly() {
    var myScore = (typeof score === 'number') ? score : 0;
    var msg = myScore > 0
      ? 'תסיים את הדו-קרב עכשיו? הניקוד שלך (' + myScore.toLocaleString() + ') יוגש כסופי.\n' +
        'היריב עוד יכול לשחק נגדך.'
      : 'תסיים את הדו-קרב? תאבד את ההימור והניקוד שלך יהיה 0.';
    if (!window.confirm(msg)) return;
    // Pull together the values submitDuelScore needs from the engine.
    var finalScore = myScore;
    // Stop the HUD's pollers + remove the DOM immediately so we don't
    // race against the result overlay.
    try { stopDuelOpponentHud(); } catch (e) {}
    // Mark the game as "over" so the engine + heartbeats stop. The
    // existing submitDuelScore() flow handles the server submission
    // and result-overlay rendering — we just reuse it.
    try { window.__bloomGameOver = true; } catch (e) {}
    try { if (typeof submitDuelScore === 'function') submitDuelScore(finalScore); } catch (e) {
      console.warn('[duel-hud] exit submit failed', e);
    }
    try { trackEvent('duel_early_exit', { finalScore: finalScore }); } catch (e) {}
  }

  function syncDuelHudMyScore() {
    var el = document.getElementById('duel-hud-my-score');
    if (!el) return;
    var myScore = (typeof score === 'number') ? score : 0;
    el.textContent = myScore.toLocaleString();
    // DU.3 — the bot's score is no longer synthesized on the client. It comes
    // from the server's ONE real game (trajectory) via refreshDuelHudData,
    // exactly like a real opponent's score. Here we only keep MY delta in
    // sync with my score growth between the 2s opponent polls.
    paintDuelHudDelta(myScore, _duelHudLastOppScore);
  }

  function refreshDuelHudData() {
    if (!_duelHudDuelRow || !activeDuelId) return;
    // Stop polling /api/duels/:id once we have the opponent's final score
    // (no reason to keep hitting the DB after that). Live-state still
    // polls below if applicable.
    fetch(API_BASE + '/api/duels/' + activeDuelId + '?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(resp) {
        if (!resp || !resp.duel) return;
        var u = resp.duel;
        _duelHudDuelRow = u; // refresh stored row
        var iAmChallenger = u.challenger_device === deviceId;
        var oppFinalScore = iAmChallenger ? u.opponent_score : u.challenger_score;
        var oppDeviceId   = iAmChallenger ? u.opponent_device : u.challenger_device;
        if (oppFinalScore != null) {
          _duelHudFinalized = true;
          paintDuelHud({
            oppScore: oppFinalScore,
            oppStatus: 'finished',
            oppDeviceId: oppDeviceId
          });
          return;
        }
        // DU.3 — treat the bot EXACTLY like a real opponent: fetch its
        // live-state (now backed by the bot's ONE real game trajectory on the
        // server). No client-side synthesis, no special-casing. The bot's
        // score + board the player sees are a real game's real frames.
        // Opponent hasn't finalized — check their live state.
        if (oppDeviceId) {
          fetch(API_BASE + '/api/live-state/' + encodeURIComponent(oppDeviceId))
            .then(function(r2) {
              // 404 = no recent heartbeat yet (within 60s window). That's
              // not an error — it just means the opponent is accepted but
              // hasn't started playing yet. Treat it as 'accepted'.
              if (r2.status === 404) return null;
              return r2.ok ? r2.json() : null;
            })
            .then(function(live) {
              // BUG FIX: server returns the field as `score`, NOT `live_score`.
              // The old guard `typeof live.live_score === 'number'` always
              // failed → HUD never showed the opponent's actual live score.
              if (live && typeof live.score === 'number') {
                paintDuelHud({
                  oppScore: live.score,
                  oppStatus: 'playing',
                  oppDeviceId: oppDeviceId
                });
              } else {
                paintDuelHud({
                  oppScore: null,
                  oppStatus: 'accepted',
                  oppDeviceId: oppDeviceId
                });
              }
            })
            .catch(function(err) {
              // Surface fetch failures so we can see them in DevTools
              // instead of silently downgrading to "accepted" state.
              console.warn('[duel-hud] live-state fetch failed', err);
              paintDuelHud({ oppScore: null, oppStatus: 'accepted', oppDeviceId: oppDeviceId });
            });
        } else {
          // Pending: opponent hasn't even accepted yet (challenger case)
          paintDuelHud({ oppScore: null, oppStatus: 'pending', oppDeviceId: null });
        }
      })
      .catch(function(err) {
        // Surface duel-state fetch failures too — same reasoning as above.
        console.warn('[duel-hud] duel-state fetch failed', err);
      });
  }

  function paintDuelHud(state) {
    var scoreEl  = document.getElementById('duel-hud-opp-score');
    var statusEl = document.getElementById('duel-hud-status');
    var hud      = document.getElementById('duel-hud');
    if (!scoreEl || !statusEl || !hud) return;

    // Status text + visual class
    hud.classList.remove('duel-hud-status-pending', 'duel-hud-status-accepted',
                          'duel-hud-status-playing', 'duel-hud-status-finished');
    if (state.oppStatus === 'pending') {
      statusEl.textContent = 'עדיין לא קיבל';
      scoreEl.textContent  = '--';
      hud.classList.add('duel-hud-status-pending');
    } else if (state.oppStatus === 'accepted') {
      statusEl.textContent = 'מקבל אתגר';
      scoreEl.textContent  = '0';
      hud.classList.add('duel-hud-status-accepted');
    } else if (state.oppStatus === 'playing') {
      statusEl.textContent = '🎮 משחק';
      hud.classList.add('duel-hud-status-playing');
      // Flash the score if it just jumped (opponent merged → score went up)
      var prev = _duelHudLastOppScore;
      scoreEl.textContent = (state.oppScore | 0).toLocaleString();
      if (prev != null && state.oppScore > prev) {
        scoreEl.classList.remove('duel-hud-score-bump');
        // Force reflow so re-adding the class restarts the animation
        void scoreEl.offsetWidth;
        scoreEl.classList.add('duel-hud-score-bump');
      }
    } else if (state.oppStatus === 'finished') {
      statusEl.textContent = '🏁 סיים — תנצח אותו!';
      scoreEl.textContent  = (state.oppScore | 0).toLocaleString();
      hud.classList.add('duel-hud-status-finished');
      // Stop the heavy /api/duels/:id polling once we have the target —
      // we just need to keep updating MY score, which is the local tick.
      if (_duelHudPoller) { clearInterval(_duelHudPoller); _duelHudPoller = null; }
      // First-time transition into 'finished' deserves a big moment —
      // a celebratory toast that calls out the opponent's score as the
      // new target. Without this, the HUD changes color but the player
      // might miss that their opponent just locked in.
      if (!_duelHudOppFinishedAnnounced) {
        _duelHudOppFinishedAnnounced = true;
        showOpponentFinishedToast(state.oppScore);
      }
    }

    _duelHudLastOppScore = state.oppScore;
    var myScore = (typeof score === 'number') ? score : 0;
    paintDuelHudDelta(myScore, state.oppScore);
  }

  // Delta pill — "+580 💪" if leading, "-200 😬" if behind, "=" if tied
  function paintDuelHudDelta(myScore, oppScore) {
    var el = document.getElementById('duel-hud-delta');
    if (!el) return;
    if (oppScore == null) { el.textContent = ''; el.className = 'duel-hud-delta'; return; }
    var d = (myScore | 0) - (oppScore | 0);
    if (d > 0) {
      el.textContent = '+' + d.toLocaleString() + ' 💪';
      el.className = 'duel-hud-delta duel-hud-delta-ahead';
    } else if (d < 0) {
      el.textContent = d.toLocaleString() + ' 😬';
      el.className = 'duel-hud-delta duel-hud-delta-behind';
    } else {
      el.textContent = '= תיקו';
      el.className = 'duel-hud-delta duel-hud-delta-tied';
    }
  }

  // ============================================================
  // A6 — Random Matchmaking flow
  // ============================================================
  // Polls /api/duels/find-random every 3s until matched, queue
  // empty (timeout 60s), or user cancels. Renders an animated
  // overlay with countdown + queue size.
  var _randomMatchPoller = null;
  var _randomMatchOverlay = null;
  var _randomMatchStartMs = 0;

  var _randomMatchWager = 0; // DU.2 — escrowed stake for the active search

  function startRandomMatchmaking(difficulty, wager) {
    if (_randomMatchPoller) return; // already searching
    _randomMatchWager = Math.max(0, wager | 0);
    _randomMatchStartMs = Date.now();
    // Optimistically reflect the stake locally (server deducts on first poll).
    if (_randomMatchWager > 0 && typeof playerBalance === 'number') {
      playerBalance -= _randomMatchWager;
      try { updateBalanceDisplay(); } catch (e) {}
    }
    showRandomMatchOverlay(difficulty);
    // Initial call is immediate; subsequent polls every 3s.
    pollRandomMatch(difficulty);
    _randomMatchPoller = setInterval(function() {
      pollRandomMatch(difficulty);
    }, 3000);
  }

  function stopRandomMatchmaking(reason) {
    if (_randomMatchPoller) { clearInterval(_randomMatchPoller); _randomMatchPoller = null; }
    if (_randomMatchOverlay) { try { _randomMatchOverlay.remove(); } catch (e) {} _randomMatchOverlay = null; }
    if (reason === 'cancelled') {
      // Refund the optimistic local stake; server refunds its side too.
      if (_randomMatchWager > 0 && typeof playerBalance === 'number') {
        playerBalance += _randomMatchWager;
        try { updateBalanceDisplay(); } catch (e) {}
      }
      _randomMatchWager = 0;
      // Fire-and-forget cancel.
      fetch('/api/duels/find-random/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId, token: deviceToken })
      }).catch(function() {});
    } else if (reason === 'matched') {
      _randomMatchWager = 0; // stake is now escrowed on the duel row
    }
  }

  function pollRandomMatch(difficulty) {
    fetch('/api/duels/find-random', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: deviceToken, difficulty: difficulty, wager: _randomMatchWager })
    }).then(function(r) { return r.json(); }).catch(function() { return null; }).then(function(d) {
      if (!d || !d.ok) {
        if (d && d.reason === 'insufficient_funds') {
          // Roll back the optimistic deduction + stop searching.
          stopRandomMatchmaking('cancelled');
          try { if (typeof showToast === 'function') showToast('💎 אין מספיק יהלומים להימור', 'error'); } catch (e) {}
        }
        // Soft fail otherwise — keep polling, update UI to "waiting".
        return;
      }
      if (d.matched && d.duel) {
        // Stop polling + auto-start the duel game.
        stopRandomMatchmaking('matched');
        try { if (typeof soundMilestone === 'function') soundMilestone(5); } catch (e) {}
        try { if (typeof buzz === 'function') buzz([60, 40, 100]); } catch (e) {}
        // Brief "match found!" flash before the game starts.
        var flash = document.createElement('div');
        flash.className = 'random-match-flash';
        flash.innerHTML =
          '<div class="rm-flash-card">' +
            '<div class="rm-flash-emoji">⚔️</div>' +
            '<div class="rm-flash-title">נמצא יריב!</div>' +
            '<div class="rm-flash-name">' +
              ((d.duel.challenger_device === deviceId ? d.duel.opponent_name : d.duel.challenger_name) || 'יריב') +
            '</div>' +
            '<div class="rm-flash-cta">המשחק מתחיל...</div>' +
          '</div>';
        document.body.appendChild(flash);
        setTimeout(function() { try { flash.remove(); } catch (e) {} }, 1800);
        // Start the game using the existing duel-game entry point.
        // The duel row already has status='accepted' so no /accept call needed.
        var isChallenger = d.duel.challenger_device === deviceId;
        activeDuelOpponentName = isChallenger
          ? (d.duel.opponent_name || d.duel.opponent_code || 'יריב')
          : (d.duel.challenger_name || d.duel.challenger_code || 'יריב');
        setTimeout(function() {
          startDuelGame(d.duel.id, d.duel.board_seed, d.duel);
        }, 1400);
        return;
      }
      // Still searching — update overlay countdown.
      updateRandomMatchOverlay(d.queueSize || 0, d.trophyRange);
    });
  }

  function showRandomMatchOverlay(difficulty) {
    var existing = document.getElementById('random-match-overlay');
    if (existing) existing.remove();
    var ov = document.createElement('div');
    ov.id = 'random-match-overlay';
    ov.className = 'random-match-overlay';
    ov.innerHTML =
      '<div class="rm-card">' +
        '<div class="rm-spinner">' +
          '<div class="rm-spinner-circle"></div>' +
          '<div class="rm-spinner-emoji">🎲</div>' +
        '</div>' +
        '<div class="rm-title">מחפש יריב...</div>' +
        '<div class="rm-sub">המערכת מזווגת אותך עם שחקן בטווח דירוג דומה</div>' +
        '<div class="rm-stats">' +
          '<span class="rm-stat">⏱ <span id="rm-elapsed">0</span>ש</span>' +
          '<span class="rm-stat">👥 <span id="rm-queue">--</span> בתור</span>' +
          '<span class="rm-stat">🏆 ±<span id="rm-range">50</span></span>' +
        '</div>' +
        '<button class="rm-cancel" id="rm-cancel-btn">ביטול</button>' +
      '</div>';
    document.body.appendChild(ov);
    _randomMatchOverlay = ov;
    document.getElementById('rm-cancel-btn').onclick = function() {
      stopRandomMatchmaking('cancelled');
    };
    // Live elapsed-time counter (1s tick) — independent of polling cadence.
    var elapsedTicker = setInterval(function() {
      var el = document.getElementById('rm-elapsed');
      if (!el || !_randomMatchOverlay) { clearInterval(elapsedTicker); return; }
      el.textContent = Math.floor((Date.now() - _randomMatchStartMs) / 1000);
    }, 1000);
  }

  function updateRandomMatchOverlay(queueSize, trophyRange) {
    var q = document.getElementById('rm-queue');
    var r = document.getElementById('rm-range');
    if (q) q.textContent = queueSize;
    if (r) r.textContent = (trophyRange > 100000) ? '∞' : trophyRange;
  }

  // ============================================================
  // A5 — Live PvP Race (60-second real-time, polling-based)
  // ============================================================
  var _liveRacePoller = null;
  var _liveRaceOverlay = null;
  var _liveRaceStartMs = 0;
  var _liveRaceHbTimer = null;
  var _liveRacePollTimer = null;
  var _liveRaceState = null; // { duelId, durationMs, opponentName, ... }

  var _liveRaceWager = 0; // DU.2 — escrowed stake for the active live search

  function startLiveRaceMatchmaking(difficulty, wager) {
    if (_liveRacePoller) return;
    _liveRaceWager = Math.max(0, wager | 0);
    _liveRaceStartMs = Date.now();
    if (_liveRaceWager > 0 && typeof playerBalance === 'number') {
      if (playerBalance < _liveRaceWager) {
        _liveRaceWager = 0;
        if (typeof showToast === 'function') showToast('💎 אין מספיק יהלומים', 'error');
        return;
      }
      playerBalance -= _liveRaceWager;
      try { updateBalanceDisplay(); } catch (e) {}
    }
    showLiveRaceMatchOverlay(difficulty);
    pollLiveRaceMatch(difficulty);
    _liveRacePoller = setInterval(function() { pollLiveRaceMatch(difficulty); }, 3000);
  }

  function stopLiveRaceMatchmaking(reason) {
    if (_liveRacePoller) { clearInterval(_liveRacePoller); _liveRacePoller = null; }
    if (_liveRaceOverlay) { try { _liveRaceOverlay.remove(); } catch (e) {} _liveRaceOverlay = null; }
    if (reason === 'cancelled') {
      if (_liveRaceWager > 0 && typeof playerBalance === 'number') {
        playerBalance += _liveRaceWager;
        try { updateBalanceDisplay(); } catch (e) {}
      }
      _liveRaceWager = 0;
      fetch('/api/duels/find-random/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId, token: deviceToken })
      }).catch(function() {});
    } else if (reason === 'matched') {
      _liveRaceWager = 0; // stake escrowed on the duel row
    }
  }

  function pollLiveRaceMatch(difficulty) {
    fetch('/api/duels/find-random-live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: deviceToken, difficulty: difficulty, wager: _liveRaceWager })
    }).then(function(r) { return r.json(); }).catch(function() { return null; }).then(function(d) {
      if (!d || !d.ok) {
        if (d && d.reason === 'insufficient_funds') {
          stopLiveRaceMatchmaking('cancelled');
          try { if (typeof showToast === 'function') showToast('💎 אין מספיק יהלומים להימור', 'error'); } catch (e) {}
        }
        return;
      }
      if (d.matched && d.duel) {
        stopLiveRaceMatchmaking('matched');
        // Set up race state.
        var isChall = d.duel.challenger_device === deviceId;
        _liveRaceState = {
          duelId: d.duel.id,
          duel: d.duel,
          durationMs: (d.duration || 60) * 1000,
          opponentName: isChall ? (d.duel.opponent_name || 'יריב') : (d.duel.challenger_name || 'יריב'),
          isChallenger: isChall,
          startedAt: 0 // set after countdown
        };
        showLiveRaceCountdown();
        return;
      }
      var queueEl = document.getElementById('lrm-queue');
      var rangeEl = document.getElementById('lrm-range');
      if (queueEl) queueEl.textContent = d.queueSize || 0;
      if (rangeEl) rangeEl.textContent = (d.trophyRange > 100000) ? '∞' : d.trophyRange;
    });
  }

  function showLiveRaceMatchOverlay(difficulty) {
    var existing = document.getElementById('live-race-match-overlay');
    if (existing) existing.remove();
    var ov = document.createElement('div');
    ov.id = 'live-race-match-overlay';
    ov.className = 'live-race-match-overlay';
    ov.innerHTML =
      '<div class="lrm-card">' +
        '<div class="lrm-spinner">' +
          '<div class="lrm-spinner-circle"></div>' +
          '<div class="lrm-spinner-emoji">⚡</div>' +
        '</div>' +
        '<div class="lrm-title">מחפש יריב לקרב חי...</div>' +
        '<div class="lrm-sub">60 שניות בלבד · אדרנלין טהור</div>' +
        '<div class="lrm-stats">' +
          '<span class="lrm-stat">⏱ <span id="lrm-elapsed">0</span>ש</span>' +
          '<span class="lrm-stat">👥 <span id="lrm-queue">--</span> בתור</span>' +
          '<span class="lrm-stat">🏆 ±<span id="lrm-range">50</span></span>' +
        '</div>' +
        '<button class="lrm-cancel" id="lrm-cancel-btn">ביטול</button>' +
      '</div>';
    document.body.appendChild(ov);
    _liveRaceOverlay = ov;
    document.getElementById('lrm-cancel-btn').onclick = function() { stopLiveRaceMatchmaking('cancelled'); };
    var ticker = setInterval(function() {
      var el = document.getElementById('lrm-elapsed');
      if (!el || !_liveRaceOverlay) { clearInterval(ticker); return; }
      el.textContent = Math.floor((Date.now() - _liveRaceStartMs) / 1000);
    }, 1000);
  }

  // 3-2-1 countdown overlay before the race starts.
  function showLiveRaceCountdown() {
    var ov = document.createElement('div');
    ov.id = 'live-race-countdown';
    ov.className = 'live-race-countdown-overlay';
    ov.innerHTML =
      '<div class="lrc-card">' +
        '<div class="lrc-opponent">⚡ נגד ' + escapeHtml(_liveRaceState.opponentName) + '</div>' +
        '<div class="lrc-number" id="lrc-number">3</div>' +
        '<div class="lrc-sub">60 שניות לזכות</div>' +
      '</div>';
    document.body.appendChild(ov);
    var n = 3;
    var tick = function() {
      var el = document.getElementById('lrc-number');
      if (!el) return;
      if (n > 0) {
        el.textContent = n;
        el.classList.remove('lrc-pulse'); void el.offsetWidth; el.classList.add('lrc-pulse');
        try { if (typeof soundMilestone === 'function') soundMilestone(3); } catch (e) {}
        n--;
        setTimeout(tick, 1000);
      } else {
        el.textContent = 'התחל!';
        el.classList.add('lrc-go');
        try { if (typeof soundMilestone === 'function') soundMilestone(6); } catch (e) {}
        try { if (typeof buzz === 'function') buzz([80, 60, 100]); } catch (e) {}
        setTimeout(function() {
          try { ov.remove(); } catch (e) {}
          startLiveRaceGame();
        }, 700);
      }
    };
    tick();
  }

  function startLiveRaceGame() {
    // Guard against double-start (double-tap / rematch) — clear orphan timers
    // first, otherwise the previous run's heartbeat/poll intervals leak and
    // keep firing forever (battery drain + colliding scores).
    if (_liveRaceHbTimer) { clearInterval(_liveRaceHbTimer); _liveRaceHbTimer = null; }
    if (_liveRacePollTimer) { clearInterval(_liveRacePollTimer); _liveRacePollTimer = null; }
    activeDuelId = _liveRaceState.duelId;
    window._duelMode = true;
    window._liveRaceMode = true;
    window._duelOpponentName = _liveRaceState.opponentName;
    activeDuelOpponentName = _liveRaceState.opponentName;
    _liveRaceState.startedAt = Date.now();
    hideHome();
    mode = 'practice';
    // Start the game with the duel's seed.
    init('practice', { fresh: true, seed: _liveRaceState.duel.board_seed });
    // BL.1.7 — init('practice') ABOVE just read the player's PRACTICE
    // difficulty from localStorage. If the player had practice set to
    // גהינום (insane) but picked "default" in the duel modal, the live
    // race would inherit the practice difficulty — wrong: the duel
    // modal's pick must win. Override sessionDifficulty with the duel
    // row's stored difficulty (mirrors startDuelGame's handling).
    var duelForDiff = _liveRaceState && _liveRaceState.duel;
    if (duelForDiff && duelForDiff.difficulty_weights) {
      sessionDifficulty = {
        label: duelForDiff.difficulty_label || 'custom',
        weights: duelForDiff.difficulty_weights,
        speed_pct: duelForDiff.difficulty_speed_pct || null
      };
    } else {
      // Duel was 'default' — explicitly clear so the practice override
      // doesn't survive (otherwise gehinom bleeds through).
      sessionDifficulty = null;
    }
    // Re-paint the mode bar so the difficulty pill reflects the duel's
    // pick (init() above painted it from the now-overridden practice
    // value). updateModeBar reads sessionDifficulty to render.
    try { if (typeof updateModeBar === 'function') updateModeBar(); } catch (e) {}
    // Mount live HUD + timer.
    mountLiveRaceHUD();
    // Heartbeat: send my score every 1s.
    _liveRaceHbTimer = setInterval(sendLiveHeartbeat, 1000);
    // Poll: fetch opponent's score every 1s (staggered 500ms from hb).
    setTimeout(function() {
      _liveRacePollTimer = setInterval(pollLiveRaceState, 1000);
    }, 500);
  }

  function sendLiveHeartbeat() {
    if (!_liveRaceState) return;
    var myScore = (typeof score !== 'undefined') ? (score | 0) : 0;
    fetch('/api/duels/' + _liveRaceState.duelId + '/live-heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: deviceToken, score: myScore })
    }).then(function(r) { return r.json(); }).catch(function() {});
  }

  function pollLiveRaceState() {
    if (!_liveRaceState) return;
    fetch('/api/duels/' + _liveRaceState.duelId + '/live-state').then(function(r) { return r.json(); }).catch(function() { return null; }).then(function(d) {
      if (!d || !d.ok) return;
      // Update HUD with opponent's score + time left.
      var oppScore = _liveRaceState.isChallenger ? d.opponentScore : d.challengerScore;
      var myScore = _liveRaceState.isChallenger ? d.challengerScore : d.opponentScore;
      paintLiveRaceHUD(oppScore, myScore, d.timeLeft);
      // Auto-end when timer expires OR server marked settled.
      if (d.status === 'settled' || d.status === 'tie' || d.timeLeft <= 0) {
        endLiveRace(d);
      }
    });
  }

  function mountLiveRaceHUD() {
    var existing = document.getElementById('live-race-hud');
    if (existing) existing.remove();
    var hud = document.createElement('div');
    hud.id = 'live-race-hud';
    hud.className = 'live-race-hud';
    hud.innerHTML =
      '<button class="lrh-forfeit" id="lrh-forfeit" aria-label="פרוש מהמרוץ" title="פרוש">✕</button>' +
      '<div class="lrh-timer-row">' +
        '<span class="lrh-timer-label">⏰</span>' +
        '<span class="lrh-timer" id="lrh-timer">60</span>' +
        '<span class="lrh-timer-unit">שניות</span>' +
      '</div>' +
      // BL.1.4 — animated progress bar under the timer. Visual countdown
      // works even when the user can't read the number (peripheral vision).
      '<div class="lrh-timer-bar"><div class="lrh-timer-bar-fill" id="lrh-timer-bar-fill" style="width:100%"></div></div>' +
      '<div class="lrh-score-row">' +
        '<div class="lrh-me">' +
          '<div class="lrh-label">אתה</div>' +
          '<div class="lrh-score" id="lrh-my-score">0</div>' +
        '</div>' +
        '<div class="lrh-vs">⚡</div>' +
        '<div class="lrh-opp">' +
          '<div class="lrh-label">' + escapeHtml(_liveRaceState.opponentName).slice(0, 12) + '</div>' +
          '<div class="lrh-score" id="lrh-opp-score">0</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(hud);
    // Forfeit button — lets the player leave a live race instead of being locked
    // for the full 60s. Submits the current score + settles immediately. (audit fix)
    try {
      var ffBtn = hud.querySelector('#lrh-forfeit');
      if (ffBtn) ffBtn.addEventListener('click', forfeitLiveRace);
    } catch (e) {}
    // BL.1.4 — set body class so CSS can hide the .top/.stats/.mode-bar/
    // bottom-nav rows (otherwise the regular game chrome shows through
    // and overlaps the HUD + steals vertical space from the grid).
    try { document.body.classList.add('live-race-active'); } catch (e) {}
  }

  function forfeitLiveRace() {
    if (!_liveRaceState) return;
    var ok = true;
    try { ok = window.confirm('לפרוש מהמרוץ עכשיו? הניקוד הנוכחי יוגש והקרב יוכרע מיד.'); } catch (e) {}
    if (!ok) return;
    var ffBtn = document.getElementById('lrh-forfeit');
    if (ffBtn) { ffBtn.disabled = true; ffBtn.textContent = '…'; }
    var sc = (typeof score !== 'undefined' && score != null) ? (score | 0) : 0;
    var duelId = _liveRaceState.duelId;
    var isCh = _liveRaceState.isChallenger;
    var oppName = _liveRaceState.opponentName;
    // Stop local timers so the normal expiry path can't double-fire a result.
    if (_liveRaceHbTimer) { clearInterval(_liveRaceHbTimer); _liveRaceHbTimer = null; }
    if (_liveRacePollTimer) { clearInterval(_liveRacePollTimer); _liveRacePollTimer = null; }
    apiPost('/api/duels/' + duelId + '/forfeit-live', { score: sc })
      .then(function() {
        return fetch('/api/duels/' + duelId + '/live-state').then(function(r){ return r.json(); }).catch(function(){ return null; });
      })
      .then(function(d) {
        var myScore = sc, oppScore = 0;
        if (d && d.ok) {
          if (d.challengerFinal != null) {
            myScore = isCh ? d.challengerFinal : d.opponentFinal;
            oppScore = isCh ? d.opponentFinal : d.challengerFinal;
          } else {
            oppScore = isCh ? (d.opponentScore | 0) : (d.challengerScore | 0);
          }
        }
        showLiveRaceResult(myScore, oppScore, oppName, d);
        _liveRaceState = null;
        window._duelMode = false;
        window._liveRaceMode = false;
        window.__bloomGameOver = true;
        try { busy = true; } catch (e) {}
        var hud = document.getElementById('live-race-hud');
        if (hud) hud.remove();
        try { document.body.classList.remove('live-race-active'); } catch (e) {}
      })
      .catch(function() {
        var hud = document.getElementById('live-race-hud');
        if (hud) hud.remove();
        try { document.body.classList.remove('live-race-active'); } catch (e) {}
        _liveRaceState = null;
        window._liveRaceMode = false;
      });
  }

  function paintLiveRaceHUD(oppScore, myServerScore, timeLeft) {
    var localScore = (typeof score !== 'undefined') ? (score | 0) : 0;
    // Use the higher of server-stored vs local — prevents lag-flicker.
    var myFinal = Math.max(localScore, myServerScore | 0);
    var oppEl = document.getElementById('lrh-opp-score');
    var meEl = document.getElementById('lrh-my-score');
    var timerEl = document.getElementById('lrh-timer');
    var barFillEl = document.getElementById('lrh-timer-bar-fill');
    if (oppEl) {
      var prevOpp = parseInt(oppEl.dataset.lastValue || '0', 10);
      oppEl.textContent = (oppScore | 0).toLocaleString();
      // Score-bump animation when opponent's number grows.
      if ((oppScore | 0) > prevOpp) {
        oppEl.classList.remove('lrh-score-bump');
        void oppEl.offsetWidth;
        oppEl.classList.add('lrh-score-bump');
      }
      oppEl.dataset.lastValue = String(oppScore | 0);
    }
    if (meEl) {
      var prevMy = parseInt(meEl.dataset.lastValue || '0', 10);
      meEl.textContent = myFinal.toLocaleString();
      if (myFinal > prevMy) {
        meEl.classList.remove('lrh-score-bump');
        void meEl.offsetWidth;
        meEl.classList.add('lrh-score-bump');
      }
      meEl.dataset.lastValue = String(myFinal);
    }
    if (timerEl) timerEl.textContent = Math.ceil(timeLeft / 1000);
    // BL.1.4 — progress bar uses _liveRaceState.durationMs for the
    // denominator (default 60000ms) so the visual fill matches the
    // actual race length even if admin tunes it.
    if (barFillEl && _liveRaceState) {
      var totalMs = (_liveRaceState.durationMs | 0) > 0 ? (_liveRaceState.durationMs | 0) : 60 * 1000;
      var pct = Math.max(0, Math.min(100, (timeLeft / totalMs) * 100));
      barFillEl.style.width = pct + '%';
    }
    var hud = document.getElementById('live-race-hud');
    if (hud) {
      hud.classList.toggle('lrh-ahead', myFinal > (oppScore | 0));
      hud.classList.toggle('lrh-behind', myFinal < (oppScore | 0));
      // Urgent state in last 10 seconds.
      hud.classList.toggle('lrh-urgent', timeLeft < 10 * 1000);
    }
  }

  function endLiveRace(stateData) {
    if (!_liveRaceState) return;
    if (_liveRaceHbTimer) { clearInterval(_liveRaceHbTimer); _liveRaceHbTimer = null; }
    if (_liveRacePollTimer) { clearInterval(_liveRacePollTimer); _liveRacePollTimer = null; }
    // Force game end (busy/disable input).
    window.__bloomGameOver = true;
    try { busy = true; } catch (e) {}
    // Send one last heartbeat with final score so server records it.
    sendLiveHeartbeat();
    // Brief delay then show result overlay.
    setTimeout(function() {
      var myScore = _liveRaceState.isChallenger ? stateData.challengerScore : stateData.opponentScore;
      var oppScore = _liveRaceState.isChallenger ? stateData.opponentScore : stateData.challengerScore;
      // Re-fetch in case settlement just happened.
      fetch('/api/duels/' + _liveRaceState.duelId + '/live-state').then(function(r) { return r.json(); }).catch(function() { return null; }).then(function(d) {
        if (d && d.ok && d.challengerFinal != null) {
          myScore = _liveRaceState.isChallenger ? d.challengerFinal : d.opponentFinal;
          oppScore = _liveRaceState.isChallenger ? d.opponentFinal : d.challengerFinal;
        }
        showLiveRaceResult(myScore, oppScore, _liveRaceState.opponentName, d);
        _liveRaceState = null;
        window._duelMode = false;
        window._liveRaceMode = false;
        var hud = document.getElementById('live-race-hud');
        if (hud) hud.remove();
        // BL.1.4 — restore the regular game chrome.
        try { document.body.classList.remove('live-race-active'); } catch (e) {}
      });
    }, 800);
  }

  function showLiveRaceResult(myScore, oppScore, oppName, settleData) {
    var existing = document.getElementById('live-race-result');
    if (existing) existing.remove();
    var won = myScore > oppScore;
    var tied = myScore === oppScore;
    var ov = document.createElement('div');
    ov.id = 'live-race-result';
    ov.className = 'live-race-result-overlay';
    var emoji = won ? '🏆' : (tied ? '🤝' : '😔');
    var title = won ? 'ניצחת!' : (tied ? 'תיקו' : 'הפסדת');
    // Real payout from the server (base reward + wager winnings) instead of a
    // hardcoded +50. Tie shows the stake refund. (audit fix May 2026)
    var winReward = (settleData && settleData.winnerReward != null) ? Number(settleData.winnerReward) : 50;
    var wagerAmt = (settleData && settleData.wager != null) ? Number(settleData.wager) : 0;
    var sub = won
      ? ('+' + winReward.toLocaleString() + '💎 על הזכייה')
      : (tied
          ? (wagerAmt > 0 ? ('🔄 ההימור הוחזר · ' + wagerAmt.toLocaleString() + '💎') : 'אף אחד לא קיבל פרס')
          : 'נסה שוב!');
    ov.innerHTML =
      '<div class="lrr-card lrr-' + (won ? 'won' : tied ? 'tie' : 'lost') + '">' +
        '<button class="lrr-close" aria-label="סגור">×</button>' +
        '<div class="lrr-emoji">' + emoji + '</div>' +
        '<div class="lrr-title">' + title + '</div>' +
        '<div class="lrr-scores">' +
          '<div class="lrr-side"><div class="lrr-side-name">אתה</div><div class="lrr-side-score">' + (myScore | 0).toLocaleString() + '</div></div>' +
          '<div class="lrr-vs">vs</div>' +
          '<div class="lrr-side"><div class="lrr-side-name">' + escapeHtml(oppName) + '</div><div class="lrr-side-score">' + (oppScore | 0).toLocaleString() + '</div></div>' +
        '</div>' +
        '<div class="lrr-sub">' + sub + '</div>' +
        '<button class="lrr-btn" onclick="this.closest(\'.live-race-result-overlay\').remove()">המשך</button>' +
      '</div>';
    document.body.appendChild(ov);
    // UX audit 2026-06-02: honour the close contract — backdrop tap + ✕
    // (the ESC/back-gesture path is covered via the allowlist + aria-label).
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
    var lrrClose = ov.querySelector('.lrr-close');
    if (lrrClose) lrrClose.onclick = function () { ov.remove(); };
    try { if (typeof soundMilestone === 'function') soundMilestone(won ? 7 : 3); } catch (e) {}
    try { if (typeof buzz === 'function') buzz(won ? [80,60,100,60,120,80,140] : [40,30,60]); } catch (e) {}
    if (won && window.__bloomBumpBal && typeof playerBalance !== 'undefined') {
      try { window.__bloomBumpBal(playerBalance + winReward, winReward); } catch (e) {}
    } else if (tied && wagerAmt > 0 && window.__bloomBumpBal && typeof playerBalance !== 'undefined') {
      try { window.__bloomBumpBal(playerBalance + wagerAmt, wagerAmt); } catch (e) {}
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

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
    // Dynamic Boards (phase 3, May 2026): duel-snapshotted board.
    // The server stored board_multipliers (+ board_name) on the duel row
    // at creation time. Both players read the same snapshot — guarantees
    // fairness even if admin changes the active board mid-duel. Vanilla
    // duel = no snapshot.
    if (typeof setColumnMultipliers === 'function') setColumnMultipliers(null);
    if (typeof setSpecialCells === 'function') setSpecialCells(null);
    window._activeSpecialBoard = null;
    if (duelRow && typeof applyDuelBoardSnapshot === 'function') {
      applyDuelBoardSnapshot(duelRow);
    }
    grid = Array.from({length: getBoardRows()}, function() { return Array(getBoardCols()).fill(0); });
    score = 0; highestTier = 1; busy = false; dropsCount = 0;
    window.__bloomGameOver = false; // duel = active game
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
    // Toast for special-board duels — "this duel has bonus columns!"
    if (window._activeSpecialBoard && typeof showSpecialBoardToast === 'function') {
      try { showSpecialBoardToast(window._activeSpecialBoard); } catch (e) {}
    }
    playMusic('game');
    ensureAudio();
    startEventSystem();
    trackEvent('duel_start', { duelId: duelId });
    // §LIVE OPPONENT HUD — kick off the real-time opponent-score widget
    // the moment the duel game starts. Self-tears-down via submitDuelScore.
    try { startDuelOpponentHud(duelRow); } catch (e) { console.warn('[duel-hud]', e); }
  }

  // Bug #16 / Task #10 — derive the one-tap-rematch context from the active
  // duel row. Mirrors the my-duels list pattern (opponent's BLOOM code +
  // wager + difficulty). Sets _lastDuelRematchCtx to null when no valid
  // human opponent exists (bot match, missing code) so the result overlay
  // won't offer a rematch that can't work.
  function captureDuelRematchCtx() {
    _lastDuelRematchCtx = null;
    var row = _duelHudDuelRow;
    if (!row || row.is_bot_match) return;
    var iAmChall = row.challenger_device === deviceId;
    var otherCode = iAmChall ? row.opponent_code : row.challenger_code;
    if (!otherCode) return;
    var suf = String(otherCode).replace(/^BLOOM-/i, '').toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 4);
    if (suf.length !== 4) return;
    _lastDuelRematchCtx = {
      suffix: suf,
      wager: (row.amount | 0),
      diff: (row.difficulty_label || 'default').replace(/[^a-z]/gi, '').slice(0, 12) || 'default'
    };
  }

  // Called from game-over to submit duel score
  function submitDuelScore(finalScore) {
    if (!activeDuelId) return;
    var duelId = activeDuelId;
    var oppName = window._duelOpponentName || 'יריב';
    // Bug #16 / Task #10 — capture the rematch context NOW, before the HUD
    // teardown below nulls _duelHudDuelRow. Skip bot matches (a phantom bot
    // has no real BLOOM code to re-challenge).
    captureDuelRematchCtx();
    activeDuelId = null;
    // Tear down the live opponent HUD — the game-over overlay takes
    // over from here, so the HUD's job is done.
    try { stopDuelOpponentHud(); } catch (e) {}
    window._duelMode = false;
    // DU.3 — the server re-selects a REAL bot game calibrated to this score;
    // continuity is handled server-side from the persisted trajectory, so the
    // client no longer needs to send a synthesized "botSeen".
    fetch(API_BASE + '/api/duels/' + duelId + '/score', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: deviceId,
        score: finalScore,
        drops: (typeof dropsCount === 'number' ? dropsCount : 0) | 0,
        token: deviceToken
      })
    }).then(function(r) { return r.json(); }).then(function(d) {
      // 2026-05-26: sync the local balance from server's newBalance
      // when present (winner path now includes it). Without this the
      // home gem widget didn't move after "🏆 ניצחת +150💎" → looked
      // like the prize never landed.
      if (d && d.ok && typeof d.newBalance === 'number') {
        try { if (typeof playerBalance !== 'undefined') playerBalance = d.newBalance; } catch (e) {}
        try { if (typeof localStorage !== 'undefined') localStorage.setItem(PLAYER_BALANCE_KEY, String(d.newBalance)); } catch (e) {}
        try { if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(); } catch (e) {}
        try { if (typeof window.__bloomBumpBal === 'function') window.__bloomBumpBal(d.newBalance, d.prize || 0); } catch (e) {}
      }
      // 2026-05-26: if the server returned an unknown shape (e.g.
      // ok:false, reason:'already_submitted' OR ok:false from any
      // error path), the overlay landed in the "דו-קרב נשלח" fallback
      // forever with no polling. Now we ALWAYS start polling when the
      // duel isn't in a terminal state — even if d.result is missing.
      var terminal = d && (d.result === 'settled' || d.result === 'tie' ||
                           d.result === 'declined' || d.result === 'expired');
      if (!terminal) {
        // Normalize: if server returned ok:false with no result, treat
        // as 'waiting' so the UI shows the friendly waiting overlay
        // and the poller can sort it out.
        if (!d || !d.result) d = { result: 'waiting', yourScore: finalScore };
      }
      showDuelResultOverlay(d, finalScore, oppName);
      if (d && (d.result === 'tie' || (d.result === 'settled' && d.winner === 'you'))) fetchPlayerCode();
      trackEvent('duel_score', { duelId: duelId, result: d && d.result });
      // Always poll when not terminal — covers 'waiting' AND any
      // ambiguous error response from above. Without polling, the
      // player gets stuck on "..." forever.
      if (!terminal) {
        pollDuelUntilSettled(duelId, finalScore, oppName);
        attachDuelLiveSpectator(duelId, finalScore, oppName);
      }
    }).catch(function(err) {
      // Network failure → show waiting overlay + start polling. Don't
      // give up — the score may have landed server-side anyway.
      showDuelResultOverlay({ result: 'waiting' }, finalScore, oppName);
      pollDuelUntilSettled(duelId, finalScore, oppName);
      attachDuelLiveSpectator(duelId, finalScore, oppName);
      // 🚨 Issue: client couldn't reach server during duel score submit.
      try {
        if (typeof window.__bloomReportIssue === 'function') {
          window.__bloomReportIssue({
            kind: 'duel_score_network_fail',
            severity: 'high',
            title: 'דו-קרב #' + duelId + ' — שליחת ציון נכשלה ברשת',
            detail: 'fetch לדואל ' + duelId + ' עם score=' + finalScore + ' זרק שגיאה. השחקן ראה "ממתין ליריב".',
            context: { duelId: duelId, score: finalScore, error: err && err.message }
          });
        }
      } catch (e) {}
    });
  }

  // Poll a duel after we submitted but the opponent hasn't yet. Stops as soon
  // as the duel becomes 'settled' or 'tie', or after 5 minutes (whichever
  // comes first). Updates the in-flight result overlay in place.
  function pollDuelUntilSettled(duelId, myScore, oppName) {
    var attempts = 0;
    var maxAttempts = 150; // 150 × 2s = 5 minutes of active polling
    var poller = setInterval(function() {
      attempts++;
      if (attempts > maxAttempts) {
        // The duel hasn't resolved in 5 minutes. Don't leave the player
        // staring at a frozen spinner — swap the overlay to a friendly
        // "go do something else, we'll notify you" state and stop the
        // background spectator. The home-side checkIncomingDuels poll
        // (every 60s) will pick up the eventual settle/decline/expire
        // and surface it via the banner.
        clearInterval(poller);
        stopDuelLiveSpectator();
        replaceDuelResultOverlay({
          result: 'unresolved',
          opponentName: oppName
        }, myScore, oppName);
        // 🚨 Log to admin issue tracker — player waited 5 minutes for
        // an opponent that never finished. Admin can comp them.
        try {
          if (typeof window.__bloomReportIssue === 'function') {
            window.__bloomReportIssue({
              kind: 'duel_unresolved_5min',
              severity: 'medium',
              title: 'דו-קרב #' + duelId + ' לא נפתר ב-5 דקות',
              detail: 'השחקן סיים את ציונו (' + myScore + ') אבל היריב לא שיחק. השחקן ראה מסך "ממתין".',
              context: { duelId: duelId, myScore: myScore, oppName: oppName }
            });
          }
        } catch (e) {}
        return;
      }
      fetch(API_BASE + '/api/duels/' + duelId + '?deviceId=' + encodeURIComponent(deviceId), { method: 'GET' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(resp) {
          if (!resp || !resp.duel) return;
          var u = resp.duel;
          var isChallenger = u.challenger_device === deviceId;
          // Settled / tie — the normal happy path.
          if (u.status === 'settled' || u.status === 'tie') {
            clearInterval(poller);
            stopDuelLiveSpectator();
            var oppScore = isChallenger ? u.opponent_score : u.challenger_score;
            var winner = null;
            if (u.status === 'settled') {
              winner = u.winner_device === deviceId ? 'you' : 'opponent';
            }
            var prize = u.amount ? Math.round((u.amount | 0) * 2 * 0.95) : 0;
            replaceDuelResultOverlay({
              result: u.status === 'tie' ? 'tie' : 'settled',
              winner: winner,
              opponentScore: oppScore,
              prize: prize
            }, myScore, oppName);
            if (winner === 'you' || u.status === 'tie') fetchPlayerCode();
            // 2026-05-26: when the poller catches a settle, the server
            // already credited the winner — but THIS client never saw
            // a response with newBalance (the credit happened in the
            // OTHER player's score-submission transaction). Refetch
            // balance so the home widget reflects the prize. Use
            // /api/player/state if it exists, else just bump locally.
            if (winner === 'you' && prize > 0) {
              try {
                if (typeof playerBalance !== 'undefined') {
                  playerBalance = (playerBalance | 0) + prize;
                  if (typeof localStorage !== 'undefined' && typeof PLAYER_BALANCE_KEY !== 'undefined') {
                    localStorage.setItem(PLAYER_BALANCE_KEY, String(playerBalance));
                  }
                }
                if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay();
                if (typeof window.__bloomBumpBal === 'function') {
                  window.__bloomBumpBal(typeof playerBalance !== 'undefined' ? playerBalance : prize, prize);
                }
              } catch (e) {}
            } else if (u.status === 'tie' && (u.amount | 0) > 0) {
              try {
                if (typeof playerBalance !== 'undefined') {
                  playerBalance = (playerBalance | 0) + (u.amount | 0);
                  if (typeof localStorage !== 'undefined' && typeof PLAYER_BALANCE_KEY !== 'undefined') {
                    localStorage.setItem(PLAYER_BALANCE_KEY, String(playerBalance));
                  }
                }
                if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay();
                if (typeof window.__bloomBumpBal === 'function') {
                  window.__bloomBumpBal(typeof playerBalance !== 'undefined' ? playerBalance : 0, u.amount | 0);
                }
              } catch (e) {}
            }
            return;
          }
          // NEW: opponent declined, or duel auto-expired past its TTL.
          // Both are terminal — refund already happened server-side.
          // Surface a clear "you got your gems back, no win/loss" overlay
          // so the challenger isn't stuck on "ממתין ליריב..." forever.
          if (u.status === 'declined' || u.status === 'expired') {
            clearInterval(poller);
            stopDuelLiveSpectator();
            replaceDuelResultOverlay({
              result: u.status,            // 'declined' or 'expired'
              opponentName: oppName,
              refund: u.amount | 0          // for the message body
            }, myScore, oppName);
            // The wager came back — refresh balance immediately so the
            // player sees the new total without waiting for the next
            // navigation.
            if (isChallenger) fetchPlayerCode();
            return;
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
    fetch(API_BASE + '/api/duels/' + duelId + '?deviceId=' + encodeURIComponent(deviceId), { method: 'GET' })
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
      // BL.1.5 — countdown row at TOP for max prominence. Shows "Y שניות
      // ליריב" so player knows how much longer until bot finishes.
      '<div data-dspec-countdown-row style="display:none;justify-content:center;align-items:center;gap:6px;margin-bottom:10px;padding:8px 12px;background:linear-gradient(135deg,rgba(74,15,31,0.7),rgba(140,42,64,0.6));border-radius:10px;border:1px solid rgba(255,217,61,0.35)">' +
        '<span style="font-size:14px">⏰</span>' +
        '<span style="font-size:12px;color:#FFE9A3" data-dspec-countdown-label>נשארו ליריב</span>' +
        '<span data-dspec-countdown style="font-size:22px;font-weight:900;font-variant-numeric:tabular-nums;color:#FFD93D;min-width:34px;display:inline-block">--</span>' +
        '<span style="font-size:11px;color:rgba(255,233,163,0.7)">שניות</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:10px">' +
        '<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#9FE1CB">' +
          '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#2E8B6F;animation:dspecPulse 1.2s ease-in-out infinite"></span>' +
          '<span data-dspec-header>צופה ב-' + escapeHtml(oppName) + ' חי</span>' +
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
        '.dspec-cell{aspect-ratio:1;background:#2A2724;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:14px;overflow:hidden;transition:background 220ms ease}' +
        // Tier SVGs have viewBox but no width/height. Without explicit sizing
        // they fall back to UA-default ~300×150 and either overflow or render
        // invisibly — leaving cells looking like plain coloured squares. 65%
        // of the cell matches the main game ratio.
        '.dspec-cell svg{width:65%;height:65%;display:block;transition:transform 220ms ease}' +
        '@keyframes dspecPulse{0%,100%{opacity:1}50%{opacity:0.3}}' +
        // BL.1.4 — three cell-change animations make the spectator board
        // feel ALIVE instead of static. appear=tile dropped from above,
        // merge=tile upgraded in place, clear=tile vanished.
        '@keyframes dspecAppear{0%{transform:scale(0.5) translateY(-8px);opacity:0}60%{transform:scale(1.12) translateY(0);opacity:1}100%{transform:scale(1);opacity:1}}' +
        '@keyframes dspecMerge{0%{transform:scale(1);filter:brightness(1)}40%{transform:scale(1.28);filter:brightness(1.4) drop-shadow(0 0 6px #FFD93D)}100%{transform:scale(1);filter:brightness(1)}}' +
        '@keyframes dspecClear{0%{transform:scale(1);opacity:1}100%{transform:scale(0.7);opacity:0.2}}' +
        '.dspec-cell-appear{animation:dspecAppear 420ms cubic-bezier(.34,1.56,.64,1)}' +
        '.dspec-cell-merge{animation:dspecMerge 360ms ease-out}' +
        '.dspec-cell-clear{animation:dspecClear 280ms ease-in}' +
        // BL.1.5 — countdown urgency pulse for last 10s + opp score bump.
        '@keyframes dspecCountdownPulse{0%,100%{box-shadow:0 0 0 rgba(255,77,109,0.6)}50%{box-shadow:0 0 16px rgba(255,77,109,1)}}' +
        '.dspec-countdown-urgent{animation:dspecCountdownPulse 0.6s ease-in-out infinite;border-color:#FF4D6D !important}' +
        '@keyframes dspecScoreBump{0%{transform:scale(1)}40%{transform:scale(1.25);color:#FFE9A3}100%{transform:scale(1)}}' +
        '.dspec-score-bump{animation:dspecScoreBump 360ms cubic-bezier(.34,1.56,.64,1);display:inline-block}' +
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
        // BL.1.5 — score-bump animation when opponent's number grows.
        if (scoreEl) {
          var prevSc = parseInt(scoreEl.dataset.lastValue || '0', 10);
          var newSc = d.score | 0;
          scoreEl.textContent = newSc.toLocaleString();
          if (newSc > prevSc) {
            scoreEl.classList.remove('dspec-score-bump');
            void scoreEl.offsetWidth;
            scoreEl.classList.add('dspec-score-bump');
          }
          scoreEl.dataset.lastValue = String(newSc);
        }
        // BL.1.5 — countdown row: shows "Y seconds left for the bot",
        // adapts label to live race ("נשארו ליריב") vs async ("עוד").
        var cdRow = document.querySelector('[data-dspec-countdown-row]');
        var cdEl = document.querySelector('[data-dspec-countdown]');
        var cdLabel = document.querySelector('[data-dspec-countdown-label]');
        var headerEl = document.querySelector('[data-dspec-header]');
        if (cdRow && cdEl && typeof d.timeLeftMs === 'number' && d.timeLeftMs > 0) {
          cdRow.style.display = 'flex';
          cdEl.textContent = Math.ceil(d.timeLeftMs / 1000);
          if (cdLabel) cdLabel.textContent = d.isLive ? 'נשארו ליריב' : 'מגיש בעוד';
          if (headerEl) {
            headerEl.textContent = d.isLive
              ? '⚡ צופה בקרב חי · ' + ((d.name || 'יריב'))
              : 'צופה ב-' + (d.name || 'יריב') + ' חי';
          }
          // Pulse red in last 10 seconds.
          if (d.timeLeftMs < 10000) {
            cdRow.classList.add('dspec-countdown-urgent');
            cdEl.style.color = '#FF4D6D';
          } else {
            cdRow.classList.remove('dspec-countdown-urgent');
            cdEl.style.color = '#FFD93D';
          }
        } else if (cdRow) {
          cdRow.style.display = 'none';
        }
        if (!Array.isArray(d.grid)) return;
        var tiers = getActiveTiers();
        var cells = gridHost.children;
        var idx = 0;
        // BL.1.4 — track previous tier per cell so we can fire a "pop"
        // animation when a tile appears/changes/upgrades. The spectator
        // widget was visually STATIC even when polling brought a new
        // grid → looked frozen. Animation makes it feel like a real
        // game is unfolding.
        for (var r = 0; r < d.grid.length; r++) {
          var row = d.grid[r] || [];
          for (var c = 0; c < row.length; c++) {
            var cell = cells[idx];
            if (cell) {
              var t = row[c] | 0;
              var prevT = (cell.dataset.tier | 0) || 0;
              var changed = t !== prevT;
              if (t > 0 && tiers[t]) {
                cell.style.background = tiers[t].bg;
                cell.style.color = tiers[t].fg;
                cell.innerHTML = tiers[t].svg || '';
                if (changed) {
                  // Subtle pop on every tier change — distinguishes
                  // "tile appeared" (from empty) vs "tile upgraded"
                  // by adding a different class.
                  var animClass = prevT === 0 ? 'dspec-cell-appear' : 'dspec-cell-merge';
                  cell.classList.remove('dspec-cell-appear', 'dspec-cell-merge');
                  void cell.offsetWidth;
                  cell.classList.add(animClass);
                }
              } else {
                cell.style.background = '#2A2724';
                cell.style.color = '';
                cell.innerHTML = '';
                if (changed && prevT > 0) {
                  // A tile vanished — quick shrink-out flash.
                  cell.classList.remove('dspec-cell-appear', 'dspec-cell-merge');
                  void cell.offsetWidth;
                  cell.classList.add('dspec-cell-clear');
                }
              }
              cell.dataset.tier = String(t);
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
    var ctaLabel = 'שחק שוב';                  // default close-overlay CTA
    var ctaMode = 'practice';                  // default mode to start
    var hideScoresVs = false;                  // hide the vs ... ... block when opponent didn't play
    if (d && d.result === 'settled' && d.winner === 'you') {
      emoji = '🏆'; title = 'ניצחת!'; color = '#2E8B6F'; showConfettiFlag = true;
      detail = '<div style="font-size:14px;color:#9FE1CB;margin-top:6px">+' + (d.prize || 0) + ' 💎 פרס</div>';
    } else if (d && d.result === 'settled' && d.winner === 'opponent') {
      emoji = '😔'; title = 'הפסדת'; color = '#C8472F';
      detail = '<div style="font-size:14px;color:#F5C4B3;margin-top:6px">היריב היה טוב יותר הפעם</div>';
    } else if (d && d.result === 'tie') {
      emoji = '🤝'; title = 'תיקו!'; color = '#BA7517';
      // Bug #22 — show the actual refunded wager when the server echoes it.
      var tieRefund = (d.refund != null) ? (d.refund | 0) : 0;
      detail = '<div style="font-size:14px;color:#FAC775;margin-top:6px">' +
        (tieRefund > 0 ? 'ההימור הוחזר: <strong>' + tieRefund.toLocaleString() + '💎</strong>' : 'ההימור הוחזר') +
        '</div>';
    } else if (d && d.result === 'declined') {
      // The opponent explicitly declined the duel. No win/loss for either
      // side; the wager has been refunded server-side already. Make the
      // copy upbeat — this isn't a "failure", just an asymmetric outcome.
      emoji = '🤷'; title = 'היריב סירב'; color = '#BA7517';
      detail = '<div style="font-size:13px;color:#FAC775;margin-top:6px">' + escDuelHtml(oppName || 'היריב') + ' לא הצטרף לדו-קרב' +
        (d.refund > 0 ? '<br>קיבלת חזרה <strong>' + d.refund + ' 💎</strong>' : '') +
        '</div>';
      ctaLabel = '↩ חזור לבית';
      ctaMode = '__home__';
      hideScoresVs = true;
    } else if (d && d.result === 'expired') {
      // The 24h window closed and the opponent never accepted. Server
      // auto-expired + refunded.
      emoji = '⏰'; title = 'פג תוקף'; color = '#BA7517';
      detail = '<div style="font-size:13px;color:#FAC775;margin-top:6px">' + escDuelHtml(oppName || 'היריב') + ' לא קיבל את האתגר בזמן' +
        (d.refund > 0 ? '<br>קיבלת חזרה <strong>' + d.refund + ' 💎</strong>' : '') +
        '</div>';
      ctaLabel = '↩ חזור לבית';
      ctaMode = '__home__';
      hideScoresVs = true;
    } else if (d && d.result === 'unresolved') {
      // 5 minutes of polling passed with no resolution. Don't hang the
      // player on a frozen spinner — give them a graceful exit + reassure
      // them they'll get notified later via the home banner.
      emoji = '⏳'; title = 'הניקוד שלך נשמר'; color = '#6B5CE7';
      detail = '<div style="font-size:13px;color:#B5B3F0;margin-top:6px">' +
        escDuelHtml(oppName || 'היריב') + ' עדיין לא שיחק.<br>תקבל הודעה ברגע שהמשחק יסתיים — בינתיים תוכל לחזור לשחק' +
        '</div>';
      ctaLabel = '↩ חזור לבית';
      ctaMode = '__home__';
      hideScoresVs = true;
    } else if (d && d.result === 'waiting') {
      emoji = '⏳'; title = 'ממתין ליריב...'; color = '#6B5CE7';
      detail = '<div style="font-size:13px;color:#B5B3F0;margin-top:6px">הניקוד שלך נשלח. נעדכן כשהיריב יסיים</div>';
    } else {
      emoji = '⚔️'; title = 'דו-קרב נשלח'; color = '#6B5CE7';
      detail = '';
    }

    // Build scores comparison (skipped for declined / expired / unresolved
    // where the opponent never played — showing "vs ..." would imply they
    // *did* play, which is misleading). Use `!= null` so a legitimate
    // opponent score of 0 (gave up on first drop) still renders as "0"
    // instead of dropping to the "..." placeholder.
    var oppScore = (d && d.opponentScore != null) ? d.opponentScore : null;
    var scoresHtml = '';
    if (!hideScoresVs) {
      scoresHtml = '<div style="display:flex;justify-content:center;gap:20px;margin:14px 0;font-size:13px">' +
        '<div style="text-align:center"><div style="font-size:11px;color:#A8A6A0">אתה</div><div style="font-size:22px;font-weight:900;color:#FAC775">' + myScore.toLocaleString() + '</div></div>' +
        '<div style="align-self:center;font-size:18px;color:#A8A6A0">vs</div>' +
        '<div style="text-align:center"><div style="font-size:11px;color:#A8A6A0">' + escDuelHtml(oppName) + '</div><div style="font-size:22px;font-weight:900;color:' + (oppScore != null ? '#FAC775' : '#555') + '">' + (oppScore != null ? oppScore.toLocaleString() : '...') + '</div></div>' +
      '</div>';
    } else {
      // Show only the player's own score in a compact card
      scoresHtml = '<div style="margin:14px 0;font-size:13px">' +
        '<div style="font-size:11px;color:#A8A6A0">הניקוד שלך</div>' +
        '<div style="font-size:26px;font-weight:900;color:#FAC775">' + myScore.toLocaleString() + '</div>' +
      '</div>';
    }

    // Bug #16 / Task #10 — one-tap rematch on a duel that ACTUALLY happened
    // (settled/tie, real human opponent). The highest-conversion post-match
    // CTA is "play them again immediately" — keep the momentum. The gradient
    // pink-purple button is the loud hero; "שחק שוב" (practice) drops to a
    // muted secondary so the eye lands on the rematch.
    var showRematch = !!(_lastDuelRematchCtx && d && (d.result === 'settled' || d.result === 'tie'));
    var rematchHtml = showRematch
      ? '<button class="duel-result-rematch" style="margin-top:16px;width:100%;padding:13px;border:none;border-radius:12px;background:linear-gradient(135deg,#A855F7,#EC4899);color:#fff;font-size:16px;font-weight:900;cursor:pointer;font-family:inherit;box-shadow:0 4px 16px rgba(168,85,247,0.4)">⚔️ דו-קרב שוב</button>'
      : '';
    var ctaBg = showRematch ? 'transparent' : '#FAC775';
    var ctaFg = showRematch ? '#A8A6A0' : '#412402';
    var ctaBorder = showRematch ? '1px solid rgba(255,255,255,0.14)' : 'none';
    var ctaWeight = showRematch ? '600' : '800';

    var overlay = document.createElement('div');
    overlay.setAttribute('data-duel-result-overlay', '1');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;direction:rtl';
    overlay.innerHTML =
      '<div style="background:#1C1A18;border-radius:20px;padding:28px 24px;max-width:320px;width:90%;text-align:center;border:2px solid ' + color + ';box-shadow:0 0 40px ' + color + '33">' +
        '<div style="font-size:48px;margin-bottom:8px">' + emoji + '</div>' +
        '<div style="font-size:24px;font-weight:900;color:' + color + '">' + title + '</div>' +
        scoresHtml +
        detail +
        rematchHtml +
        '<button class="duel-result-cta" style="margin-top:' + (showRematch ? '10' : '18') + 'px;width:100%;padding:12px;border:' + ctaBorder + ';border-radius:12px;background:' + ctaBg + ';color:' + ctaFg + ';font-size:16px;font-weight:' + ctaWeight + ';cursor:pointer;font-family:inherit">' + escDuelHtml(ctaLabel) + '</button>' +
      '</div>';
    document.body.appendChild(overlay);

    // Wire the CTA via addEventListener (NOT an inline onclick string) so it
    // runs inside the IIFE closure where init()/showHome() exist. The old
    // inline onclick ran in GLOBAL scope → "Can't find variable: init" on
    // every click (28 player-issue reports, all from the duel-result button).
    var ctaBtn = overlay.querySelector('.duel-result-cta');
    if (ctaBtn) ctaBtn.addEventListener('click', function() {
      try { overlay.remove(); } catch (e) {}
      if (ctaMode === '__home__') {
        if (typeof showHome === 'function') showHome();
      } else if (typeof init === 'function') {
        init('practice', { fresh: true });
      }
    });

    // Bug #16 / Task #10 — wire the rematch button to the existing
    // rematchDuel flow (closes overlay → reopens duel modal pre-filled
    // with the same opponent suffix + wager + difficulty).
    var rematchBtn = overlay.querySelector('.duel-result-rematch');
    if (rematchBtn && _lastDuelRematchCtx) {
      var rmCtx = _lastDuelRematchCtx;
      rematchBtn.addEventListener('click', function() {
        try { overlay.remove(); } catch (e) {}
        if (typeof window.rematchDuel === 'function') window.rematchDuel(rmCtx.suffix, rmCtx.wager, rmCtx.diff);
      });
    }

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
  // Tracks already-seen duel IDs in localStorage. We used to use
  // sessionStorage so the badge would re-fire each tab open, but that
  // turned out to mean the red dot NEVER cleared on real-world usage —
  // closing and re-opening Safari = unseen again, and on iOS that's
  // basically every other session. localStorage keeps the seen-state
  // across sessions; the entry is keyed { id → status } so a duel that
  // *transitions* (pending → settled) re-notifies as expected.
  var SEEN_DUELS_KEY = 'bloom_seen_duel_notifications_v2';
  function loadSeenDuels() {
    try { return JSON.parse(localStorage.getItem(SEEN_DUELS_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function markDuelSeen(duelId, status) {
    try {
      var seen = loadSeenDuels();
      seen[String(duelId)] = status;
      // Hard cap so this map can't grow forever for prolific duellists.
      var keys = Object.keys(seen);
      if (keys.length > 500) {
        // Drop oldest half by lowest numeric id (duel ids are sequential).
        keys.sort(function(a, b) { return parseInt(a, 10) - parseInt(b, 10); });
        for (var i = 0; i < Math.floor(keys.length / 2); i++) delete seen[keys[i]];
      }
      localStorage.setItem(SEEN_DUELS_KEY, JSON.stringify(seen));
    } catch (e) {}
  }
  function showDuelNotificationBanner(opts) {
    // opts: { kind: 'invite'|'won'|'lost'|'tie', name, score?, onTap }
    var existing = document.querySelector('[data-duel-notif="' + opts.id + '"]');
    if (existing) return; // already showing
    var b = document.createElement('div');
    b.setAttribute('data-duel-notif', opts.id);
    var bg = '#1C1A18', border = '#6B5CE7', emoji = '⚔️', title = 'אתגר חדש', sub = '';
    // Compact "vs" string when both scores are known — shown on the
    // result banners (won/lost/tie). The score numbers are the whole
    // reason a duel feels satisfying; the original banner just said
    // "ניצחת! מול X" and forced the player to dig into the modal to
    // see by how much.
    var vsScores = '';
    if (typeof opts.myScore === 'number' && typeof opts.oppScore === 'number') {
      vsScores = ' · ' + (opts.myScore | 0).toLocaleString() + ' vs ' + (opts.oppScore | 0).toLocaleString();
    }
    if (opts.kind === 'invite') {
      emoji = '⚔️'; title = (opts.name || 'מישהו') + ' אתגר/ה אותך!'; sub = 'לחץ לקבל'; border = '#6B5CE7';
    } else if (opts.kind === 'won') {
      emoji = '🏆'; title = 'ניצחת בדו-קרב!'; sub = 'מול ' + (opts.name || 'יריב') + vsScores; border = '#2E8B6F';
    } else if (opts.kind === 'lost') {
      emoji = '😔'; title = 'הפסדת בדו-קרב'; sub = 'מול ' + (opts.name || 'יריב') + vsScores; border = '#C8472F';
    } else if (opts.kind === 'tie') {
      emoji = '🤝'; title = 'תיקו בדו-קרב'; sub = 'מול ' + (opts.name || 'יריב') + vsScores; border = '#BA7517';
    } else if (opts.kind === 'declined') {
      // Opponent rejected. Tone is informative + warm — not "you failed".
      emoji = '🤷'; title = (opts.name || 'היריב') + ' סירב/ה לדו-קרב'; sub = 'ההימור הוחזר אליך'; border = '#BA7517';
    } else if (opts.kind === 'expired') {
      // 24h window closed. Server already refunded.
      emoji = '⏰'; title = 'דו-קרב מול ' + (opts.name || 'יריב') + ' פג תוקף'; sub = 'ההימור הוחזר אליך'; border = '#BA7517';
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
    // Tactile cue — different patterns by event kind so the player
    // can subconsciously tell what type of notification just arrived.
    try {
      if (typeof buzz === 'function') {
        var kind = (opts && opts.kind) || 'invite';
        if      (kind === 'invite')   buzz([14, 30, 14, 30, 14]);
        else if (kind === 'won')      buzz([20, 40, 20, 40, 40]);
        else if (kind === 'lost')     buzz([40]);
        else if (kind === 'tie')      buzz([18, 30, 18]);
        else if (kind === 'declined') buzz([24]);
        else if (kind === 'expired')  buzz([10, 40, 10]);
      }
    } catch (e) {}
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
            var myScoreForBanner = iAmChall ? duel.challenger_score : duel.opponent_score;
            var oppScoreForBanner = iAmChall ? duel.opponent_score : duel.challenger_score;
            var kind = 'tie';
            if (duel.status === 'settled') {
              kind = (duel.winner_device === deviceId) ? 'won' : 'lost';
            }
            showDuelNotificationBanner({
              id: duel.id,
              kind: kind,
              name: opponentName,
              myScore: myScoreForBanner,
              oppScore: oppScoreForBanner,
              onTap: function() { showDuelModal(); }
            });
          }
          markDuelSeen(duel.id, duel.status);
        } else if ((duel.status === 'declined' || duel.status === 'expired') && prevSeen !== duel.status) {
          // I challenged someone and they declined OR didn't accept in
          // time. The wager has been refunded server-side; surface a
          // banner so I know what happened next time I open the app.
          var iAmChallengerForOutcome = duel.challenger_device === deviceId;
          if (iAmChallengerForOutcome) {
            showDuelNotificationBanner({
              id: duel.id,
              kind: duel.status, // 'declined' or 'expired'
              name: duel.opponent_name || duel.opponent_code,
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

  // ============================================================
  // SEND-GIFT MODAL — player-to-player gem transfer
  // ============================================================
  // Counterpart to the duel modal: same BLOOM-XXXX input shape, but
  // it sends gems peacefully instead of starting a wager. Recipient
  // sees a toast banner the next time they open the app (handled by
  // pollGiftInbox in src/05a-home-v2.js).
  function showGiftFriendModal(prefillSuffix) {
    var existing = document.getElementById('gift-friend-modal');
    if (existing) existing.remove();
    var modal = document.createElement('div');
    modal.id = 'gift-friend-modal';
    modal.className = 'info-modal';
    modal.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;' +
      'display:flex;align-items:center;justify-content:center;direction:rtl;padding:16px';
    var preSuf = (prefillSuffix || '').toString().slice(0, 4).toUpperCase();
    modal.innerHTML =
      '<div class="info-card" style="background:#FFF;border-radius:18px;padding:22px 22px;max-width:340px;width:100%;direction:rtl;box-shadow:0 20px 60px rgba(0,0,0,0.3);border:1px solid #FAC775">' +
        '<div style="font-size:17px;font-weight:800;margin-bottom:4px;color:#1C1A18">🎁 שלח מתנה לחבר</div>' +
        '<div style="font-size:12px;color:#6F6E68;margin-bottom:14px">תן 💎 לחבר/ה במשחק. הם יקבלו הודעה ברגע שיפתחו את BLOOM.</div>' +

        '<div style="font-size:11px;font-weight:600;margin-bottom:4px;color:#1C1A18">קוד הנמען</div>' +
        '<div dir="ltr" style="display:flex;align-items:stretch;border:1px solid rgba(0,0,0,0.12);border-radius:8px;overflow:hidden;margin-bottom:10px;background:#FFFFFF;direction:ltr">' +
          '<span style="background:#1C1A18;color:#FAC775;padding:8px 10px;font-weight:700;letter-spacing:0.08em;font-family:ui-monospace,monospace;display:flex;align-items:center">BLOOM-</span>' +
          '<input id="gift-recipient-suffix" dir="ltr" maxlength="4" inputmode="latin" autocapitalize="characters" autocomplete="off" placeholder="XXXX" value="' + escDuelHtml(preSuf) + '" style="flex:1;padding:8px;border:0;font-family:ui-monospace,monospace;font-size:16px;text-transform:uppercase;letter-spacing:0.2em;font-weight:700;text-align:center;outline:none;background:transparent;direction:ltr">' +
        '</div>' +

        '<div style="font-size:11px;font-weight:600;margin-bottom:4px;color:#1C1A18">סכום (5-200 💎)</div>' +
        '<div id="gift-amount-pills" style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">' +
          '<button type="button" class="gift-pill selected" data-amt="10" style="flex:1;min-width:50px;padding:6px 8px;font-size:12px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#1C1A18;color:#FAC775;font-weight:700;cursor:pointer">10💎</button>' +
          '<button type="button" class="gift-pill" data-amt="25" style="flex:1;min-width:50px;padding:6px 8px;font-size:12px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#F5F2EC;color:#1C1A18;font-weight:700;cursor:pointer">25💎</button>' +
          '<button type="button" class="gift-pill" data-amt="50" style="flex:1;min-width:50px;padding:6px 8px;font-size:12px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#F5F2EC;color:#1C1A18;font-weight:700;cursor:pointer">50💎</button>' +
          '<button type="button" class="gift-pill" data-amt="100" style="flex:1;min-width:50px;padding:6px 8px;font-size:12px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;background:#F5F2EC;color:#1C1A18;font-weight:700;cursor:pointer">100💎</button>' +
        '</div>' +

        '<div style="font-size:11px;font-weight:600;margin-bottom:4px;color:#1C1A18">הודעה (אופציונלי)</div>' +
        '<input id="gift-message" maxlength="120" placeholder="שתהנה!" style="width:100%;padding:8px;border:1px solid rgba(0,0,0,0.12);border-radius:8px;font-size:13px;font-family:inherit;margin-bottom:14px;direction:rtl">' +

        '<button class="btn" id="gift-send" style="width:100%;background:linear-gradient(135deg,#FAC775,#BA7517);color:#FFF;font-weight:800">שלח 🎁</button>' +
        '<div id="gift-error" style="color:#C8472F;font-size:12px;text-align:center;min-height:18px;margin-top:8px"></div>' +
        '<button class="btn secondary" style="width:100%;margin-top:6px;background:transparent;color:#6F6E68" onclick="document.getElementById(\'gift-friend-modal\').remove()">סגור</button>' +
      '</div>';
    document.body.appendChild(modal);
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };

    // Amount pill picker
    var chosenAmt = 10;
    modal.querySelectorAll('.gift-pill').forEach(function(pill) {
      pill.onclick = function() {
        modal.querySelectorAll('.gift-pill').forEach(function(p) {
          p.classList.remove('selected');
          p.style.background = '#F5F2EC';
          p.style.color = '#1C1A18';
        });
        pill.classList.add('selected');
        pill.style.background = '#1C1A18';
        pill.style.color = '#FAC775';
        chosenAmt = parseInt(pill.getAttribute('data-amt'), 10) || 10;
      };
    });

    // Paste-normalize the recipient field same as the duel modal
    var sufEl = document.getElementById('gift-recipient-suffix');
    if (sufEl) sufEl.addEventListener('input', function() {
      var cleaned = (sufEl.value || '').toUpperCase().replace(/^BLOOM-?/, '').replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 4);
      if (cleaned !== sufEl.value) sufEl.value = cleaned;
    });

    document.getElementById('gift-send').onclick = async function() {
      var btn = this;
      var suf = (sufEl.value || '').trim().toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '');
      var msg = (document.getElementById('gift-message').value || '').trim().slice(0, 120);
      var errEl = document.getElementById('gift-error');
      errEl.style.color = '#C8472F';
      errEl.textContent = '';
      if (suf.length !== 4) { errEl.textContent = 'הקוד חייב להיות 4 תווים'; return; }
      if (typeof playerBalance !== 'undefined' && playerBalance < chosenAmt) {
        errEl.textContent = '💎 אין מספיק קרדיטים (יתרה: ' + playerBalance + ')';
        return;
      }
      btn.disabled = true;
      btn.textContent = '...';
      try {
        var r = await fetch(API_BASE + '/api/player/gift-friend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId: deviceId,
            token: deviceToken,
            recipientCode: 'BLOOM-' + suf,
            amount: chosenAmt,
            message: msg || null
          })
        });
        var d = await r.json();
        btn.disabled = false;
        btn.textContent = 'שלח 🎁';
        if (d && d.ok) {
          // Local balance update + UI feedback
          if (typeof playerBalance !== 'undefined') { playerBalance = d.newBalance; }
          if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay();
          errEl.style.color = '#2E8B6F';
          errEl.textContent = '✓ נשלח! ' + (d.recipientCode || ('BLOOM-' + suf)) + ' יקבל/ת הודעה';
          if (typeof showCreditToast === 'function') showCreditToast(-chosenAmt, 'מתנה ל-' + suf);
          // Sending a gift is also a great moment to ask for push
          // permission — the sender clearly cares about social play.
          try {
            if (typeof window.__bloomMaybeAskPush === 'function') {
              window.__bloomMaybeAskPush('כשמישהו ישלח לך מתנה או יאתגר אותך — תדע מיד, גם כשהמשחק סגור.');
            }
          } catch (e) {}
          setTimeout(function() { modal.remove(); }, 1400);
        } else {
          var msgs = {
            recipient_not_found: 'שחקן לא נמצא',
            no_self_gift: 'אי אפשר לשלוח לעצמך',
            insufficient_balance: 'אין מספיק 💎',
            bad_code: 'קוד לא חוקי',
            bad_amount: 'סכום לא חוקי',
            rate_limited_daily: 'שלחת היום יותר מדי מתנות. נסה מחר'
          };
          errEl.textContent = msgs[d && d.reason] || 'שגיאה';
        }
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'שלח 🎁';
        errEl.textContent = 'שגיאת חיבור';
      }
    };
  }

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
    if (el) {
      var b = playerBalance;
      var text = b >= 100000 ? Math.round(b / 1000) + 'K'
        : b >= 10000 ? (b / 1000).toFixed(1).replace('.0', '') + 'K'
        : b >= 1000 ? (b / 1000).toFixed(1).replace('.0', '') + 'K'
        : String(b);
      el.textContent = text;
    }
    // T1.3 — propagate to the home Balance Widget. The widget reads
    // playerBalance directly so a render-only call is enough; no need
    // to pass delta here (delta is reserved for earnCredits anim).
    try { if (typeof window.__bloomRenderBal === 'function') window.__bloomRenderBal(); } catch (e) {}
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

    // Section 3: Dynamic Boards extras — streak freezes + bonus chest.
    // These are "meta" items that affect the dynamic-boards retention
    // loop, not the current game. Only shown when the underlying systems
    // are enabled (admin master toggles). Hides cleanly when both off.
    var freezeOn = (typeof dynConfigBool === 'function') ? dynConfigBool('dyn_streak_freeze_enabled', true) : true;
    var chestOn  = (typeof dynConfigBool === 'function') ? dynConfigBool('dyn_chest_enabled', true) : true;
    if (freezeOn || chestOn) {
      html += '<div class="ts-section-label">לוחות דינמיים</div>';
      html += '<div class="ts-powerups">';
      if (freezeOn) {
        var freezePrice = (typeof dynConfigInt === 'function') ? dynConfigInt('dyn_streak_freeze_price', 200) : 200;
        var freezeCount = (typeof getStreakFreezes === 'function') ? getStreakFreezes() : 0;
        html += '<button class="ts-power" data-shop-action="dyn-freeze"' +
          (playerBalance < freezePrice ? ' disabled' : '') + '>' +
          '<span class="ts-power-icon">🛡</span>' +
          '<span class="ts-power-name">הקפאת רצף<br><span style="font-size:9px;opacity:0.75">יש לך: ' + freezeCount + '</span></span>' +
          '<span class="ts-power-price">' + freezePrice + ' 💎</span></button>';
      }
      if (chestOn) {
        // Extra chest costs 100💎 — bypasses the daily cap and gives you
        // an instant Skinner-box reveal without playing a game. Pure
        // gambling, sold transparently.
        html += '<button class="ts-power ts-power-premium" data-shop-action="bonus-chest"' +
          (playerBalance < 100 ? ' disabled' : '') + '>' +
          '<span class="ts-power-icon">🎁</span>' +
          '<span class="ts-power-name">תיבת מסתורין<br>בונוס</span>' +
          '<span class="ts-power-price">100 💎</span></button>';
      }
      html += '</div>';
      html += '<div class="ts-hint">🛡 = הצל את הרצף שלך מיום שתפספס · 🎁 = פתח תיבה בלי לשחק</div>';
    }

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
          body: JSON.stringify({ deviceId: deviceId, token: deviceToken, tier: tier })
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
        // Special shop actions (streak freeze, bonus chest) — separate
        // endpoints from the standard powerup buy.
        var shopAction = this.getAttribute('data-shop-action');
        if (shopAction === 'dyn-freeze') {
          var fself = this;
          fself.style.opacity = '0.5';
          if (typeof buyStreakFreeze !== 'function') { fself.style.opacity = '1'; return; }
          buyStreakFreeze().then(function(d) {
            if (d && d.ok) {
              modal.remove();
              showCreditToast(-d.price, '🛡 הקפאת רצף');
              trackEvent && trackEvent('purchase', { item: 'streak_freeze', cost: d.price });
            } else {
              fself.style.opacity = '1';
              fself.querySelector('.ts-power-price').textContent = (d && d.reason === 'insufficient_funds') ? 'אין 💎' : 'שגיאה';
            }
          });
          return;
        }
        if (shopAction === 'bonus-chest') {
          var cself = this;
          cself.style.opacity = '0.5';
          // Buy a bonus chest: deduct 100💎 first, then open via the
          // existing chest endpoint (which itself credits the reward).
          // The deduction is part of the explicit shop interaction so
          // it bypasses the chest endpoint's daily cap.
          fetch(API_BASE + '/api/player/spend', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId: deviceId, token: deviceToken, amount: 100, reason: 'bonus_chest' })
          })
            .then(function(r) { return r.json(); })
            .then(function(spendRes) {
              if (!spendRes || !spendRes.ok) {
                cself.style.opacity = '1';
                return;
              }
              playerBalance = spendRes.newBalance;
              try { localStorage.setItem(PLAYER_BALANCE_KEY, String(spendRes.newBalance)); } catch(e) {}
              updateBalanceDisplay();
              modal.remove();
              if (typeof openMysteryChest === 'function') {
                setTimeout(openMysteryChest, 250);
              }
              trackEvent && trackEvent('purchase', { item: 'bonus_chest', cost: 100 });
            })
            .catch(function() { cself.style.opacity = '1'; });
          return;
        }
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
          body: JSON.stringify({ deviceId: deviceId, token: deviceToken, powerup: configKey })
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
    // Cancellation is now a local-only optimistic refund — the server's `refund`
    // branch was removed because it could be called without a prior charge.
    // The visible balance reflects the refund until the next server sync, after
    // which it returns to the deducted value. Accepted UX cost to close the hole.
    if (activePowerupCost > 0) {
      playerBalance += activePowerupCost;
      try { localStorage.setItem(PLAYER_BALANCE_KEY, String(playerBalance)); } catch(e) {}
      updateBalanceDisplay();
      showCreditToast(activePowerupCost, 'ביטול — החזר 💎');
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
  // TA.1 — Game-Over Persistence. Saved at the moment a game-over fires
  // for practice/dynamic/contest so a refresh restores the over screen
  // instead of dropping back to a fresh playable grid. Daily has its own
  // long-lived gate via DAILY_PLAYED_PREFIX so it's excluded here.
  const LAST_GAME_KEY = 'bloom_last_game_v1';
  const LAST_GAME_TTL_MS = 30 * 60 * 1000;
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
