  async function showChallengesList(entryFrom) {
    if (entryFrom) challengeListEntryFrom = entryFrom;
    const app = document.querySelector('.app');
    if (!app) return;
    hideHome();
    hideContestScreens();
    hideChallengeScreens();
    const screen = document.createElement('div');
    screen.id = 'challenge-screen';
    screen.className = 'contest-screen';
    screen.innerHTML =
      createBackButton('challenges') +
      '<div class="contest-title">אתגרי BLOOM</div>' +
      '<div class="contest-sub">ניסיון אחד. פרס אמיתי.</div>' +
      '<div class="lb-tabs" id="cl-tabs" style="max-width:340px;margin:8px auto 4px">' +
        '<button class="lb-tab' + (challengeListTab === 'active' ? ' active' : '') + '" data-tab="active">פעילים</button>' +
        '<button class="lb-tab' + (challengeListTab === 'history' ? ' active' : '') + '" data-tab="history">היסטוריה</button>' +
      '</div>' +
      '<div class="challenge-list" id="challenge-list"><div class="contest-loading">טוען…</div></div>';
    app.appendChild(screen);
    document.querySelectorAll('#cl-tabs .lb-tab').forEach(function(b) {
      b.onclick = function() {
        const tab = b.getAttribute('data-tab');
        if (tab === challengeListTab) return;
        challengeListTab = tab;
        document.querySelectorAll('#cl-tabs .lb-tab').forEach(function(x) { x.classList.toggle('active', x === b); });
        renderChallengeListBody();
      };
    });
    renderChallengeListBody();
  }

  async function renderChallengeListBody() {
    const host = document.getElementById('challenge-list');
    if (!host) return;
    host.innerHTML = '<div class="contest-loading">טוען…</div>';
    let list;
    if (challengeListTab === 'history') {
      list = await fetchHistoryChallenges({ fresh: true });
    } else {
      list = await fetchChallenges({ fresh: true });
    }
    if (!host.isConnected) return;  // user navigated away mid-fetch
    if (!list || !list.length) {
      if (challengeListTab === 'history') {
        host.innerHTML = '<div class="contest-board-empty">אין עדיין אתגרים שהסתיימו</div>';
        return;
      }
      // UX audit 2026-06-02 — the old "נסה מחר" empty-state literally told the
      // player to leave. Keep them in-game: warm anticipation copy + a push
      // opt-in for the next prize drop + a practice fallback so the session
      // continues.
      host.innerHTML =
        '<div class="challenge-empty-card">' +
          '<div class="challenge-empty-emoji">🎁</div>' +
          '<div class="challenge-empty-title">האתגר הבא בקרוב</div>' +
          '<div class="challenge-empty-sub">פרסים אמיתיים · ניסיון אחד · אל תפספס</div>' +
          '<button class="btn challenge-empty-notify" id="chal-empty-notify">🔔 הודיעו לי כשמתחיל</button>' +
          '<button class="btn secondary challenge-empty-play" id="chal-empty-play">🎮 בינתיים — שחק פרקטיס</button>' +
        '</div>';
      var notifyBtn = document.getElementById('chal-empty-notify');
      if (notifyBtn) notifyBtn.onclick = function() {
        try { ensureAudio(); } catch (e) {}
        if (typeof window.__bloomMaybeAskPush === 'function') window.__bloomMaybeAskPush('challenge_drop');
        else if (typeof showToast === 'function') showToast('נודיע לך כשאתגר חדש מתחיל 🔔', 'success');
      };
      var playBtn = document.getElementById('chal-empty-play');
      if (playBtn) playBtn.onclick = function() {
        try { ensureAudio(); } catch (e) {}
        if (typeof window.__bloomStartMode === 'function') window.__bloomStartMode('practice', { fresh: true });
        else if (typeof init === 'function') init('practice', { fresh: true });
      };
      return;
    }
    host.innerHTML = list.map(function(c) {
      const entered = !!c.myEntry;
      const winnersFilled = c.winnersFilled | 0;
      const winnersRemaining = (c.winnersCount | 0) - winnersFilled;
      const isHistory = challengeListTab === 'history';
      // UX audit 2026-06-02 — scarcity is the sharpest lever; surface it loudly
      // when the prize is almost gone (only for joinable, non-entered cards).
      const scarcityChip = (!isHistory && !entered && winnersRemaining > 0 && winnersRemaining <= 2)
        ? '<span class="challenge-scarcity">🔥 ' + (winnersRemaining === 1 ? 'מקום אחרון לזכייה!' : 'נשארו ' + winnersRemaining + ' מקומות!') + '</span>'
        : '';
      const meta = entered
        ? (c.myEntry.is_winner ? '👑 זכית · מקום ' + c.myEntry.winner_rank : '✓ השתתפת · ' + (c.myEntry.score | 0).toLocaleString() + ' נק׳')
        : (winnersFilled > 0 ? winnersFilled + '/' + c.winnersCount + ' זוכים כבר נסגרו' : c.entriesCount + ' משתתפים');
      const rightSide = isHistory
        ? 'הסתיים <strong>' + escapeHtml(formatRelativeTime(c.endsAt) || fmtEndsDate(c.endsAt)) + '</strong>'
        : 'נותרו <strong class="chal-card-time" data-ends="' + escapeHtml(c.endsAt) + '">' + escapeHtml(challengeTimeLeft(c.endsAt)) + '</strong>';
      // Top winners line (history only): show the names of who won.
      let winnersLine = '';
      if (isHistory && c.topWinners && c.topWinners.length) {
        const txt = c.topWinners.map(function(w) {
          return '👑 ' + escapeHtml(w.name) + ' (' + (w.score | 0).toLocaleString() + ')';
        }).join(' · ');
        winnersLine = '<div class="challenge-card-desc" style="color:#BA7517;font-weight:600;margin-top:4px">' + txt + '</div>';
      } else if (isHistory) {
        winnersLine = '<div class="challenge-card-desc" style="font-style:italic">לא נקבעו זוכים</div>';
      }
      return '<button class="challenge-card' + (entered ? ' entered' : '') + (isHistory ? ' ended' : '') + '" data-slug="' + escapeHtml(c.slug) + '">' +
        '<div class="challenge-card-top">' +
          '<div class="challenge-card-name">' + escapeHtml(c.name) + '</div>' +
          scarcityChip +
        '</div>' +
        // UX audit 2026-06-02 — prize is the whole reason the feature exists;
        // promote it from an 11px corner pill to a full-width row with a "real
        // prize" badge so it dominates the card.
        (isHistory ? '' :
          '<div class="challenge-card-prize-row">' +
            '<span class="ccpr-gift">🎁</span>' +
            '<span class="ccpr-val">' + escapeHtml(c.prizeText) + '</span>' +
            '<span class="ccpr-badge">פרס אמיתי</span>' +
          '</div>') +
        (c.description ? '<div class="challenge-card-desc">' + escapeHtml(c.description) + '</div>' : '') +
        winnersLine +
        '<div class="challenge-card-meta">' +
          '<div><span class="challenge-type-pill">' + escapeHtml(challengeTypeLabel(c)) + '</span>' + escapeHtml(meta) + '</div>' +
          '<div>' + rightSide + '</div>' +
        '</div>' +
      '</button>';
    }).join('');
    host.querySelectorAll('.challenge-card').forEach(function(b) {
      b.onclick = function() { showChallengeDetail(b.getAttribute('data-slug')); };
    });
    startChallengeCountdownTicker();
  }
  function fmtEndsDate(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('he-IL'); } catch (e) { return iso; }
  }

  // UX audit 2026-06-02 — a single-attempt real-prize contest is the strongest
  // FOMO lever in the app, but the deadline was a static coarse string ("3
  // ימים") baked once into innerHTML. This 1s ticker makes it visibly count
  // down: the detail header always shows live HH:MM:SS; list cards switch to a
  // ticking clock + red pulse in the final 2 hours. Self-clears when the
  // challenge screen leaves the DOM.
  function startChallengeCountdownTicker() {
    if (window._chalCountdownTimer) { clearInterval(window._chalCountdownTimer); window._chalCountdownTimer = null; }
    if (typeof formatCountdown !== 'function') return;
    function tick() {
      if (!document.getElementById('challenge-screen')) {
        clearInterval(window._chalCountdownTimer); window._chalCountdownTimer = null; return;
      }
      var d = document.getElementById('chal-countdown');
      if (d && d.dataset.ends) {
        var dms = new Date(d.dataset.ends) - new Date();
        d.textContent = dms <= 0 ? 'הסתיים' : formatCountdown(dms);
        d.classList.toggle('chal-countdown-urgent', dms > 0 && dms < 3600000);
      }
      document.querySelectorAll('.chal-card-time[data-ends]').forEach(function(el) {
        var ms = new Date(el.dataset.ends) - new Date();
        if (ms <= 0) { el.textContent = 'הסתיים'; el.classList.remove('chal-countdown-urgent'); return; }
        if (ms < 2 * 3600000) { el.textContent = formatCountdown(ms); el.classList.add('chal-countdown-urgent'); }
        else { el.textContent = challengeTimeLeft(el.dataset.ends); el.classList.remove('chal-countdown-urgent'); }
      });
    }
    tick();
    window._chalCountdownTimer = setInterval(tick, 1000);
  }

  // UX audit 2026-06-02 — the type pill is terse ("מרוץ ל-50,000"). This is the
  // plain-language "how do I actually win?" sentence shown under the prize.
  function challengeTypeExplain(c) {
    var t = c.challengeType;
    if (t === 'race') return 'הראשונים שמגיעים ל-' + (c.thresholdScore || 0).toLocaleString() + ' נקודות זוכים';
    if (t === 'top_n') return (c.winnersCount || 1) + ' בעלי הניקוד הגבוה ביותר עד סוף האתגר זוכים';
    if (t === 'beat') return 'כל מי שעובר ' + (c.thresholdScore || 0).toLocaleString() + ' נקודות זוכה';
    if (t === 'first_to_tier') {
      var tier = (typeof getActiveTiers === 'function') ? getActiveTiers()[c.thresholdTier | 0] : null;
      return 'הראשונים שמגיעים ל' + (tier ? tier.name : 'דרגה ' + (c.thresholdTier || '?')) + ' זוכים';
    }
    return '';
  }

  async function showChallengeDetail(slug) {
    const app = document.querySelector('.app');
    if (!app) return;
    hideHome();
    hideContestScreens();
    hideChallengeScreens();
    const screen = document.createElement('div');
    screen.id = 'challenge-screen';
    screen.className = 'contest-screen';
    screen.innerHTML =
      createBackButton('challenges-list') +
      '<div class="contest-loading">טוען…</div>';
    app.appendChild(screen);
    const data = await fetchChallenge(slug);
    if (!data || !data.challenge) {
      screen.innerHTML =
        createBackButton('challenges-list') +
        '<div class="contest-title" style="margin-top:60px">לא נמצא אתגר</div>';
      return;
    }
    const c = data.challenge;
    const myEntry = c.myEntry;
    const entered = !!myEntry;
    const inProgress = entered && myEntry.status === 'in_progress';
    const completed  = entered && myEntry.status === 'completed';
    const isWinner   = entered && myEntry.is_winner;
    const winnersFull = (c.winnersFilled | 0) >= (c.winnersCount | 0) && c.challengeType !== 'top_n' && c.challengeType !== 'beat';
    const winnersRemaining = (c.winnersCount | 0) - (c.winnersFilled | 0);
    const standingsHtml = (data.standings || []).slice(0, 10).map(function(s, i) {
      const rank = s.winner_rank ? s.winner_rank : (i + 1);
      return '<div class="challenge-standings-row' + (s.is_winner ? ' winner' : '') + '">' +
        '<div class="challenge-standings-rank">' + (s.is_winner ? '<span class="challenge-crown">👑</span>' : rank) + '</div>' +
        '<div class="challenge-standings-name">' + renderAvatarHtml(s.display_name, 'sm') + escapeHtml(s.display_name) + '</div>' +
        '<div class="challenge-standings-score">' + (s.score | 0).toLocaleString() + '</div>' +
      '</div>';
    }).join('');
    const prizeImg = c.prizeImageUrl
      ? '<img src="' + escapeHtml(c.prizeImageUrl) + '" alt="' + escapeHtml(c.prizeText) + '" onerror="this.style.display=\'none\'">'
      : '';
    let actionHtml;
    if (winnersFull && !isWinner) {
      actionHtml = '<button class="btn" disabled style="opacity:0.5">כל הזוכים נסגרו</button>';
    } else if (isWinner) {
      actionHtml = '<button class="btn" id="chal-claim">👑 השאר פרטים לקבלת הפרס</button>';
    } else if (completed) {
      actionHtml = '<button class="btn secondary" disabled>כבר השתתפת — ניקוד ' + (myEntry.score | 0).toLocaleString() + '</button>';
    } else if (inProgress) {
      actionHtml = '<button class="btn secondary" disabled>המשחק שלך הסתיים — ניקוד אחרון ' + (myEntry.score | 0).toLocaleString() + '</button>';
    } else {
      actionHtml = '<button class="btn" id="chal-start">התחל אתגר →</button>';
    }
    screen.innerHTML =
      createBackButton('challenges-list') +
      '<div class="contest-title">' + escapeHtml(c.name) + '</div>' +
      '<div class="contest-sub">' + escapeHtml(challengeTypeLabel(c)) + ' · ' + (c.winnersCount | 0) + ' זוכים · נותרו <span class="chal-countdown" id="chal-countdown" data-ends="' + escapeHtml(c.endsAt) + '">' + escapeHtml(challengeTimeLeft(c.endsAt)) + '</span></div>' +
      ((!winnersFull && winnersRemaining > 0 && winnersRemaining <= 2)
        ? '<div class="challenge-scarcity-strip">🔥 ' + (winnersRemaining === 1 ? 'נשאר מקום אחד לזכייה!' : 'נשארו ' + winnersRemaining + ' מקומות לזכייה!') + '</div>'
        : '') +
      '<div class="challenge-prize-banner">' +
        prizeImg +
        '<div class="label">הפרס</div>' +
        '<div class="prize">🎁 ' + escapeHtml(c.prizeText) + '</div>' +
        (c.description ? '<div class="sub">' + escapeHtml(c.description) + '</div>' : '') +
      '</div>' +
      (challengeTypeExplain(c) ? '<div class="challenge-howto">🎯 איך זוכים? ' + escapeHtml(challengeTypeExplain(c)) + '</div>' : '') +
      (c.rulesText ? '<div class="challenge-rules"><strong>📜 תקנון:</strong> ' + escapeHtml(c.rulesText) + '</div>' : '') +
      (standingsHtml
        ? '<div class="challenge-standings"><h4>הניקודים המובילים</h4>' + standingsHtml + '</div>'
        : '') +
      '<div class="contest-form">' + actionHtml + '</div>';
    const startBtn = document.getElementById('chal-start');
    if (startBtn) startBtn.onclick = function() { showChallengePreEnter(c); };
    const claimBtn = document.getElementById('chal-claim');
    if (claimBtn) claimBtn.onclick = function() { showChallengeClaim(c); };
    startChallengeCountdownTicker();
  }

  function showChallengePreEnter(c) {
    const wrap = document.getElementById('challenge-screen') || document.querySelector('.app');
    if (!wrap) return;
    let modal = document.getElementById('chal-pre-modal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'chal-pre-modal';
    modal.className = 'info-modal';
    const prefillName = (getPlayerName() || '').trim();
    modal.innerHTML =
      '<div class="info-card">' +
        '<button class="info-close" id="chal-pre-close" aria-label="סגור"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
        '<div class="info-title">🎁 ' + escapeHtml(c.name) + '</div>' +
        '<div class="info-sub">פרס: ' + escapeHtml(c.prizeText) + '</div>' +
        '<div class="challenge-warn">' +
          '<strong>זה הניסיון היחיד שלך.</strong><br>אין reset, אין pause, אין חזרה. ברגע שתתחיל — המשחק רץ עד הסוף. מוכן?' +
        '</div>' +
        '<div class="contest-form">' +
          '<div class="contest-form-label">השם שלך בלוח</div>' +
          '<input class="contest-input" id="chal-name" autocapitalize="words" placeholder="כתוב את שמך" maxlength="50" value="' + escapeHtml(prefillName) + '" />' +
          (c.rulesText ? '<label class="challenge-checkbox-row"><input type="checkbox" id="chal-agree"> קראתי את התקנון</label>' : '') +
          '<button class="contest-submit-btn" id="chal-go">התחל אתגר</button>' +
          '<button class="contest-secondary-btn" id="chal-cancel" style="margin-top:6px">ביטול</button>' +
          '<div class="contest-error" id="chal-err"></div>' +
        '</div>' +
      '</div>';
    wrap.appendChild(modal);
    document.getElementById('chal-pre-close').onclick = function() { modal.remove(); };
    document.getElementById('chal-cancel').onclick    = function() { modal.remove(); };
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    document.getElementById('chal-go').onclick = async function() {
      const nameInput = document.getElementById('chal-name');
      const errEl = document.getElementById('chal-err');
      const name = (nameInput.value || '').trim();
      if (!name) { errEl.textContent = 'נא להזין שם'; return; }
      const agreeEl = document.getElementById('chal-agree');
      if (agreeEl && !agreeEl.checked) { errEl.textContent = 'יש לאשר את התקנון'; return; }
      this.disabled = true; this.textContent = 'מתחיל…';
      try {
        const res = await fetch(API_BASE + '/api/challenges/' + encodeURIComponent(c.slug) + '/enter', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: deviceId, token: deviceToken, displayName: name })
        });
        const data = await res.json().catch(function() { return {}; });
        if (!res.ok) {
          errEl.textContent = data.error === 'already_entered' ? 'כבר השתתפת באתגר הזה.'
            : data.error === 'rate_limited' ? 'יותר מדי ניסיונות. נסה בעוד שעה.'
            : 'שגיאה: ' + (data.error || res.status);
          this.disabled = false; this.textContent = 'התחל אתגר';
          return;
        }
        setPlayerName(name);
        modal.remove();
        hideChallengeScreens();
        trackEvent('challenge_enter', { slug: c.slug, type: c.challengeType });
        beginChallengeRun(c, data);
      } catch (e) {
        errEl.textContent = 'שגיאת חיבור. נסה שוב.';
        this.disabled = false; this.textContent = 'התחל אתגר';
      }
    };
  }

  function showChallengeClaim(c) {
    const wrap = document.getElementById('challenge-screen') || document.querySelector('.app');
    if (!wrap) return;
    let modal = document.getElementById('chal-claim-modal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'chal-claim-modal';
    modal.className = 'info-modal';
    modal.innerHTML =
      '<div class="info-card">' +
        '<button class="info-close" id="chal-claim-close" aria-label="סגור"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
        '<div class="info-title">🎉 ניצחת באתגר!</div>' +
        '<div class="info-sub">פרס: ' + escapeHtml(c.prizeText) + ' — מלא פרטים ויצור קשר.</div>' +
        '<div class="challenge-claim-form">' +
          // UX audit 2026-06-02 — the most important conversion step (a winner
          // claiming a real prize) had placeholder-only inputs that popped the
          // wrong mobile keyboard. Correct type/inputmode/autocomplete + labels.
          '<label class="contest-form-label" for="cc-name">שם מלא</label>' +
          '<input id="cc-name" type="text" autocomplete="name" autocapitalize="words" placeholder="שם מלא" maxlength="80" />' +
          '<label class="contest-form-label" for="cc-phone">טלפון / WhatsApp</label>' +
          '<input id="cc-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="050-0000000" maxlength="40" />' +
          '<label class="contest-form-label" for="cc-email">אימייל (אופציונלי)</label>' +
          '<input id="cc-email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" placeholder="name@example.com" maxlength="120" />' +
          '<button class="contest-submit-btn" id="cc-go">שלח לאדמין</button>' +
          '<div class="contest-error" id="cc-err"></div>' +
          '<div class="help" style="font-size:11px;color:#A8A6A0;margin-top:8px;text-align:right">הפרטים שלך נשמרים בדשבורד פרטי בלבד. ייצרו איתך קשר תוך 48 שעות.</div>' +
        '</div>' +
      '</div>';
    wrap.appendChild(modal);
    document.getElementById('chal-claim-close').onclick = function() { modal.remove(); };
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    document.getElementById('cc-go').onclick = async function() {
      const name  = document.getElementById('cc-name').value.trim();
      const phone = document.getElementById('cc-phone').value.trim();
      const email = document.getElementById('cc-email').value.trim();
      const err = document.getElementById('cc-err');
      if (!name) { err.textContent = 'שם הוא חובה'; return; }
      if (!phone && !email) { err.textContent = 'נא להזין טלפון או אימייל'; return; }
      this.disabled = true; this.textContent = 'שולח…';
      try {
        const res = await fetch(API_BASE + '/api/challenges/' + encodeURIComponent(c.slug) + '/claim', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: deviceId, token: deviceToken, contactName: name, contactPhone: phone, contactEmail: email })
        });
        const data = await res.json().catch(function() { return {}; });
        if (!res.ok) {
          err.textContent = data.error === 'not_winner_or_already_claimed' ? 'כבר נשלחו פרטים.' : 'שגיאה: ' + (data.error || res.status);
          this.disabled = false; this.textContent = 'שלח לאדמין';
          return;
        }
        modal.innerHTML = '<div class="info-card"><div class="info-title">✓ הפרטים נשלחו!</div><div class="info-sub">ייצרו איתך קשר תוך 48 שעות.</div><button class="btn" id="cc-done" style="margin-top:14px">סגור</button></div>';
        document.getElementById('cc-done').onclick = function() { modal.remove(); showChallengeDetail(c.slug); };
      } catch (e) {
        err.textContent = 'שגיאת חיבור.';
        this.disabled = false; this.textContent = 'שלח לאדמין';
      }
    };
  }

  // ================================================================
  // CHALLENGE RUN — the in-game side of a prize attempt.
  // ================================================================
  // beginChallengeRun() is the single entry point. It locks the player into
  // challenge mode (no reset, no pause, no save), pushes the live grid to the
  // server on every drop, and routes to the result screen on game-over.

  function beginChallengeRun(challengeMeta, enterResp) {
    activeChallenge = {
      slug:           challengeMeta.slug,
      name:           challengeMeta.name,
      prizeText:      challengeMeta.prizeText || enterResp.prizeText,
      challengeType:  enterResp.challengeType,
      thresholdScore: enterResp.thresholdScore,
      thresholdTier:  enterResp.thresholdTier,
      winnersCount:   enterResp.winnersCount,
      boardSeed:      enterResp.boardSeed,
      drops:          0,           // running count synced to localStorage
      isWinner:       false,
      winnerRank:     null
    };
    clearChallengeDrops(challengeMeta.slug);
    hideChallengeScreens();
    init('challenge', { fresh: true });
  }

  let challengeScoreInflight = false;
  async function pushChallengeScore() {
    if (mode !== 'challenge' || !activeChallenge) return;
    if (challengeScoreInflight) return;  // one in-flight at a time — drop the older heartbeat
    challengeScoreInflight = true;
    try {
      const res = await fetch(API_BASE + '/api/challenges/' + encodeURIComponent(activeChallenge.slug) + '/score', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: deviceId,
          score: score | 0,
          tier: highestTier | 0,
          drops: activeChallenge.drops | 0,
          token: deviceToken
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.isWinner && !activeChallenge.isWinner) {
          activeChallenge.isWinner = true;
          activeChallenge.winnerRank = data.winnerRank;
          // Don't pop the modal mid-game — let the result screen handle it.
          // But do show a one-shot toast so the player feels the moment.
          showChallengeWinToast();
        }
      }
    } catch (e) { /* silent — challenge writes are best-effort during play */ }
    challengeScoreInflight = false;
  }

  function showChallengeWinToast() {
    // UX audit 2026-06-02 — crossing the prize threshold is a peak moment;
    // give it gold + a milestone chime + haptic instead of a flat green pill.
    const t = document.createElement('div');
    t.className = 'spectator-toast challenge-win-toast';
    t.textContent = '👑 חצית את הרף — אתה זוכה!';
    document.body.appendChild(t);
    try { if (typeof soundMilestone === 'function') soundMilestone(5); } catch (e) {}
    try { if (typeof buzz === 'function') buzz([40, 30, 60, 30, 90]); } catch (e) {}
    setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 3200);
  }

  async function completeChallengeRun() {
    if (!activeChallenge) return null;
    try {
      const res = await fetch(API_BASE + '/api/challenges/' + encodeURIComponent(activeChallenge.slug) + '/complete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: deviceId,
          score: score | 0,
          tier: highestTier | 0,
          drops: activeChallenge.drops | 0,
          token: deviceToken
        })
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  function challengePrizeChipHtml() {
    if (!activeChallenge) return '';
    return '<div class="challenge-prize-chip">' +
      '<span class="live-mini">LIVE</span>' +
      '🎁 ' + escapeHtml(activeChallenge.prizeText) +
    '</div>';
  }

  function renderChallengeResult(data) {
    const wrap = document.getElementById('grid-wrap');
    if (!wrap || !activeChallenge) return;
    const finalScore  = data && data.finalScore != null ? data.finalScore : score;
    const isWinner    = !!(data && data.isWinner) || activeChallenge.isWinner;
    const winnerRank  = (data && data.winnerRank) || activeChallenge.winnerRank;
    const rank        = data && data.rank;
    const total       = data && data.totalEntries;
    const threshold   = activeChallenge.thresholdScore;
    const slug        = activeChallenge.slug;
    const name        = activeChallenge.name;
    const prizeText   = activeChallenge.prizeText;

    let resultHtml;
    if (isWinner) {
      resultHtml =
        '<div class="over-title" style="color:#1B5E20">🎉 מזל טוב! זכית באתגר</div>' +
        '<div class="over-score">' + (finalScore | 0).toLocaleString() + '</div>' +
        '<div class="over-sub">מקום ' + (winnerRank || 1) + ' באתגר "' + escapeHtml(name) + '"</div>' +
        '<div class="challenge-prize-banner" style="margin-top:14px">' +
          '<div class="label">הפרס שלך</div>' +
          '<div class="prize">🎁 ' + escapeHtml(prizeText) + '</div>' +
        '</div>' +
        '<div class="challenge-warn"><strong>צעד אחרון:</strong> השאר פרטים ליצירת קשר.</div>' +
        '<div class="challenge-claim-form">' +
          '<label class="contest-form-label" for="cr-name">שם מלא</label>' +
          '<input id="cr-name" type="text" autocomplete="name" autocapitalize="words" placeholder="שם מלא" maxlength="80" value="' + escapeHtml(getPlayerName() || '') + '"/>' +
          '<label class="contest-form-label" for="cr-phone">טלפון / WhatsApp</label>' +
          '<input id="cr-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="050-0000000" maxlength="40" />' +
          '<label class="contest-form-label" for="cr-email">אימייל (אופציונלי)</label>' +
          '<input id="cr-email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" placeholder="name@example.com" maxlength="120" />' +
          '<button class="btn" id="cr-submit">שלח לאדמין</button>' +
          '<div class="contest-error" id="cr-err"></div>' +
        '</div>';
    } else {
      const distance = (threshold != null && finalScore < threshold)
        ? '<div class="over-sub" style="margin-top:8px">חסרו לך ' + (threshold - finalScore).toLocaleString() + ' נקודות לפרס</div>'
        : '';
      resultHtml =
        '<div class="over-title">האתגר הסתיים</div>' +
        '<div class="over-score">' + (finalScore | 0).toLocaleString() + '</div>' +
        '<div class="over-sub">' + (rank ? 'מקום ' + rank + ' מתוך ' + total + ' משתתפים' : 'תוצאה נשלחה') + '</div>' +
        distance +
        '<div class="challenge-warn" style="background:#FAFAF6;color:#6F6E68;border-color:#F0EDE3"><strong>זה היה הניסיון היחיד שלך באתגר הזה.</strong> בהצלחה באתגר הבא!</div>';
    }

    wrap.innerHTML =
      '<div class="overlay">' +
        resultHtml +
        '<button class="btn" id="cr-back">חזור לאתגרים</button>' +
        '<button class="btn secondary" id="cr-share">שתף תוצאה</button>' +
      '</div>';

    document.getElementById('cr-back').onclick = function() {
      const slugSaved = slug;
      activeChallenge = null;
      mode = 'practice';
      showChallengeDetail(slugSaved);
    };
    document.getElementById('cr-share').onclick = function() {
      const txt = (isWinner ? 'ניצחתי באתגר BLOOM וזכיתי ב-' + prizeText + '!\n' : 'ניקוד ' + finalScore.toLocaleString() + ' באתגר BLOOM.\n')
        + window.location.origin + window.location.pathname;
      if (navigator.share) navigator.share({ text: txt }).catch(function() {});
      else if (navigator.clipboard) navigator.clipboard.writeText(txt);
    };
    const submitBtn = document.getElementById('cr-submit');
    if (submitBtn) submitBtn.onclick = async function() {
      const nm = document.getElementById('cr-name').value.trim();
      const ph = document.getElementById('cr-phone').value.trim();
      const em = document.getElementById('cr-email').value.trim();
      const err = document.getElementById('cr-err');
      if (!nm) { err.textContent = 'שם הוא חובה'; return; }
      if (!ph && !em) { err.textContent = 'נא להזין טלפון או אימייל'; return; }
      this.disabled = true; this.textContent = 'שולח…';
      try {
        const res = await fetch(API_BASE + '/api/challenges/' + encodeURIComponent(slug) + '/claim', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: deviceId, token: deviceToken, contactName: nm, contactPhone: ph, contactEmail: em })
        });
        const data = await res.json().catch(function() { return {}; });
        if (!res.ok) {
          err.textContent = data.error === 'not_winner_or_already_claimed' ? 'כבר נשלחו פרטים.' : 'שגיאה: ' + (data.error || res.status);
          this.disabled = false; this.textContent = 'שלח לאדמין'; return;
        }
        this.textContent = '✓ נשלח. ייצרו איתך קשר.';
        this.classList.add('secondary');
      } catch (e) {
        err.textContent = 'שגיאת חיבור.';
        this.disabled = false; this.textContent = 'שלח לאדמין';
      }
    };
    // Challenge result is content-tall (banner + score + position + form +
    // share/back buttons); equip the overlay so the bottom buttons are
    // reachable via internal scroll on shorter phones.
    equipOverlay();
    // UX audit 2026-06-02 — winning a real prize is the single highest-emotion
    // event the feature can produce; it previously had ZERO celebration. Fire
    // the full dopamine peak (confetti + milestone chime + victory haptic), to
    // match every other win surface in the game and drive screenshot-shares.
    if (isWinner) {
      try { if (typeof window.__bloomConfetti === 'function') window.__bloomConfetti(60); } catch (e) {}
      setTimeout(function() {
        try { if (typeof soundMilestone === 'function') soundMilestone(7); } catch (e) {}
        try { if (typeof buzz === 'function') buzz([40, 30, 60, 30, 90, 40, 120]); } catch (e) {}
      }, 220);
    }
  }

  // beforeunload — warn if mid-game with meaningful score.
  window.addEventListener('beforeunload', function(e) {
    // Always save state before leaving
    if (mode === 'practice') savePracticeGameState();
    if (mode === 'contest') saveContestGameState();
    // Warn if mid-game
    var hasScore = (score | 0) > 100;
    var midGame = !isGameOver() && hasScore && !document.getElementById('home-screen');
    if (midGame) {
      e.preventDefault();
      var msg = mode === 'challenge' ? 'אתה באמצע אתגר פרס. הניקוד הסופי יהיה הניקוד הנוכחי.'
        : mode === 'contest' ? 'אתה באמצע תחרות. המשחק ישמר.'
        : 'אתה באמצע משחק עם ' + score.toLocaleString() + ' נקודות. בטוח לצאת?';
      e.returnValue = msg;
      return msg;
    }
  });

  // ================================================================
  // LIVE SCORE PUSH (sender side — the player who is currently playing)
  // ================================================================
  // Throttle: at most one POST per LIVE_SCORE_MIN_INTERVAL_MS. If the score
  // hasn't changed since the last successful send, skip entirely.

  function liveSnapshot() {
    return {
      deviceId: deviceId,
      token: deviceToken,
      displayName: getContestDisplayName(activeContestCode) || 'אנונימי',
      liveScore: score | 0,
      tier: highestTier | 0
    };
  }

  function flattenGrid() {
    const flat = new Array(getBoardRows() * getBoardCols());
    for (let r = 0; r < getBoardRows(); r++) {
      for (let c = 0; c < getBoardCols(); c++) flat[r * getBoardCols() + c] = grid[r][c] | 0;
    }
    return flat;
  }

  async function pushLiveScore() {
    if (mode !== 'contest' || !activeContestCode) return;
    liveScoreLastSentAt = Date.now();
    liveScoreLastSentValue = score | 0;
    try {
      const res = await fetch(API_BASE + '/api/contests/' + encodeURIComponent(activeContestCode) + '/live-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(liveSnapshot())
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data && typeof data.hasWatchers === 'boolean') {
        const prev = meHasWatchers;
        meHasWatchers = data.hasWatchers;
        if (typeof data.watcherCount === 'number') meWatcherCount = data.watcherCount | 0;
        else meWatcherCount = meHasWatchers ? Math.max(meWatcherCount, 1) : 0;
        // If we just learned a watcher arrived, push a state frame now so
        // they see the live grid without waiting for the next drop.
        if (!prev && meHasWatchers) pushLiveState();
        renderAudienceBadge();
      }
    } catch (e) {
      // Silent — live score is non-critical.
    }
  }

  function scheduleLiveScorePush() {
    if (mode !== 'contest' || !activeContestCode) return;
    if ((score | 0) === liveScoreLastSentValue) return;
    const elapsed = Date.now() - liveScoreLastSentAt;
    if (elapsed >= LIVE_SCORE_MIN_INTERVAL_MS) {
      if (liveScoreFlushTimer) { clearTimeout(liveScoreFlushTimer); liveScoreFlushTimer = null; }
      pushLiveScore();
      return;
    }
    if (liveScoreFlushTimer) return; // already queued
    liveScoreFlushTimer = setTimeout(function() {
      liveScoreFlushTimer = null;
      pushLiveScore();
    }, LIVE_SCORE_MIN_INTERVAL_MS - elapsed);
  }

  async function pushLiveState() {
    if (mode !== 'contest' || !activeContestCode || !meHasWatchers) return;
    if (!Array.isArray(grid)) return;
    const body = Object.assign({}, liveSnapshot(), {
      nextTier: typeof nextPiece === 'number' ? (nextPiece | 0) : null,
      gridJson: flattenGrid()
    });
    try {
      await fetch(API_BASE + '/api/contests/' + encodeURIComponent(activeContestCode) + '/live-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (e) {
      // Silent.
    }
  }

  // Called by the game-over flow to make sure spectators stop seeing the
  // dead board quickly. Server TTL would handle it within 10s anyway.
  function stopLivePush() {
    if (liveScoreFlushTimer) { clearTimeout(liveScoreFlushTimer); liveScoreFlushTimer = null; }
    liveScoreLastSentValue = -1;
    meHasWatchers = false;
    meWatchers = [];
    meWatcherCount = 0;
    renderAudienceBadge();
  }

  // ================================================================
  // AUDIENCE BADGE (the active player's "👁 N" floating indicator)
  // ================================================================

  function ensureAudienceBadge() {
    let wrap = document.getElementById('grid-wrap');
    if (!wrap) return null;
    let badge = document.getElementById('audience-badge');
    if (!badge) {
      badge = document.createElement('button');
      badge.id = 'audience-badge';
      badge.className = 'audience-badge';
      badge.setAttribute('aria-label', 'הקהל שצופה בך');
      badge.onclick = function(e) {
        e.stopPropagation();
        audienceBadgeOpen = !audienceBadgeOpen;
        renderAudienceBadge();
      };
      wrap.appendChild(badge);
      document.addEventListener('click', function(ev) {
        const list = document.getElementById('audience-list');
        if (!audienceBadgeOpen) return;
        if (list && (list === ev.target || list.contains(ev.target))) return;
        if (badge === ev.target || badge.contains(ev.target)) return;
        audienceBadgeOpen = false;
        renderAudienceBadge();
      });
    }
    return badge;
  }

  function removeAudienceBadge() {
    const badge = document.getElementById('audience-badge');
    if (badge) badge.remove();
    const list = document.getElementById('audience-list');
    if (list) list.remove();
    audienceBadgeOpen = false;
  }

  function renderAudienceBadge() {
    const visible = mode === 'contest'
      && activeContestCode
      && !spectatorSession
      && (meWatchers.length > 0 || meHasWatchers || meWatcherCount > 0);
    if (!visible) { removeAudienceBadge(); return; }
    const badge = ensureAudienceBadge();
    if (!badge) return;
    const count = Math.max(meWatchers.length, meWatcherCount | 0);
    badge.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>' +
      '</svg>' +
      '<span>' + count + '</span>';
    const wrap = document.getElementById('grid-wrap');
    let list = document.getElementById('audience-list');
    if (audienceBadgeOpen && meWatchers.length) {
      if (!list) {
        list = document.createElement('div');
        list.id = 'audience-list';
        list.className = 'audience-list';
        wrap.appendChild(list);
      }
      const rowsHtml = meWatchers.map(function(w) {
        return '<div class="audience-list-row">' +
          '<span class="audience-list-name">' + renderAvatarHtml(w.name, 'sm') + escapeHtml(w.name || 'אנונימי') + '</span>' +
          '<span class="audience-list-score">' + (w.lastScore | 0).toLocaleString() + ' נק׳</span>' +
        '</div>';
      }).join('');
      list.innerHTML = '<div class="audience-list-title">צופים בך · נקודה אחרונה</div>' + rowsHtml;
    } else if (list) {
      list.remove();
    }
  }

  // ================================================================
  // SPECTATOR (viewer side — for a player who chose to watch)
  // ================================================================

  // entryFrom: 'game-over' (default), 'contest-screen', or 'in-game'. Drives
  // where the spectator's "exit" button returns to.
  let pendingSpectatorEntry = 'game-over';
