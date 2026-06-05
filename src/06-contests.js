  function hideContestScreens() {
    stopContestRefresh();
    stopMyContestsRefresh();
    // Live in-game HUD: tear down whenever the player navigates away from
    // the contest game to any non-game screen (leaderboard, home, etc).
    // init('contest') re-mounts it cleanly when they return.
    if (typeof stopContestHud === 'function') stopContestHud();
    const el = document.getElementById('contest-screen');
    if (el) el.remove();
  }

  function createBackButton(action) {
    return '<button class="contest-back-btn" data-back="' + action + '" aria-label="חזור">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>' +
      '</button>';
  }

  // Event delegation for back buttons — replaces inline onclick="window.__bloom*()"
  document.querySelector('.app').addEventListener('click', function(e) {
    const btn = e.target.closest('[data-back]');
    if (!btn) return;
    const action = btn.getAttribute('data-back');
    const handlers = {
      'home': function() { hideContestScreens(); showHome(); },
      'contest-menu': function() { hideContestScreens(); showContestMenu(); },
      'challenges': navigateBackFromChallenges,
      'challenges-list': function() { showChallengesList(); },
      'home-from-challenges': function() { hideChallengeScreens(); showHome(); }
    };
    if (handlers[action]) handlers[action]();
  });

  function showContestMenu() {
    const app = document.querySelector('.app');
    hideContestScreens();
    hideHome();
    const screen = document.createElement('div');
    screen.id = 'contest-screen';
    screen.className = 'contest-screen';
    const continueCard = activeContestCode
      ? '<div class="contest-card contest-card-continue" id="contest-mine-card">' +
          '<div class="contest-card-icon" style="background:#C7EDDE;color:#04342C">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M8 4v6M16 4v6"/></svg>' +
          '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div class="contest-card-title">התחרויות שלי</div>' +
            '<div class="contest-card-desc" id="contest-mine-desc">טוען רשימה…</div>' +
            '<div class="contest-card-sub-meta" id="contest-mine-meta"></div>' +
          '</div>' +
        '</div>'
      : '';
    screen.innerHTML =
      createBackButton('home') +
      '<div class="contest-title">תחרות חברים</div>' +
      '<div class="contest-sub">בחר את התפקיד שלך</div>' +
      '<div class="contest-cards">' +
        continueCard +
        '<div class="contest-card" id="contest-create-card">' +
          '<div class="contest-card-icon" style="background:#FAEEDA;color:#854F0B">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>' +
          '</div>' +
          '<div>' +
            '<div class="contest-card-title">צור תחרות חדשה</div>' +
            '<div class="contest-card-desc">הזמן חברים בוואטסאפ</div>' +
          '</div>' +
        '</div>' +
        '<div class="contest-card" id="contest-join-card">' +
          '<div class="contest-card-icon" style="background:#E1F5EE;color:#04342C">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><circle cx="17" cy="9" r="3"/><path d="M17 14c2 0 4 1 4 4v3"/></svg>' +
          '</div>' +
          '<div>' +
            '<div class="contest-card-title">הצטרף לתחרות</div>' +
            '<div class="contest-card-desc">קיבלת קוד? הכנס כאן</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    app.appendChild(screen);
    document.getElementById('contest-create-card').onclick = showCreateContestForm;
    document.getElementById('contest-join-card').onclick = showJoinContestForm;
    const mineEl = document.getElementById('contest-mine-card');
    if (mineEl) {
      mineEl.onclick = showMyContestsList;
      // Async-fill the card with the count + most recent contest name
      fetchMyContests().then(function(contests) {
        const stillThere = document.getElementById('contest-mine-card');
        if (!stillThere) return;
        const descEl = document.getElementById('contest-mine-desc');
        const metaEl = document.getElementById('contest-mine-meta');
        if (!contests || contests.length === 0) {
          if (descEl) descEl.textContent = 'לחץ כדי לראות את הרשימה';
          if (metaEl) metaEl.textContent = '';
          return;
        }
        const n = contests.length;
        if (descEl) descEl.textContent = n === 1 ? contests[0].name : n + ' תחרויות פעילות';
        if (metaEl && n > 1) metaEl.textContent = 'האחרונה: ' + contests[0].name;
        else if (metaEl) metaEl.textContent = '';
      });
    }
  }

  function renderMyContestsRowsHtml(contests) {
    return contests.map(function(c) {
      const ended = new Date(c.ends_at) < new Date();
      const isActive = activeContestCode === c.code;
      const rankClass = c.my.rank === 1 ? ' rank-1' : '';
      const statusHtml = ended
        ? '<span class="my-contest-status">הסתיים</span>'
        : (isActive ? '<span class="my-contest-status active-tag">פעילה עכשיו</span>'
                    : '<span class="my-contest-status">' + formatTimeLeft(c.ends_at) + '</span>');
      return '<div class="my-contest-row' + (isActive ? ' active' : '') + (ended ? ' ended' : '') +
        '" data-code="' + c.code + '">' +
        '<div class="my-contest-row-top">' +
          '<div class="my-contest-name">' + escapeHtml(c.name) + '</div>' +
          statusHtml +
        '</div>' +
        '<div class="my-contest-meta">' +
          '<span>מארח: ' + escapeHtml(c.host_name || 'אנונימי') + '</span>' +
          '<span class="my-contest-meta-mid">' + (c.member_count | 0) + ' שחקנים</span>' +
          '<span class="my-contest-rank' + rankClass + '">#' + (c.my.rank | 0) + ' · ' + (c.my.score | 0).toLocaleString() + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function bindMyContestsRowClicks(body) {
    if (!body) return;
    body.querySelectorAll('.my-contest-row').forEach(function(row) {
      row.onclick = function() {
        const code = row.getAttribute('data-code');
        if (!code) return;
        setActiveContest(code);
        showContestLeaderboard(code);
      };
    });
  }

  function renderMyContestsBody(contests) {
    const body = document.getElementById('mclb-body');
    const subEl = document.getElementById('mclb-sub');
    if (!body) return;
    if (!contests) {
      body.innerHTML = '<div class="contest-board-empty">שגיאת חיבור</div>';
      if (subEl) subEl.textContent = '';
      return;
    }
    if (contests.length === 0) {
      if (subEl) subEl.textContent = 'עדיין לא הצטרפת לאף תחרות';
      body.innerHTML = '<div class="contest-board-empty">צור תחרות חדשה או הצטרף עם קוד</div>';
      return;
    }
    if (subEl) {
      subEl.innerHTML = '<span class="contest-live-dot"></span>' +
        contests.length + ' תחרויות פעילות';
    }
    body.innerHTML = '<div class="my-contest-list">' + renderMyContestsRowsHtml(contests) + '</div>';
    bindMyContestsRowClicks(body);
  }

  let myContestsRefreshTimer = null;
  function stopMyContestsRefresh() {
    if (myContestsRefreshTimer) { clearInterval(myContestsRefreshTimer); myContestsRefreshTimer = null; }
  }
  function startMyContestsRefresh() {
    stopMyContestsRefresh();
    myContestsRefreshTimer = setInterval(async function() {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (!document.getElementById('mclb-body')) { stopMyContestsRefresh(); return; }
      const contests = await fetchMyContests({ fresh: true });
      if (!document.getElementById('mclb-body')) return;
      renderMyContestsBody(contests);
    }, 30000);
  }

  async function showMyContestsList() {
    let screen = document.getElementById('contest-screen');
    if (!screen) {
      const app = document.querySelector('.app');
      hideHome();
      screen = document.createElement('div');
      screen.id = 'contest-screen';
      screen.className = 'contest-screen';
      app.appendChild(screen);
    }
    screen.innerHTML =
      createBackButton('contest-menu') +
      '<div class="contest-title">התחרויות שלי</div>' +
      '<div class="contest-sub" id="mclb-sub">טוען…</div>' +
      '<div id="mclb-body"><div class="contest-loading">טוען…</div></div>';

    const contests = await fetchMyContests();
    renderMyContestsBody(contests);
    if (contests && contests.length > 0) startMyContestsRefresh();
  }

  function showCreateContestForm() {
    const screen = document.getElementById('contest-screen');
    if (!screen) return;
    screen.innerHTML =
      createBackButton('contest-menu') +
      '<div class="contest-title">תחרות חדשה</div>' +
      '<div class="contest-sub">פרטים בסיסיים בלבד</div>' +
      '<div class="contest-form">' +
        '<div class="contest-form-label">שם התחרות</div>' +
        '<input class="contest-input" id="ctf-name" placeholder="משפחת כהן · פסח" maxlength="100" />' +
        '<div class="contest-form-label">השם שלך בלוח</div>' +
        '<input class="contest-input" id="ctf-host" autocapitalize="words" placeholder="סבא משה" maxlength="50" value="' + escapeHtml(getPlayerName()) + '" />' +
        // UX audit 2026-06-02 — progressive disclosure: name + host are the only
        // fields most hosts touch; duration/board/difficulty/score-mode/wager
        // keep their (already-selected) defaults behind an expander so the core
        // "invite family" flow is name + one button.
        '<button type="button" class="contest-advanced-toggle" id="ctf-advanced-toggle">⚙️ אפשרויות מתקדמות</button>' +
        '<div id="ctf-advanced" style="display:none">' +
        '<div class="contest-form-label">משך התחרות</div>' +
        '<div class="contest-duration-row" id="ctf-duration">' +
          '<div class="contest-duration-pill" data-days="1">יום</div>' +
          '<div class="contest-duration-pill selected" data-days="7">שבוע</div>' +
          '<div class="contest-duration-pill" data-days="30">חודש</div>' +
        '</div>' +
        '<div class="contest-form-label">סוג הלוח</div>' +
        '<div class="contest-duration-row" id="ctf-board-type">' +
          '<div class="contest-duration-pill selected" data-board="shared">משותף</div>' +
          '<div class="contest-duration-pill" data-board="free">חופשי</div>' +
        '</div>' +
        '<div class="contest-form-hint" id="ctf-board-hint">כולם מקבלים את אותו לוח — השוואה הוגנת</div>' +
        '<div class="contest-form-label">💪 רמת קושי <span style="color:#A8A6A0;font-weight:400">(לכל המשתתפים)</span></div>' +
        '<div class="contest-duration-row" id="ctf-difficulty" style="flex-wrap:wrap">' +
          '<div class="contest-duration-pill selected" data-diff="default">📦 רגיל</div>' +
          '<div class="contest-duration-pill" data-diff="easy">😊 קל</div>' +
          '<div class="contest-duration-pill" data-diff="medium">🎯 בינוני</div>' +
          '<div class="contest-duration-pill" data-diff="hard">🔥 קשה</div>' +
          '<div class="contest-duration-pill" data-diff="insane">💀 גהינום</div>' +
        '</div>' +
        '<div class="contest-form-hint" id="ctf-difficulty-hint">המארגן בוחר רמה אחת לכולם — כך התחרות הוגנת</div>' +
        '<div class="contest-form-label">🏆 איך סופרים נקודות?</div>' +
        '<div class="contest-duration-row" id="ctf-score-mode">' +
          '<div class="contest-duration-pill selected" data-mode="cumulative">🧮 מצטבר</div>' +
          '<div class="contest-duration-pill" data-mode="best">🏆 הכי גבוה</div>' +
        '</div>' +
        '<div class="contest-form-hint" id="ctf-mode-hint">כל המשחקים מצטרפים לסכום אחד — שחק הרבה כדי לטפס</div>' +
        '<div class="contest-form-label">🎰 הימור (אופציונלי)</div>' +
        '<div style="display:flex;align-items:center;gap:8px;direction:rtl;margin-bottom:4px">' +
          '<input type="number" class="contest-input" id="ctf-wager" placeholder="0" min="0" max="500" value="0" style="width:80px;text-align:center;font-weight:700" />' +
          '<span style="font-size:12px;color:#6F6E68">💎 כל משתתף · קופה מחולקת לזוכים</span>' +
        '</div>' +
        '<div style="font-size:11px;color:#A8A6A0;direction:rtl;margin-bottom:8px">היתרה שלך: <strong style="color:#BA7517">' + playerBalance + ' 💎</strong> · מינימום הימור: 10 · 0 = ללא הימור</div>' +
        '</div>' +  // end #ctf-advanced
        '<button class="contest-submit-btn" id="ctf-submit">צור והעתק קוד</button>' +
        '<div class="contest-error" id="ctf-error"></div>' +
      '</div>';

    let selectedDays = 7;
    let selectedBoardType = 'shared';
    let selectedDifficulty = 'default';
    let selectedScoreMode = 'cumulative';
    const MODE_HINTS = {
      cumulative: 'כל המשחקים מצטרפים לסכום אחד — שחק הרבה כדי לטפס',
      best:       'רק המשחק הכי טוב נספר — איכות מנצחת כמות'
    };
    const DIFF_HINTS = {
      default: 'המארגן בוחר רמה אחת לכולם — כך התחרות הוגנת',
      easy:    '😊 קל · אריחים נמוכים שולטים — נעים לחימום',
      medium:  '🎯 בינוני · יותר אריחים גבוהים, פחות מקום לטעויות',
      hard:    '🔥 קשה · בעיקר tier 3-5 נופלים — ניקוד גבוה אבל game-over מהיר',
      insane:  '💀 גהינום · אבן/עלה לא נופלים בכלל — לרוצחים סדרתיים בלבד'
    };
    var advToggle = document.getElementById('ctf-advanced-toggle');
    var advBox = document.getElementById('ctf-advanced');
    if (advToggle && advBox) advToggle.onclick = function() {
      var isOpen = advBox.style.display !== 'none';
      advBox.style.display = isOpen ? 'none' : '';
      advToggle.textContent = isOpen ? '⚙️ אפשרויות מתקדמות' : '▲ הסתר אפשרויות מתקדמות';
      advToggle.classList.toggle('open', !isOpen);
    };
    document.querySelectorAll('#ctf-duration .contest-duration-pill').forEach(function(pill) {
      pill.onclick = function() {
        document.querySelectorAll('#ctf-duration .contest-duration-pill').forEach(function(p) { p.classList.remove('selected'); });
        pill.classList.add('selected');
        selectedDays = parseInt(pill.dataset.days, 10);
      };
    });
    document.querySelectorAll('#ctf-board-type .contest-duration-pill').forEach(function(pill) {
      pill.onclick = function() {
        document.querySelectorAll('#ctf-board-type .contest-duration-pill').forEach(function(p) { p.classList.remove('selected'); });
        pill.classList.add('selected');
        selectedBoardType = pill.dataset.board;
        const hint = document.getElementById('ctf-board-hint');
        if (hint) hint.textContent = selectedBoardType === 'free'
          ? 'לוח אקראי לכל שחקן — תחרות ניקוד טהורה'
          : 'כולם מקבלים את אותו לוח — השוואה הוגנת';
      };
    });
    document.querySelectorAll('#ctf-difficulty .contest-duration-pill').forEach(function(pill) {
      pill.onclick = function() {
        document.querySelectorAll('#ctf-difficulty .contest-duration-pill').forEach(function(p) { p.classList.remove('selected'); });
        pill.classList.add('selected');
        selectedDifficulty = pill.dataset.diff;
        const hint = document.getElementById('ctf-difficulty-hint');
        if (hint) hint.textContent = DIFF_HINTS[selectedDifficulty] || DIFF_HINTS.default;
      };
    });
    document.querySelectorAll('#ctf-score-mode .contest-duration-pill').forEach(function(pill) {
      pill.onclick = function() {
        document.querySelectorAll('#ctf-score-mode .contest-duration-pill').forEach(function(p) { p.classList.remove('selected'); });
        pill.classList.add('selected');
        selectedScoreMode = pill.dataset.mode;
        const hint = document.getElementById('ctf-mode-hint');
        if (hint) hint.textContent = MODE_HINTS[selectedScoreMode] || MODE_HINTS.cumulative;
      };
    });

    document.getElementById('ctf-submit').onclick = async function() {
      const nameVal = document.getElementById('ctf-name').value.trim();
      const hostVal = document.getElementById('ctf-host').value.trim();
      const errEl = document.getElementById('ctf-error');
      errEl.textContent = '';
      if (!nameVal) { errEl.textContent = 'נא לתת שם לתחרות'; return; }
      if (!hostVal) { errEl.textContent = 'נא להזין שם תצוגה'; return; }

      const wagerVal = parseInt(document.getElementById('ctf-wager').value, 10) || 0;

      // Client-side balance check BEFORE sending
      if (wagerVal > 0 && playerBalance < wagerVal) {
        errEl.textContent = '💎 אין מספיק קרדיטים (' + playerBalance + '). צריך ' + wagerVal + ' 💎';
        return;
      }

      this.disabled = true;
      this.textContent = 'יוצר...';

      try {
        const res = await fetch(API_BASE + '/api/contests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: nameVal,
            hostName: hostVal,
            deviceId: deviceId,
            token: deviceToken,
            durationDays: selectedDays,
            boardType: selectedBoardType,
            wagerAmount: wagerVal,
            difficulty: selectedDifficulty,
            scoreMode: selectedScoreMode
          })
        });
        if (res.status === 429) {
          errEl.textContent = 'יצרת יותר מדי תחרויות. נסה שוב בעוד שעה.';
          this.disabled = false;
          this.textContent = 'צור והעתק קוד';
          return;
        }
        const data = await res.json();
        if (!res.ok || !data.ok) {
          var errorMsg = 'שגיאה ביצירת התחרות';
          if (data.error === 'insufficient_balance') errorMsg = '💎 אין מספיק קרדיטים להימור. יש לך ' + playerBalance + ' 💎';
          else if (data.error === 'bad_name') errorMsg = 'שם התחרות לא תקין';
          else if (data.error === 'bad_device') errorMsg = 'שגיאת מכשיר — רענן את הדף';
          errEl.textContent = errorMsg;
          this.disabled = false;
          this.textContent = 'צור והעתק קוד';
          return;
        }
        // Success — update balance if wager was paid
        if (wagerVal > 0) {
          playerBalance = Math.max(0, playerBalance - wagerVal);
          try { localStorage.setItem(PLAYER_BALANCE_KEY, String(playerBalance)); } catch(e) {}
          updateBalanceDisplay();
        }
        setPlayerName(hostVal);
        setContestDisplayName(data.contest.code, hostVal);
        setActiveContest(data.contest.code);
        showContestShareScreen(data.contest);
      } catch (e) {
        errEl.textContent = 'שגיאת רשת — בדוק חיבור ונסה שוב';
        this.disabled = false;
        this.textContent = 'צור והעתק קוד';
      }
    };
  }

  function showContestShareScreen(contest) {
    const screen = document.getElementById('contest-screen');
    if (!screen) return;
    const link = buildContestShareLink(contest.code);
    const shareText = (contest.host_name || 'מישהו') + ' הזמין/ה אותך לתחרות BLOOM 🎮\n' +
      'כל המשפחה משחקת — מי יביא את הציון הכי גבוה?\n' + link;

    screen.innerHTML =
      createBackButton('contest-menu') +
      '<div class="contest-title">התחרות מוכנה!</div>' +
      '<div class="contest-sub">שתף את הקוד עם המשפחה</div>' +
      '<div class="contest-link-card">' +
        '<div class="contest-link-label">קוד התחרות</div>' +
        '<div class="contest-link-code">' + contest.code + '</div>' +
      '</div>' +
      '<div class="contest-share-row">' +
        '<button class="contest-share-btn contest-share-wa" id="ctsh-wa">' +
          '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.05 4.91A9.8 9.8 0 0 0 12.03 2c-5.45 0-9.89 4.43-9.89 9.88 0 1.74.45 3.44 1.31 4.94L2 22l5.31-1.39c1.45.79 3.08 1.21 4.71 1.21h.01c5.45 0 9.89-4.43 9.89-9.88 0-2.64-1.03-5.12-2.9-6.99l.03-.04zM12.04 20.15c-1.46 0-2.89-.39-4.13-1.13l-.3-.18-3.06.8.82-2.99-.2-.31c-.81-1.29-1.24-2.79-1.24-4.33 0-4.5 3.66-8.16 8.17-8.16 2.18 0 4.23.85 5.77 2.39 1.54 1.54 2.39 3.59 2.39 5.77 0 4.5-3.66 8.16-8.16 8.16l-.06-.02zm4.48-6.13c-.25-.12-1.45-.71-1.67-.8-.22-.08-.39-.12-.55.12-.17.25-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.12-1.03-.38-1.95-1.21-.72-.65-1.21-1.45-1.36-1.69-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.12-.14.17-.25.25-.41.08-.16.04-.31-.02-.43-.06-.12-.55-1.34-.76-1.84-.2-.48-.4-.42-.55-.43-.14 0-.31-.02-.46-.02s-.41.06-.62.31c-.21.25-.81.79-.81 1.93 0 1.13.83 2.23.95 2.39.12.16 1.62 2.49 3.93 3.48.55.24 1 .39 1.34.49.56.18 1.07.15 1.48.09.45-.07 1.45-.59 1.66-1.16.21-.58.21-1.07.14-1.16-.06-.11-.22-.18-.46-.31l-.02-.02z"/></svg>' +
          '<span>וואטסאפ</span>' +
        '</button>' +
        '<button class="contest-share-btn contest-share-copy" id="ctsh-copy">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
          '<span id="ctsh-copy-label">העתק קישור</span>' +
        '</button>' +
      '</div>' +
      '<div class="contest-form" style="margin-top:14px">' +
        '<button class="contest-submit-btn" id="ctsh-leaderboard">לוח התחרות</button>' +
        '<button class="contest-secondary-btn" id="ctsh-play">שחק עכשיו</button>' +
      '</div>';

    document.getElementById('ctsh-wa').onclick = function() {
      // Some mobile browsers (Safari especially) block window.open if it isn't a
      // direct user gesture — fall back to copying the LINK (not the long share
      // text, which pastes as a wall of words). The link is what the friend
      // actually needs to join. (audit fix May 2026)
      const w = window.open('https://wa.me/?text=' + encodeURIComponent(shareText), '_blank');
      if (!w) {
        let copied = false;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(link).catch(function() {});
            copied = true;
          }
        } catch (e) {}
        if (!copied) {
          try {
            const ta = document.createElement('textarea');
            ta.value = link; ta.setAttribute('readonly', '');
            ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
            document.body.appendChild(ta); ta.select();
            copied = document.execCommand('copy');
            document.body.removeChild(ta);
          } catch (e) {}
        }
        const wa = document.getElementById('ctsh-wa');
        const span = wa.querySelector('span');
        if (span) {
          const orig = span.textContent;
          span.textContent = copied ? '✓ הקישור הועתק — הדבק בוואטסאפ' : '↗ פתח וואטסאפ ושתף';
          setTimeout(function() { span.textContent = orig; }, 2000);
        }
      }
    };
    document.getElementById('ctsh-copy').onclick = function() {
      const lbl = document.getElementById('ctsh-copy-label');
      const orig = lbl.textContent;
      const flash = function() {
        lbl.textContent = '✓ הועתק';
        setTimeout(function() { lbl.textContent = orig; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(flash, flash);
      } else {
        flash();
      }
    };
    document.getElementById('ctsh-leaderboard').onclick = function() {
      showContestLeaderboard(contest.code);
    };
    document.getElementById('ctsh-play').onclick = function() {
      // Defensive: re-set the active code in case any earlier screen drifted it
      // (the new contest was set as active at creation time, but this guarantees
      // correctness even if state was perturbed by a fast user).
      setActiveContest(contest.code);
      hideContestScreens();
      init('contest', { fresh: true });
    };
  }

  function showJoinContestForm() {
    const screen = document.getElementById('contest-screen');
    if (!screen) return;
    screen.innerHTML =
      createBackButton('contest-menu') +
      '<div class="contest-title">הצטרף לתחרות</div>' +
      '<div class="contest-sub">הכנס את הקוד שקיבלת</div>' +
      '<div class="contest-form">' +
        '<div class="contest-form-label">קוד התחרות (6 תווים)</div>' +
        '<input class="contest-input" id="cjf-code" placeholder="ABC123" maxlength="8" style="text-transform:uppercase;letter-spacing:0.25em;font-size:20px;text-align:center;font-weight:700" />' +
        '<button class="contest-submit-btn" id="cjf-submit" style="margin-top:8px">חפש תחרות</button>' +
        '<div class="contest-error" id="cjf-error"></div>' +
      '</div>';

    document.getElementById('cjf-submit').onclick = function() {
      const code = document.getElementById('cjf-code').value.trim().toUpperCase();
      if (!code) {
        document.getElementById('cjf-error').textContent = 'נא להזין קוד';
        return;
      }
      showContestPreview(code);
    };
  }

  async function showContestPreview(code) {
    let screen = document.getElementById('contest-screen');
    if (!screen) {
      const app = document.querySelector('.app');
      hideHome();
      screen = document.createElement('div');
      screen.id = 'contest-screen';
      screen.className = 'contest-screen';
      app.appendChild(screen);
    }
    screen.innerHTML = '<div class="contest-loading">טוען תחרות...</div>';
    const data = await fetchContest(code);
    if (!data) {
      screen.innerHTML =
        createBackButton('contest-menu') +
        '<div class="contest-title" style="margin-top:60px">תחרות לא נמצאה</div>' +
        '<div class="contest-sub">בדוק את הקוד ונסה שוב</div>';
      return;
    }
    // If the player is already a member, skip the join form
    const alreadyMember = (data.players || []).some(function(p) { return p.you; });
    if (alreadyMember) {
      setActiveContest(code);
      showContestLeaderboard(code);
      return;
    }
    const ended = new Date(data.contest.ends_at) < new Date();
    const topScore = data.players.length ? data.players[0].score : 0;

    screen.innerHTML =
      createBackButton('contest-menu') +
      '<div class="contest-title">' + data.contest.name + '</div>' +
      '<div class="contest-sub">' + (ended ? 'התחרות הסתיימה' : (data.contest.host_device_id === deviceId ? 'התחרות שיצרת' : 'הוזמנת על ידי ' + escapeHtml(data.contest.host_name))) + '</div>' +
      '<div class="contest-info-card">' +
        '<div class="contest-info-row"><span>שחקנים</span><span>' + data.players.length + '</span></div>' +
        '<div class="contest-info-row"><span>ציון מוביל</span><span>' + topScore.toLocaleString() + '</span></div>' +
        '<div class="contest-info-row"><span>זמן שנותר</span><span>' + formatTimeLeft(data.contest.ends_at) + '</span></div>' +
      '</div>' +
      '<div class="contest-form">' +
        '<div class="contest-form-label">השם שלך בלוח</div>' +
        '<input class="contest-input" id="cjp-name" autocapitalize="words" placeholder="הנכד דניאל" maxlength="50" value="' + escapeHtml(getContestDisplayName(code)) + '" />' +
        '<button class="contest-submit-btn" id="cjp-join" ' + (ended ? 'disabled' : '') + '>' + (ended ? 'התחרות הסתיימה' : 'הצטרף ושחק') + '</button>' +
        '<div class="contest-error" id="cjp-error"></div>' +
      '</div>';

    if (!ended) {
      document.getElementById('cjp-join').onclick = async function() {
        const nameVal = document.getElementById('cjp-name').value.trim();
        if (!nameVal) {
          document.getElementById('cjp-error').textContent = 'נא להזין שם';
          return;
        }
        this.disabled = true;
        this.textContent = 'מצטרף...';
        try {
          const res = await fetch(API_BASE + '/api/contests/' + encodeURIComponent(code) + '/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId: deviceId, token: deviceToken, displayName: nameVal })
          });
          if (res.status === 429) {
            document.getElementById('cjp-error').textContent = 'יותר מדי ניסיונות. נסה שוב בעוד שעה.';
            this.disabled = false;
            this.textContent = 'הצטרף ושחק';
            return;
          }
          if (res.status === 409) {
            document.getElementById('cjp-error').textContent = 'השם תפוס. בחר שם אחר.';
            this.disabled = false;
            this.textContent = 'הצטרף ושחק';
            return;
          }
          if (!res.ok) {
            var errData = {};
            try { errData = await res.json(); } catch(e) {}
            var errMsg = 'שגיאה. נסה שוב.';
            if (errData.error === 'insufficient_balance') errMsg = '💎 אין מספיק קרדיטים להימור. צריך ' + (errData.wagerRequired || '?') + ' 💎, יש לך ' + playerBalance;
            else if (errData.error === 'ended') errMsg = 'התחרות הסתיימה';
            else if (errData.error === 'not_found') errMsg = 'תחרות לא נמצאה';
            document.getElementById('cjp-error').textContent = errMsg;
            this.disabled = false;
            this.textContent = 'הצטרף ושחק';
            return;
          }
          // Update balance if wager was paid
          fetchPlayerCode(); // refresh balance from server
          setPlayerName(nameVal);
          setContestDisplayName(code, nameVal);
          setActiveContest(code);
          trackEvent('contest_join', { code: code });
          hideContestScreens();
          init('contest');
        } catch (e) {
          document.getElementById('cjp-error').textContent = 'שגיאה. נסה שוב.';
          this.disabled = false;
          this.textContent = 'הצטרף ושחק';
        }
      };
    }
  }

  // Module-level state for the smart-board UX. Reset whenever the contest
  // screen is unmounted (via stopContestRefresh -> teardown is implicit).
  var contestBoardExpanded = false;
  var contestBoardSearchTerm = '';

  // displayScore: server already ranks by score+liveScore, but the row
  // numbers should match — so add the live delta into the displayed total.
  function contestDisplayScore(p) {
    return (p.score | 0) + (p.liveScore == null ? 0 : (p.liveScore | 0));
  }

  // Render a (sub)set of player rows. The full ordered list is used for:
  //   - leader-relative delta (so a slice in the middle still shows
  //     "−12,420" to the top player, not to the slice-top)
  //   - "next target" lookup for the player above ME, even when MY row
  //     happens to be at the slice's top edge
  // startIdx = rank offset for this slice (1-indexed rank = startIdx + i + 1).
  function renderContestBoardRows(players, allPlayers, startIdx) {
    if (!players || players.length === 0) {
      return '<div class="contest-board-empty">אין עדיין שחקנים</div>';
    }
    var all = allPlayers || players;
    var base = startIdx | 0;
    var topScore = contestDisplayScore(all[0]);
    return players.map(function(p, sliceI) {
      var i = base + sliceI;
      var rank = i + 1;
      // Top-3 podium tinting (gold/silver/bronze) — visual status for the
      // top of every contest, regardless of how many players are below.
      var podiumCls = '';
      if (i === 0) podiumCls = ' first podium-gold';
      else if (i === 1) podiumCls = ' podium-silver';
      else if (i === 2) podiumCls = ' podium-bronze';
      const cls = 'contest-board-row' + podiumCls + (p.you ? ' me' : '');
      const youBadge = p.you ? ' <small>(אתה)</small>' : '';
      const games = p.games | 0;
      const tierIdx = (p.liveTier != null && p.liveTier > 0) ? (p.liveTier | 0) : (p.tier | 0);
      const last = formatRelativeTime(p.last);
      const watching = Array.isArray(p.watchers) ? p.watchers.length : 0;
      const watchBadge = watching > 0
        ? '<span class="contest-board-watch" title="צופים עכשיו"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>' + watching + '</span>'
        : '';
      let metaLine;
      if (games === 0 && p.liveScore == null) {
        metaLine = '<div class="contest-board-meta">' + (p.you ? 'טרם שיחקת בתחרות' : 'טרם שיחק') + '</div>';
      } else {
        const parts = [];
        if (games > 0) parts.push(games + (games === 1 ? ' משחק' : ' משחקים'));
        if (getActiveTiers()[tierIdx] && tierIdx > 0) parts.push('עד ' + getActiveTiers()[tierIdx].name);
        if (p.liveScore == null && last) parts.push(last);
        metaLine = '<div class="contest-board-meta">' + parts.join(' · ') + '</div>';
      }
      const total = contestDisplayScore(p);
      const delta = (i === 0) ? 0 : topScore - total;
      const deltaLine = delta > 0
        ? '<div class="contest-board-delta">−' + delta.toLocaleString() + '</div>'
        : '';
      const livePill = (p.liveScore != null)
        ? '<div class="contest-board-live">+' + (p.liveScore | 0).toLocaleString() + '<span style="font-weight:600;margin-right:2px;">חי</span></div>'
        : '';
      const tierObj = getActiveTiers()[tierIdx];
      const tierBadge = ((games > 0 || p.liveScore != null) && tierObj && tierIdx > 0)
        ? '<div class="contest-board-tier" style="background:' + tierObj.bg + ';color:' + tierObj.fg + '" title="' + escapeHtml(tierObj.name) + '">' + tierObj.svg + '</div>'
        : '<div class="contest-board-tier contest-board-tier-empty">·</div>';
      // Mark this row clickable-to-spectate only if it's another player who's
      // currently live. The delegated handler in `showContestLeaderboard`
      // dispatches on this data attribute.
      const spectatable = !p.you && p.liveScore != null && p.deviceId;
      const rowAttrs = spectatable
        ? ' role="button" tabindex="0" data-spectate-target="' + escapeHtml(p.deviceId) + '" data-spectate-name="' + escapeHtml(p.name || '') + '"'
        : '';
      const spectatableCls = spectatable ? ' spectatable' : '';
      const spectateHint = spectatable
        ? '<div class="contest-spectate-hint" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>צפה</div>'
        : '';
      // Rank badge — top-3 get the medal glyph in place of the number.
      var rankBadge = (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank);
      const avatarHtml = renderAvatarHtml(p.deviceId || p.name, 'sm');
      var rowHtml = '<div class="' + cls + spectatableCls + '"' + rowAttrs + '>' +
        '<div class="contest-board-rank">' + rankBadge + '</div>' +
        tierBadge +
        '<div class="contest-board-name-col">' +
          '<div class="contest-board-name">' + watchBadge + avatarHtml + escapeHtml(p.name || 'אנונימי') + youBadge + '</div>' +
          metaLine +
        '</div>' +
        '<div class="contest-board-score-col">' +
          '<div class="contest-board-score">' + total.toLocaleString() + '</div>' +
          livePill +
          spectateHint +
          deltaLine +
        '</div>' +
      '</div>';
      // "Next target" pill — attached to MY row when there's someone
      // directly above me. The single most-addictive contest moment is
      // "you need just N more to overtake X" — surface it persistently
      // instead of waiting for the overtake-alert poll to fire.
      if (p.you && i > 0) {
        var above = all[i - 1];
        if (above) {
          var gap = contestDisplayScore(above) - total;
          if (gap > 0) {
            rowHtml += '<div class="contest-next-target">' +
              '<span class="contest-next-target-arrow">⚔️</span>' +
              '<span>עוד <strong>' + gap.toLocaleString() + '</strong> כדי לעקוף את <strong>' + escapeHtml(above.name || 'אנונימי') + '</strong></span>' +
            '</div>';
          }
        }
      }
      return rowHtml;
    }).join('');
  }

  // Smart contest board — keeps the flat layout for small contests and
  // switches to a "top 5 + you ± neighbors" compact view (with optional
  // expand-all + search) once the participant count makes the flat list
  // feel like a scroll-wall. Single entry point for showContestLeaderboard
  // + refreshContestBoardSilently so both stay in sync.
  function renderContestSmartBoard(players) {
    if (!players || players.length === 0) {
      return '<div class="contest-board-empty">אין עדיין שחקנים</div>';
    }
    var total = players.length;
    var SMART_THRESHOLD = 12;   // below this we render flat (no benefit from sectioning)
    var SEARCH_THRESHOLD = 20;  // search input only kicks in for genuinely long lists

    // Find ME in the list
    var myIdx = -1;
    for (var k = 0; k < players.length; k++) {
      if (players[k].you) { myIdx = k; break; }
    }

    // Flat list path — small contests OR user explicitly expanded
    if (total <= SMART_THRESHOLD || contestBoardExpanded) {
      var controlsHtml = '';
      var filtered = players;
      if (contestBoardExpanded && total > SMART_THRESHOLD) {
        if (total >= SEARCH_THRESHOLD) {
          controlsHtml +=
            '<div class="contest-board-search-wrap">' +
              '<input type="text" class="contest-board-search" id="clb-search" placeholder="חיפוש לפי שם…" value="' + escapeHtml(contestBoardSearchTerm) + '" autocomplete="off">' +
            '</div>';
        }
        controlsHtml +=
          '<button type="button" class="contest-board-collapse-btn" id="clb-collapse">' +
            '⌃ חזרה לתצוגה קומפקטית' +
          '</button>';
        var q = (contestBoardSearchTerm || '').trim().toLowerCase();
        if (q) {
          filtered = players.filter(function(p) {
            return (p.name || '').toLowerCase().indexOf(q) >= 0;
          });
        }
      }
      // When filtering, we still want rank numbers to reflect actual
      // contest position — pass startIdx=0 + the full ordered list so
      // ranks aren't compressed by the filter.
      var rowsHtml;
      if (filtered.length === 0) {
        rowsHtml = '<div class="contest-board-empty">לא נמצאו שחקנים מתאימים</div>';
      } else if (filtered === players) {
        rowsHtml = renderContestBoardRows(players, players, 0);
      } else {
        // Filtered list: render each row with its true rank (re-map by indexOf in players).
        // Cheap because filter is rare and player counts are bounded by contest size.
        var indexed = filtered.map(function(p) { return { p: p, i: players.indexOf(p) }; });
        rowsHtml = indexed.map(function(entry) {
          return renderContestBoardRows([entry.p], players, entry.i);
        }).join('');
      }
      return controlsHtml + rowsHtml;
    }

    // Smart compact path: top-5 + (optional) my-window + expand button
    var TOP_N = 5;
    var WINDOW = 2;
    var html = '';

    // TOP section — always
    html += '<div class="contest-board-section-label">🏆 המובילים</div>';
    html += renderContestBoardRows(players.slice(0, TOP_N), players, 0);

    // MY window — only if I'm beyond top-N
    if (myIdx >= TOP_N) {
      var fromIdx = Math.max(TOP_N, myIdx - WINDOW);
      var toIdx = Math.min(total, myIdx + WINDOW + 1);
      // Gap indicator if my-window doesn't touch the top section
      if (fromIdx > TOP_N) {
        html += '<div class="contest-board-divider"><span>· · ·</span></div>';
      }
      html += '<div class="contest-board-section-label">📍 המיקום שלך · #' + (myIdx + 1) + ' מתוך ' + total + '</div>';
      html += renderContestBoardRows(players.slice(fromIdx, toIdx), players, fromIdx);
      if (toIdx < total) {
        html += '<div class="contest-board-divider"><span>· · ·</span></div>';
      }
    } else if (myIdx === -1 && total > TOP_N) {
      // Not playing yet but the contest is big — give a hint
      html += '<div class="contest-board-divider"><span>· · ·</span></div>';
      html += '<div class="contest-board-section-label">📍 הצטרף כדי לראות את המיקום שלך</div>';
    }

    // Expand-all CTA
    html += '<button type="button" class="contest-board-expand-btn" id="clb-expand">' +
      'הצג את כל ' + total + ' השחקנים' +
    '</button>';

    return html;
  }

  // Wire expand/collapse/search controls inside the contest board. Called
  // after every board render (initial mount + silent refresh) so handlers
  // stay attached to the freshly-rebuilt DOM.
  function wireContestBoardControls(boardEl, players) {
    if (!boardEl) return;
    var expandBtn = boardEl.querySelector('#clb-expand');
    if (expandBtn) expandBtn.onclick = function() {
      contestBoardExpanded = true;
      contestBoardSearchTerm = '';
      boardEl.innerHTML = renderContestSmartBoard(players);
      wireContestBoardControls(boardEl, players);
      // Scroll my row into view so the expanded list lands centered on me,
      // not on row #1 — the whole reason for expanding is "show me the
      // full picture relative to where I stand."
      var me = boardEl.querySelector('.contest-board-row.me');
      if (me && typeof me.scrollIntoView === 'function') {
        try { me.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(e) {}
      }
    };
    var collapseBtn = boardEl.querySelector('#clb-collapse');
    if (collapseBtn) collapseBtn.onclick = function() {
      contestBoardExpanded = false;
      contestBoardSearchTerm = '';
      boardEl.innerHTML = renderContestSmartBoard(players);
      wireContestBoardControls(boardEl, players);
    };
    var searchEl = boardEl.querySelector('#clb-search');
    if (searchEl) {
      // Debounce so every keystroke doesn't trigger a full re-render
      // (which would also drop the focus we just restored).
      var searchTimer = null;
      searchEl.oninput = function() {
        var val = searchEl.value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function() {
          contestBoardSearchTerm = val;
          var caret = searchEl.selectionStart;
          boardEl.innerHTML = renderContestSmartBoard(players);
          wireContestBoardControls(boardEl, players);
          var refocus = boardEl.querySelector('#clb-search');
          if (refocus) {
            refocus.focus();
            if (caret != null) try { refocus.setSelectionRange(caret, caret); } catch(e) {}
          }
        }, 140);
      };
    }
  }

  function stopContestRefresh() {
    if (contestRefreshTimer) { clearInterval(contestRefreshTimer); contestRefreshTimer = null; }
    contestRefreshCode = null;
  }

  async function refreshContestBoardSilently() {
    if (!contestRefreshCode) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    const data = await fetchContest(contestRefreshCode);
    if (!data) return;
    updateMyWatchersFromContestData(data);
    const screen = document.getElementById('contest-screen');
    if (!screen) return;
    const boardEl = screen.querySelector('.contest-board');
    if (boardEl) {
      // Preserve focus + caret position on the search input across silent
      // refreshes — otherwise typing eats keystrokes every 20s.
      var oldSearch = boardEl.querySelector('#clb-search');
      var hadFocus = oldSearch && document.activeElement === oldSearch;
      var caret = hadFocus ? oldSearch.selectionStart : null;
      boardEl.innerHTML = renderContestSmartBoard(data.players || []);
      wireContestBoardControls(boardEl, data.players || []);
      if (hadFocus) {
        var newSearch = boardEl.querySelector('#clb-search');
        if (newSearch) {
          newSearch.focus();
          if (caret != null) try { newSearch.setSelectionRange(caret, caret); } catch(e) {}
        }
      }
    }
    const subEl = document.getElementById('clb-sub');
    if (subEl) {
      subEl.innerHTML = '<span class="contest-live-dot"></span>' +
        (data.players || []).length + ' שחקנים · ' + formatTimeLeft(data.contest.ends_at);
    }
  }

  function updateMyWatchersFromContestData(data) {
    if (!data || !Array.isArray(data.players)) return;
    const me = data.players.find(function(p) { return p.you; });
    if (!me) return;
    meWatchers = Array.isArray(me.watchers) ? me.watchers : [];
    meHasWatchers = !!me.hasWatchers;
    meWatcherCount = meWatchers.length;
    renderAudienceBadge();
  }

  function startContestRefresh(code) {
    stopContestRefresh();
    contestRefreshCode = code;
    contestRefreshTimer = setInterval(refreshContestBoardSilently, 20000);
  }

  /* ============ OVERTAKE WATCH (toast when someone passes me) ============ */
  // Polls the active contest every 45s. The first poll seeds a baseline
  // silently; subsequent polls compare each opponent's score to the baseline
  // and fire a toast for anyone who crossed above my score since the last
  // check. Names are used as identifiers (the contest endpoint does not
  // expose device_id) — fine for friends groups; rare name collisions just
  // cause one missed toast.
  let overtakeTimer = null;
  let overtakeCode = null;
  let overtakeBaseline = null;          // { myScore, myRank, others: Map(name -> {score, rank}) }
  let overtakeMyLiveScore = 0;          // track local score for comparison

  function snapshotFromContestData(data) {
    const sorted = (data.players || []).slice().sort(function(a, b) { return (b.score | 0) - (a.score | 0); });
    const me = sorted.find(function(p) { return p.you; });
    const myScore = me ? (me.score | 0) : 0;
    const myRank = me ? sorted.indexOf(me) + 1 : 999;
    const others = new Map();
    sorted.forEach(function(p, idx) {
      if (!p.you) others.set(p.name, { score: p.score | 0, rank: idx + 1 });
    });
    return { myScore: myScore, myRank: myRank, others: others, leader: sorted[0] ? sorted[0].name : '' };
  }

  async function refreshOvertake() {
    if (!overtakeCode || !overtakeBaseline) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (mode !== 'contest' || activeContestCode !== overtakeCode) return;
    var data;
    try { data = await fetchContest(overtakeCode); } catch(e) { return; }
    if (!data) return;
    if (!overtakeTimer) return;

    const prev = overtakeBaseline;
    const next = snapshotFromContestData(data);

    // Use local score if higher (we may not have submitted yet)
    var realMyScore = Math.max(next.myScore, score || 0);

    // --- 1. Someone overtook you ---
    var overtakers = [];
    next.others.forEach(function(info, name) {
      var prevInfo = prev.others.get(name);
      var prevScore = prevInfo ? prevInfo.score : 0;
      if (info.score > realMyScore && prevScore <= prev.myScore) {
        overtakers.push({ name: name, score: info.score, rank: info.rank });
      }
    });

    // --- 2. You took back #1 ---
    var youTookFirst = prev.myRank > 1 && next.myRank === 1;

    // --- 3. Someone else took #1 (not you) ---
    var newLeader = null;
    if (next.leader !== prev.leader && next.leader !== '' && next.myRank > 1) {
      var leaderInfo = next.others.get(next.leader);
      if (leaderInfo) newLeader = { name: next.leader, score: leaderInfo.score };
    }

    // --- 4. Gap closing: you're close to overtaking someone ---
    var almostOvertake = null;
    if (next.myRank > 1) {
      // Find player just above me
      var aboveMe = null;
      next.others.forEach(function(info, name) {
        if (info.rank === next.myRank - 1) aboveMe = { name: name, score: info.score };
      });
      if (aboveMe) {
        var gap = aboveMe.score - realMyScore;
        var gapPct = parseFloat(getEventConfig('contest_alert_gap_pct', '0.1')) || 0.1;
        var gapMax = getEventNum('contest_alert_gap_max', 5000);
        if (gap > 0 && gap < realMyScore * gapPct && gap < gapMax) {
          almostOvertake = { name: aboveMe.name, gap: gap };
        }
      }
    }

    overtakeBaseline = next;

    // --- Show notifications (priority order) ---
    if (overtakers.length > 0) {
      overtakers.sort(function(a, b) { return a.rank - b.rank; });
      showContestAlert('overtake', overtakers[0], overtakers.length - 1);
    } else if (youTookFirst) {
      showContestAlert('you_first', null, 0);
    } else if (newLeader) {
      showContestAlert('new_leader', newLeader, 0);
    } else if (almostOvertake) {
      showContestAlert('almost', almostOvertake, 0);
    }
  }

  function startOvertakeWatch(code) {
    stopOvertakeWatch();
    if (!code) return;
    overtakeCode = code;
    // Seed baseline immediately, then poll every 12 seconds
    (async function() {
      try {
        var data = await fetchContest(code);
        if (data) overtakeBaseline = snapshotFromContestData(data);
      } catch(e) {}
      if (overtakeCode) {
        var pollMs = getEventNum('contest_alert_interval', 12) * 1000;
        overtakeTimer = setInterval(refreshOvertake, pollMs);
      }
    })();
  }

  function stopOvertakeWatch() {
    if (overtakeTimer) { clearTimeout(overtakeTimer); clearInterval(overtakeTimer); overtakeTimer = null; }
    overtakeCode = null;
    overtakeBaseline = null;
  }

  // ============================================================
  // CONTEST LIVE HUD — persistent in-game widget
  // ============================================================
  // The duel mode has a live opponent HUD pinned at the top while playing.
  // The contest mode used to have *only* periodic overtake banners — by the
  // time those fire you've already missed multiple opponent score updates,
  // and on a fresh game there's no ambient "where do I stand" signal at
  // all. The contest HUD fixes that: a compact 3-column bar showing my
  // live rank + score in the middle, the player I'm chasing on one side,
  // and the player chasing me on the other. Tap = open the full contest
  // leaderboard. Self-mounts on init('contest'), self-tears-down on game
  // over or mode switch (mirrors the duel HUD lifecycle).
  var _contestHudPoller = null;
  var _contestHudTick = null;
  var _contestHudCode = null;
  var _contestHudLastRank = null;
  // Cache the most-recent /api/contests/:code response so the 400ms tick
  // can re-run the full paint (incl. gap/lead recomputation) without a
  // network round-trip. The old approach updated the score in isolation —
  // displayed "10,546" while the rank+gap calc used accumulated+10,546,
  // so the three HUD numbers were silently from different totals.
  var _contestHudCachedPlayers = null;
  // Cross-call flag: when set, the next showContestLeaderboard mount will
  // route its back button back into the running game (init('contest')
  // restores from the saved state). Consumed once and reset.
  var _contestHudJustOpenedLb = false;

  function startContestHud(code) {
    stopContestHud();
    if (!code) return;
    _contestHudCode = code;
    renderContestHudShell();
    // Fast first paint (no waiting on the slow data poll).
    refreshContestHudData();
    // Data refresh — same cadence as the existing overtake watch (~5s)
    // so we don't double the contest-fetch load. Frequent enough that the
    // HUD reflects opponents' real-time scores between drops.
    _contestHudPoller = setInterval(refreshContestHudData, 5000);
    // My-score tick — reads the local `score` global every 400ms so my
    // own number updates instantly between merges, without waiting on
    // the network round-trip.
    _contestHudTick = setInterval(syncContestHudMyScore, 400);
  }

  function stopContestHud() {
    if (_contestHudPoller) { clearInterval(_contestHudPoller); _contestHudPoller = null; }
    if (_contestHudTick)   { clearInterval(_contestHudTick);   _contestHudTick   = null; }
    var hud = document.getElementById('contest-hud');
    if (hud) hud.remove();
    _contestHudCode = null;
    _contestHudLastRank = null;
    _contestHudCachedPlayers = null;
  }

  function renderContestHudShell() {
    if (document.getElementById('contest-hud')) return;
    var hud = document.createElement('div');
    hud.id = 'contest-hud';
    hud.className = 'contest-hud';
    // Each side shows: name → ABSOLUTE score → small delta line below.
    // The previous "Hadas 4,194" was a delta but read like a score, which
    // led to the user thinking Hadas was gaining points as their own
    // score grew. Now the big number is always the OTHER player's actual
    // total; the delta with ↑/↓ sits underneath as secondary info.
    hud.innerHTML =
      '<div class="contest-hud-side contest-hud-target" id="contest-hud-target">' +
        '<div class="contest-hud-name" id="contest-hud-target-name">—</div>' +
        '<div class="contest-hud-score" id="contest-hud-target-score">--</div>' +
        '<div class="contest-hud-delta" id="contest-hud-target-delta">לעקוף ⚔️</div>' +
      '</div>' +
      '<div class="contest-hud-side contest-hud-me">' +
        '<div class="contest-hud-rank" id="contest-hud-rank">#?</div>' +
        '<div class="contest-hud-score contest-hud-my-score" id="contest-hud-my-score">0</div>' +
        '<div class="contest-hud-label" id="contest-hud-mode-label">אתה</div>' +
      '</div>' +
      '<div class="contest-hud-side contest-hud-chaser" id="contest-hud-chaser">' +
        '<div class="contest-hud-name" id="contest-hud-chaser-name">—</div>' +
        '<div class="contest-hud-score" id="contest-hud-chaser-score">--</div>' +
        '<div class="contest-hud-delta" id="contest-hud-chaser-delta">רודף 👀</div>' +
      '</div>' +
      '<button class="contest-hud-expand" id="contest-hud-expand" aria-label="פתח לוח מובילים" type="button">⤢</button>';
    document.body.appendChild(hud);
    // Tap-to-expand → opens the full leaderboard. Save my current game
    // state first (same as the existing pause/resume flow) so coming
    // back picks up where I left off. The `_contestHudJustOpenedLb`
    // flag tells the leaderboard mount to route its back button back
    // into init('contest') instead of home, so a one-tap return works.
    var expandBtn = document.getElementById('contest-hud-expand');
    if (expandBtn) expandBtn.onclick = function(e) {
      e.stopPropagation();
      try { if (typeof saveContestGameState === 'function') saveContestGameState(); } catch(err) {}
      try { if (typeof stopLivePush === 'function') stopLivePush(); } catch(err) {}
      _contestHudJustOpenedLb = true;
      showContestLeaderboard(_contestHudCode);
    };
  }

  // Tick: re-paint the HUD using the cached players list so the displayed
  // score, rank, and gaps are computed from one consistent set of numbers
  // (the previous split between "tick writes score" and "poll writes rank"
  // produced numbers that came from different totals — the inconsistency
  // the user reported as "המספרים לא אמיתיים").
  function syncContestHudMyScore() {
    if (!_contestHudCachedPlayers) return;
    if (!document.getElementById('contest-hud')) return;
    paintContestHud(_contestHudCachedPlayers);
  }

  function refreshContestHudData() {
    if (!_contestHudCode) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (mode !== 'contest' || activeContestCode !== _contestHudCode) return;
    fetchContest(_contestHudCode).then(function(data) {
      if (!data || !document.getElementById('contest-hud')) return;
      _contestHudCachedPlayers = data.players || [];
      paintContestHud(_contestHudCachedPlayers);
    }).catch(function() {});
  }

  function paintContestHud(players) {
    if (!players.length) return;
    // Score mode resolution: for 'best' contests the projection is
    // max(accumulated_best, this_game) instead of accumulated + this_game.
    // The mode is on activeContestData (which init('contest') populates
    // before we ever mount the HUD).
    var bestMode = activeContestData && activeContestData.score_mode === 'best';
    var myLiveScore = (typeof score === 'number' ? score : 0) | 0;
    var ranked = players.map(function(p) {
      var total;
      if (p.you) {
        if (bestMode) {
          // For other players, p.score already holds their best so far.
          // For me, take the max of my accumulated best and this game.
          total = Math.max(p.score | 0, myLiveScore);
        } else {
          total = (p.score | 0) + myLiveScore;
        }
      } else {
        var live = p.liveScore == null ? 0 : (p.liveScore | 0);
        if (bestMode) {
          // Their projection = max(their stored best, their live game).
          total = Math.max(p.score | 0, live);
        } else {
          total = (p.score | 0) + live;
        }
      }
      return { p: p, total: total };
    });
    ranked.sort(function(a, b) { return b.total - a.total; });
    var myIdx = -1;
    for (var i = 0; i < ranked.length; i++) {
      if (ranked[i].p.you) { myIdx = i; break; }
    }
    if (myIdx === -1) return; // not a member (shouldn't happen mid-game)
    var myRank = myIdx + 1;
    var total = ranked.length;
    var myTotal = ranked[myIdx].total | 0;
    var target = myIdx > 0 ? ranked[myIdx - 1] : null;       // player above me
    var chaser = myIdx < ranked.length - 1 ? ranked[myIdx + 1] : null; // below me

    // My displayed score = PROJECTED total (accumulated contest score +
    // current in-progress game in cumulative mode; max-of in best mode).
    // Same number drives the rank + the gaps so the three HUD readings
    // never disagree.
    var myScoreEl = document.getElementById('contest-hud-my-score');
    if (myScoreEl) myScoreEl.textContent = myTotal.toLocaleString();
    // Mode label under my score — small but always visible, so the
    // player knows whether they're playing "every game counts" or
    // "best one wins".
    var modeLabelEl = document.getElementById('contest-hud-mode-label');
    if (modeLabelEl) modeLabelEl.textContent = bestMode ? 'אתה · 🏆 הכי גבוה' : 'אתה';

    // Rank
    var rankEl = document.getElementById('contest-hud-rank');
    if (rankEl) {
      rankEl.textContent = '#' + myRank + ' / ' + total;
      // Pulse on rank improvement — small but powerful dopamine hit
      if (_contestHudLastRank != null && myRank < _contestHudLastRank) {
        rankEl.classList.remove('rank-up'); void rankEl.offsetWidth;
        rankEl.classList.add('rank-up');
      } else if (_contestHudLastRank != null && myRank > _contestHudLastRank) {
        rankEl.classList.remove('rank-down'); void rankEl.offsetWidth;
        rankEl.classList.add('rank-down');
      }
      _contestHudLastRank = myRank;
    }

    // Target side (player above me). Big number = their ACTUAL score;
    // small line below = the gap I need to close. This is the layout
    // that broke the "Hadas is gaining points" misreading — the user
    // sees the opponent's real score, not a delta in disguise.
    var tName = document.getElementById('contest-hud-target-name');
    var tScore = document.getElementById('contest-hud-target-score');
    var tDelta = document.getElementById('contest-hud-target-delta');
    var targetWrap = document.getElementById('contest-hud-target');
    if (target) {
      if (tName) tName.textContent = target.p.name || 'אנונימי';
      if (tScore) tScore.textContent = (target.total | 0).toLocaleString();
      var gap = target.total - myTotal;
      if (tDelta) tDelta.textContent = '↑ ' + gap.toLocaleString() + ' לעקוף';
      if (targetWrap) targetWrap.classList.remove('contest-hud-empty');
    } else {
      // I'm #1 — celebrate
      if (tName) tName.textContent = '🏆 ראשון';
      if (tScore) tScore.textContent = '';
      if (tDelta) tDelta.textContent = 'אין מעליך';
      if (targetWrap) targetWrap.classList.add('contest-hud-empty');
    }

    // Chaser side (player below me) — same pattern: their score on top,
    // my lead in the small delta line. The chaser's number stays put as
    // their score grows on their own merges; my LEAD over them changes
    // as I score — and the lead label says exactly that.
    var cName = document.getElementById('contest-hud-chaser-name');
    var cScore = document.getElementById('contest-hud-chaser-score');
    var cDelta = document.getElementById('contest-hud-chaser-delta');
    var chaserWrap = document.getElementById('contest-hud-chaser');
    if (chaser) {
      if (cName) cName.textContent = chaser.p.name || 'אנונימי';
      if (cScore) cScore.textContent = (chaser.total | 0).toLocaleString();
      var lead = myTotal - chaser.total;
      if (cDelta) cDelta.textContent = '↓ ' + lead.toLocaleString() + ' לפניך';
      if (chaserWrap) chaserWrap.classList.remove('contest-hud-empty');
    } else {
      // I'm last (or alone)
      if (cName) cName.textContent = '—';
      if (cScore) cScore.textContent = '';
      if (cDelta) cDelta.textContent = '';
      if (chaserWrap) chaserWrap.classList.add('contest-hud-empty');
    }
  }

  function showContestAlert(type, player, extraCount) {
    // Check if alerts are enabled
    if (getEventConfig('contest_alerts_enabled', 'true') !== 'true') return;

    var emoji, text, bgColor, borderColor, shakeInt;

    if (type === 'overtake') {
      emoji = '⚡';
      var extra = extraCount > 0 ? ' (+' + extraCount + ' נוספים)' : '';
      text = escapeHtml(player.name) + ' עבר אותך!' + extra + ' · ' + (player.score | 0).toLocaleString();
      bgColor = '#C8472F';
      borderColor = '#FF6B35';
      shakeInt = getEventNum('contest_alert_shake_overtake', 3);
    } else if (type === 'you_first') {
      emoji = '👑';
      text = 'אתה מוביל את התחרות!';
      bgColor = '#BA7517';
      borderColor = '#FAC775';
      shakeInt = getEventNum('contest_alert_shake_first', 4);
    } else if (type === 'new_leader') {
      emoji = '🔥';
      text = escapeHtml(player.name) + ' תפס את המקום הראשון! · ' + (player.score | 0).toLocaleString();
      bgColor = '#8B0000';
      borderColor = '#C8472F';
      shakeInt = getEventNum('contest_alert_shake_leader', 2);
    } else if (type === 'almost') {
      emoji = '💪';
      text = 'עוד ' + player.gap.toLocaleString() + ' נקודות לעבור את ' + escapeHtml(player.name) + '!';
      bgColor = '#2E8B6F';
      borderColor = '#9FE1CB';
      shakeInt = 0;
    }

    var displayMs = getEventNum('contest_alert_duration', 3500);

    // Dramatic banner
    var banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;padding:14px 16px;text-align:center;direction:rtl;font-weight:700;font-size:14px;color:#FFF;pointer-events:none;background:' + bgColor + ';border-bottom:3px solid ' + borderColor + ';transform:translateY(-100%);transition:transform 0.3s ease-out;box-shadow:0 4px 20px rgba(0,0,0,0.3)';
    banner.innerHTML = '<span style="font-size:20px;margin-left:6px">' + emoji + '</span> ' + text;
    document.body.appendChild(banner);

    // Slide in
    requestAnimationFrame(function() {
      requestAnimationFrame(function() { banner.style.transform = 'translateY(0)'; });
    });

    // Shake + vibration
    if (shakeInt > 0) shakeGrid(shakeInt);
    if (!isSfxMuted()) buzz([40, 60, 40]);
    if (!isSfxMuted() && type === 'overtake') {
      tone({ freq: 392, bendTo: 294, duration: 0.22, type: 'sawtooth', vol: 0.09, filter: 2400 });
    }
    if (!isSfxMuted() && type === 'you_first') {
      tone({ freq: 523, duration: 0.12, type: 'sine', vol: 0.08 });
      setTimeout(function() { tone({ freq: 659, duration: 0.12, type: 'sine', vol: 0.08 }); }, 120);
      setTimeout(function() { tone({ freq: 784, duration: 0.2, type: 'sine', vol: 0.08 }); }, 240);
    }

    // Slide out
    setTimeout(function() {
      banner.style.transform = 'translateY(-100%)';
      setTimeout(function() { banner.remove(); }, 400);
    }, displayMs);
  }

  async function showContestLeaderboard(code) {
    let screen = document.getElementById('contest-screen');
    if (!screen) {
      const app = document.querySelector('.app');
      hideHome();
      screen = document.createElement('div');
      screen.id = 'contest-screen';
      screen.className = 'contest-screen';
      app.appendChild(screen);
    }
    screen.innerHTML = '<div class="contest-loading">טוען לוח...</div>';
    const data = await fetchContest(code);
    if (!data) {
      screen.innerHTML =
        createBackButton('home') +
        '<div class="contest-title" style="margin-top:60px">שגיאת חיבור</div>';
      return;
    }

    // Reset smart-board state on every fresh mount so the player always
    // lands on the compact view (and a stale search term from a previous
    // visit doesn't filter the new list to "no results").
    contestBoardExpanded = false;
    contestBoardSearchTerm = '';
    const playersHtml = renderContestSmartBoard(data.players || []);
    const link = buildContestShareLink(code);

    // If we just arrived here from the in-game HUD's ⤢ button, the back
    // arrow should resume the paused game (init('contest') restores from
    // the saved state). Consume the flag so the next mount goes back to
    // the regular home/contest-menu routing.
    const returnToGame = _contestHudJustOpenedLb;
    _contestHudJustOpenedLb = false;
    // Back: if player has 2+ contests, go to my-contests list; else home.
    const clbBackTarget = myContestsCountSync() >= 2 ? 'contest-menu' : 'home';
    // §2.1 — render via mountShell (unified header). The old back-button +
    // <div class="contest-title"> is gone; mountShell injects both.
    screen.innerHTML =
      '<div class="contest-code-row">' +
        '<button class="contest-code-pill" id="clb-code-pill" aria-label="העתק קוד התחרות">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
          '<span>קוד</span>' +
          '<code>' + escapeHtml(data.contest.code) + '</code>' +
        '</button>' +
      '</div>' +
      '<div class="contest-sub" id="clb-sub" style="display:flex;align-items:center;justify-content:center;gap:8px">' +
        '<span><span class="contest-live-dot"></span>' +
        (data.players || []).length + ' שחקנים · ' + formatTimeLeft(data.contest.ends_at) + '</span>' +
        '<button id="clb-refresh" style="background:none;border:1px solid rgba(0,0,0,0.1);border-radius:6px;padding:3px 6px;cursor:pointer;display:inline-flex;align-items:center" aria-label="רענן">' +
          '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="contest-scoring-note">' +
        (data.contest.score_mode === 'best'
          ? '🏆 הכי גבוה — רק המשחק הטוב ביותר נספר'
          : '🧮 ניקוד מצטבר — כל משחק מצטרף לסך הכל'
        ) +
      '</div>' +
      '<div class="contest-board" id="clb-board">' + playersHtml + '</div>' +
      '<div class="contest-form" style="margin-top:18px">' +
        (returnToGame ? '<button class="contest-submit-btn" id="clb-resume" style="background:linear-gradient(135deg,#2E8B6F,#1A6B53);color:#FFFFFF">↩ חזור למשחק שלך</button>' : '') +
        '<button class="contest-submit-btn" id="clb-play"' + (returnToGame ? ' style="background:#FFFFFF;color:#1C1A18;border:1.5px solid rgba(0,0,0,0.12)"' : '') + '>' + (returnToGame ? 'התחל משחק חדש' : 'שחק עכשיו') + '</button>' +
        '<button class="contest-secondary-btn" id="clb-spectate" style="display:none">' +
          '<span style="display:inline-flex;align-items:center;gap:6px;justify-content:center">' +
            '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>' +
            '<span id="clb-spectate-label">צפה במשחק חי</span>' +
          '</span>' +
        '</button>' +
        '<button class="contest-secondary-btn" id="clb-share">שתף קישור</button>' +
        (myContestsCountSync() >= 2 ? '<button class="contest-secondary-btn" id="clb-switch" style="margin-top:6px">↕ החלפת תחרות (' + myContestsCountSync() + ')</button>' : '') +
        '<button class="contest-ghost-btn" id="clb-leave">נתק ממכשיר זה</button>' +
      '</div>';

    // §2.1 — unified shell at the top of this screen. Back reuses the
    // legacy back-target logic (home vs contest-menu) so behavior is
    // unchanged; visually it now matches the rest of the new shell.
    // EXCEPTION: when we arrived from the in-game HUD's ⤢ button, back
    // resumes the paused game instead — the player just wanted to peek
    // at the standings, not abandon their run.
    mountShell({
      target: screen,
      title: data.contest.name,
      subtitle: returnToGame
        ? '⏸ המשחק שלך מושהה'
        : 'תחרות חברים · ' + (data.players || []).length + ' שחקנים',
      onBack: function() {
        if (returnToGame) {
          // Resume — the game state was saved by the HUD before the LB mount,
          // so init('contest') restores it.
          hideContestScreens();
          if (typeof init === 'function') init('contest');
          return;
        }
        if (clbBackTarget === 'contest-menu') {
          hideContestScreens();
          showContestMenu();
        } else {
          hideContestScreens();
          if (typeof showHome === 'function') showHome();
        }
      }
    });
    // Wire the explicit "resume game" CTA (only present when returnToGame).
    var resumeBtn = document.getElementById('clb-resume');
    if (resumeBtn) resumeBtn.onclick = function() {
      hideContestScreens();
      if (typeof init === 'function') init('contest');
    };

    // Wire smart-board controls (expand/collapse/search) on first mount.
    // Silent refreshes re-call this themselves so the handlers stay alive
    // after every 20s board re-render.
    var initialBoardEl = document.getElementById('clb-board');
    if (initialBoardEl) wireContestBoardControls(initialBoardEl, data.players || []);

    document.getElementById('clb-play').onclick = function() {
      setActiveContest(code);
      stopContestRefresh();
      hideContestScreens();
      // In returnToGame mode the label is "התחל משחק חדש" — must wipe
      // the saved mid-game state so init doesn't restore the paused game.
      init('contest', returnToGame ? { fresh: true } : undefined);
    };
    const refreshBtn = document.getElementById('clb-refresh');
    if (refreshBtn) refreshBtn.onclick = function() {
      refreshBtn.style.opacity = '0.4';
      refreshContestBoardSilently().then(function() {
        refreshBtn.style.opacity = '1';
      });
    };
    const codePill = document.getElementById('clb-code-pill');
    if (codePill) codePill.onclick = function() {
      const text = buildContestShareLink(code);
      const setCopied = function() {
        codePill.classList.add('copied');
        setTimeout(function() { codePill.classList.remove('copied'); }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(setCopied, setCopied);
      } else {
        setCopied();
      }
    };
    document.getElementById('clb-share').onclick = function() {
      const btn = this;
      const orig = btn.textContent;
      const flash = function() {
        btn.textContent = '✓ הקישור הועתק';
        setTimeout(function() { btn.textContent = orig; }, 1700);
      };
      const shareText = data.contest.host_name + ' הזמין/ה אותך לתחרות BLOOM 🎮\n' + link;
      if (navigator.share) {
        navigator.share({ text: shareText }).catch(function() {
          // user cancelled the share sheet — fall through to copy as a fallback
          if (navigator.clipboard) navigator.clipboard.writeText(link).then(flash, flash);
          else flash();
        });
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(flash, flash);
      } else {
        flash();
      }
    };
    const switchBtn = document.getElementById('clb-switch');
    if (switchBtn) switchBtn.onclick = showMyContestsList;
    const leaveBtn = document.getElementById('clb-leave');
    if (leaveBtn) leaveBtn.onclick = async function() {
      var __leaveOk = (typeof window.__bloomConfirm === 'function')
        ? await window.__bloomConfirm('לנתק מהתחרות?\nהציון נשמר בלוח ותוכל להצטרף מחדש עם הקוד.', { icon: '🚪', confirmText: 'נתק' })
        : confirm('לנתק את המכשיר מהתחרות? הציון נשמר בלוח ותוכל להצטרף מחדש עם הקוד.');
      if (!__leaveOk) return;
      // Server-side soft-leave FIRST — without this the contest pops back
      // into /api/contests/mine on the next page load and the leave looks
      // broken. Fire-and-forget is intentional: the local cleanup below is
      // what makes the UI feel responsive; the server call just ensures
      // the row is flagged before the next /mine fetch.
      try {
        await apiPost('/api/contests/' + encodeURIComponent(code) + '/leave', {});
      } catch (e) { /* network blip — the user still sees the local exit */ }
      clearContestGameState(code);
      clearContestDisplayName(code);
      stopContestRefresh();
      invalidateMyContestsCache();

      const isLeavingActive = activeContestCode === code;

      if (isLeavingActive) {
        stopOvertakeWatch();
        // Find another contest to switch to so the "חברים" tab stays alive.
        const remaining = await fetchMyContests({ fresh: true });
        const others = (remaining || []).filter(function(c) { return c.code !== code; });
        if (others.length > 0) {
          setActiveContest(others[0].code);
          activeContestData = null;
          if (others.length === 1) {
            showContestLeaderboard(others[0].code);
          } else {
            showMyContestsList();
          }
        } else {
          setActiveContest(null);
          activeContestData = null;
          hideContestScreens();
          showHome();
        }
      } else {
        // Leaving a non-active contest — just go back to the list.
        // Don't touch activeContestCode.
        if (myContestsCountSync() >= 2) {
          showMyContestsList();
        } else {
          hideContestScreens();
          showHome();
        }
      }
    };

    // Delegated spectate handler — fires on any leaderboard row that's
    // tagged spectatable (=another player who is currently live). We use
    // delegation because the inner HTML of `.contest-board` is rewritten
    // every 20s by `refreshContestBoardSilently`.
    const boardEl = document.getElementById('clb-board');
    if (boardEl) {
      const dispatchSpectate = function(target, name) {
        if (!target) return;
        openSpectatorPicker('contest-screen');
        // Once the picker mounted, jump straight into spectating this specific
        // target — saves a click since the user already chose who to watch.
        setTimeout(function() {
          const modal = document.getElementById('spectator-picker-modal');
          if (modal) modal.remove();
          startSpectator(target, name, 'contest-screen');
        }, 0);
      };
      boardEl.addEventListener('click', function(ev) {
        const row = ev.target.closest('[data-spectate-target]');
        if (!row) return;
        dispatchSpectate(row.getAttribute('data-spectate-target'),
                         row.getAttribute('data-spectate-name'));
      });
      boardEl.addEventListener('keydown', function(ev) {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        const row = ev.target.closest('[data-spectate-target]');
        if (!row) return;
        ev.preventDefault();
        dispatchSpectate(row.getAttribute('data-spectate-target'),
                         row.getAttribute('data-spectate-name'));
      });
    }

    // Top-level "watch live games" button — also visible mid-game so the
    // player can take a peek without losing their run.
    const specOpenBtn = document.getElementById('clb-spectate');
    function refreshSpectateBtnVisibility() {
      const liveCount = (activeContestData ? 0 : 0) + 0; // placeholder; recomputed below
      // Recompute count from currently-rendered board so we don't double-fetch.
      const rows = document.querySelectorAll('#clb-board [data-spectate-target]');
      if (!specOpenBtn) return;
      if (rows.length > 0) {
        specOpenBtn.style.display = '';
        const label = document.getElementById('clb-spectate-label');
        if (label) label.textContent = rows.length === 1
          ? 'צפה במשחק חי'
          : 'צפה במשחק חי (' + rows.length + ')';
      } else {
        specOpenBtn.style.display = 'none';
      }
    }
    if (specOpenBtn) specOpenBtn.onclick = function() { openSpectatorPicker('contest-screen'); };
    refreshSpectateBtnVisibility();
    // The 20s board refresh rewrites the board HTML — observe it to keep
    // the spectate button's count fresh without piggybacking on every poll.
    if (boardEl && 'MutationObserver' in window) {
      new MutationObserver(refreshSpectateBtnVisibility).observe(boardEl, { childList: true, subtree: false });
    }

    // Leaderboard view has its own 20 s refresh — pause the overtake watcher
    // to avoid hitting the same endpoint twice on different cadences.
    stopOvertakeWatch();
    startContestRefresh(code);
  }

  // Wires up scroll-detection on a freshly-rendered .overlay so the
  // fade-out hint at the bottom only shows when there's actually more to
  // scroll to. Call this after every wrap.innerHTML = '<div class="overlay">…'.
  function equipOverlay() {
    const overlay = document.querySelector('#grid-wrap .overlay');
    if (!overlay) return;
    function syncBottomState() {
      // "at-bottom" = nothing more to reveal by scrolling
      const fits   = overlay.scrollHeight <= overlay.clientHeight + 2;
      const ended  = overlay.scrollTop + overlay.clientHeight >= overlay.scrollHeight - 2;
      overlay.classList.toggle('at-bottom', fits || ended);
    }
    // Initial check after layout settles
    setTimeout(syncBottomState, 0);
    overlay.addEventListener('scroll', syncBottomState, { passive: true });
    window.addEventListener('resize', syncBottomState);
  }

  // Sizes the .grid element with SQUARE cells. Fits within BOTH the
  // available width and height of .grid-wrap so the board never scrolls.
  // On very short screens the cells shrink proportionally instead of
  // overflowing vertically.
  function fitGrid() {
    const wrap = document.getElementById('grid-wrap');
    const grid = document.getElementById('grid');
    if (!wrap || !grid) return;
    ensureGridResizeObserver();    // self-heal: re-fit whenever grid-wrap settles
    const padX = 6;                // matches CSS .grid-wrap horizontal padding
    const padY = 12;               // matches CSS .grid-wrap bottom padding
    const gap = 5;                 // matches CSS .grid gap
    const cols = getBoardCols();
    const rows = getBoardRows();
    const W = Math.max(0, wrap.clientWidth - 2 * padX);
    // GV.4.x — in v2 the board fills the full height (the tier-bar is
    // relocated into the spine), so the floating booster strip would
    // overlap the bottom row. When the strip is mounted, reserve space at
    // the bottom so the board sizes to sit above it. The grid is
    // flex-start in .grid-wrap, so the freed space lands at the bottom
    // exactly where the strip floats. Classic keeps its natural bottom
    // gap, so this only matters for v2.
    let extraBottom = 0;
    if (document.body.classList.contains('bloom-v2') &&
        document.getElementById('booster-strip')) {
      extraBottom = 64;
    }
    const H = Math.max(0, wrap.clientHeight - padY - 6 - extraBottom);
    if (W <= 0 || H <= 0) {
      // BUG FIX 2026-06-03 ("tiles disappear" / empty grid): the wrap was
      // momentarily collapsed (mid-transition, or before a late-mounting
      // sibling like the col-mult bar laid out). The old code silently
      // returned, leaving the grid UNSIZED → its empty 1fr cells CSS-collapse
      // to 0 height → an invisible board, and nothing ever re-fit it. Now we
      // retry on the next frame (capped) until the layout settles.
      window.__fitGridRetries = (window.__fitGridRetries || 0) + 1;
      if (window.__fitGridRetries <= 30) requestAnimationFrame(fitGrid);
      return;
    }
    window.__fitGridRetries = 0;
    const cellByW = Math.floor((W - (cols - 1) * gap) / cols);
    const cellByH = Math.floor((H - (rows - 1) * gap) / rows);
    const cell = Math.max(1, Math.min(cellByW, cellByH));
    grid.style.width  = (cell * cols + (cols - 1) * gap) + 'px';
    grid.style.height = (cell * rows + (rows - 1) * gap) + 'px';
    // Layout diagnostics — only log when the cell size or wrap dimensions
    // CHANGE. Logging on every render flooded the console with 90+ identical
    // lines per game. The viewport-bound state is the interesting signal.
    if (window.__bloomLayoutLog !== false) {
      var sig = cell + '|' + wrap.clientWidth + 'x' + wrap.clientHeight + '|' + window.innerWidth + 'x' + window.innerHeight;
      if (window.__bloomLayoutSig !== sig) {
        window.__bloomLayoutSig = sig;
        var bound = cellByW < cellByH ? 'WIDTH-bound' : 'HEIGHT-bound';
        var mb = document.getElementById('mode-bar');
        var tb = document.getElementById('tier-bar');
        var mbH = mb ? mb.getBoundingClientRect().height : 0;
        var tbH = tb ? tb.getBoundingClientRect().height : 0;
        console.log('[fitGrid]',
          'cell=' + cell + 'px',
          '(' + bound + ')',
          'wrap=' + wrap.clientWidth + 'x' + wrap.clientHeight,
          'mode-bar=' + Math.round(mbH) + 'px',
          'tier-bar=' + Math.round(tbH) + 'px',
          'viewport=' + window.innerWidth + 'x' + window.innerHeight
        );
      }
    }
  }
  // Re-fit on resize/orientation/dpr changes — phones rotate, browser
  // address bar shows/hides, etc.
  window.addEventListener('resize', function() {
    if (typeof fitGrid === 'function') fitGrid();
  });
  // BUG FIX 2026-06-03 — a window 'resize' does NOT fire when grid-wrap's own
  // size changes from a sibling laying out late (the col-mult bar on a daily-
  // special, the address bar settling, a tab/transition reflow). Without a
  // re-fit there, fitGrid's first (too-early) run leaves the grid collapsed →
  // "the tiles disappear". A ResizeObserver on grid-wrap re-fits on every such
  // settle. fitGrid sizes the GRID (a child of the wrap), never the wrap, so
  // this cannot feedback-loop. Idempotent + lazily attached.
  function ensureGridResizeObserver() {
    if (window.__gridRO || typeof ResizeObserver === 'undefined') return;
    var wrap = document.getElementById('grid-wrap');
    if (!wrap) return;
    try {
      window.__gridRO = new ResizeObserver(function() {
        if (typeof fitGrid === 'function') fitGrid();
      });
      window.__gridRO.observe(wrap);
    } catch (e) {}
  }
  try { if (document.readyState !== 'loading') ensureGridResizeObserver(); } catch (e) {}
  try { window.addEventListener('DOMContentLoaded', ensureGridResizeObserver); } catch (e) {}

  // Score per merge. The (1 + (tier-1)*0.3) factor weights higher tiers more
  // heavily — Crown (tier 8) merges are worth ~3.1× a flat formula. This
  // turns the late-game grind into a payoff: a Crown achievement now scores
  // ~62K (versus ~15K with the old linear formula) without touching the
  // chain ladder (which would invalidate existing leaderboards).
  //
  // The optional `col` argument is the survivor column of the merge. When a
  // Dynamic Boards column-multiplier is active (getColumnMultipliers() !== null),
  // it multiplies the base. If col is undefined or no multiplier is active,
  // the function returns the vanilla score with zero overhead — pure refactor
  // for the default case.
  function pointsFor(tier, groupSize, chainMult, col) {
    var base = tier * 10 * (1 + (tier - 1) * 0.3) * groupSize * chainMult;
    var mults = getColumnMultipliers();
    if (mults && typeof col === 'number' && col >= 0 && col < mults.length) {
      base = base * mults[col];
    }
    return Math.round(base);
  }
  function pieceValue(tier) {
    return pointsFor(tier, 2, 1);
  }

