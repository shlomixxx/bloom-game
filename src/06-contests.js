  function hideContestScreens() {
    stopContestRefresh();
    stopMyContestsRefresh();
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
        '<div class="contest-form-label">🎰 הימור (אופציונלי)</div>' +
        '<div style="display:flex;align-items:center;gap:8px;direction:rtl;margin-bottom:4px">' +
          '<input type="number" class="contest-input" id="ctf-wager" placeholder="0" min="0" max="500" value="0" style="width:80px;text-align:center;font-weight:700" />' +
          '<span style="font-size:12px;color:#6F6E68">💎 כל משתתף · קופה מחולקת לזוכים</span>' +
        '</div>' +
        '<div style="font-size:11px;color:#A8A6A0;direction:rtl;margin-bottom:8px">היתרה שלך: <strong style="color:#BA7517">' + playerBalance + ' 💎</strong> · מינימום הימור: 10 · 0 = ללא הימור</div>' +
        '<button class="contest-submit-btn" id="ctf-submit">צור והעתק קוד</button>' +
        '<div class="contest-error" id="ctf-error"></div>' +
      '</div>';

    let selectedDays = 7;
    let selectedBoardType = 'shared';
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
            durationDays: selectedDays,
            boardType: selectedBoardType,
            wagerAmount: wagerVal
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
      // Some mobile browsers block window.open if it isn't a direct user click
      // gesture — fall back to copying the link with a "הועתק" flash.
      const w = window.open('https://wa.me/?text=' + encodeURIComponent(shareText), '_blank');
      if (!w) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(shareText).catch(function() {});
        }
        const wa = document.getElementById('ctsh-wa');
        const span = wa.querySelector('span');
        if (span) {
          const orig = span.textContent;
          span.textContent = '✓ הטקסט הועתק';
          setTimeout(function() { span.textContent = orig; }, 1700);
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
            body: JSON.stringify({ deviceId: deviceId, displayName: nameVal })
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

  function renderContestBoardRows(players) {
    if (!players || players.length === 0) {
      return '<div class="contest-board-empty">אין עדיין שחקנים</div>';
    }
    // Effective rank ordering already accounts for liveScore on the server,
    // but the displayed score should also include the live delta so the
    // numbers match the rank visually.
    function displayScore(p) { return (p.score | 0) + (p.liveScore == null ? 0 : (p.liveScore | 0)); }
    const topScore = displayScore(players[0]);
    return players.map(function(p, i) {
      const cls = i === 0 ? 'contest-board-row first' : p.you ? 'contest-board-row me' : 'contest-board-row';
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
      const total = displayScore(p);
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
      const avatarHtml = renderAvatarHtml(p.deviceId || p.name, 'sm');
      return '<div class="' + cls + spectatableCls + '"' + rowAttrs + '>' +
        '<div class="contest-board-rank">' + (i + 1) + '</div>' +
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
    }).join('');
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
    if (boardEl) boardEl.innerHTML = renderContestBoardRows(data.players || []);
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

    const playersHtml = renderContestBoardRows(data.players || []);
    const link = buildContestShareLink(code);

    // Back: if player has 2+ contests, go to my-contests list; else home.
    const clbBackTarget = myContestsCountSync() >= 2 ? 'contest-menu' : 'home';
    screen.innerHTML =
      createBackButton(clbBackTarget) +
      '<div class="contest-title">' + escapeHtml(data.contest.name) + '</div>' +
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
      '<div class="contest-scoring-note">סכום נקודות מצטבר — כל משחק מצטרף לסך</div>' +
      '<div class="contest-board" id="clb-board">' + playersHtml + '</div>' +
      '<div class="contest-form" style="margin-top:18px">' +
        '<button class="contest-submit-btn" id="clb-play">שחק עכשיו</button>' +
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

    document.getElementById('clb-play').onclick = function() {
      setActiveContest(code);
      stopContestRefresh();
      hideContestScreens();
      init('contest');
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
      if (!confirm('לנתק את המכשיר מהתחרות? הציון נשמר בלוח ותוכל להצטרף מחדש עם הקוד.')) return;
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
    const padX = 6;                // matches CSS .grid-wrap horizontal padding
    const padY = 12;               // matches CSS .grid-wrap bottom padding
    const gap = 5;                 // matches CSS .grid gap
    const cols = getBoardCols();
    const rows = getBoardRows();
    const W = Math.max(0, wrap.clientWidth - 2 * padX);
    const H = Math.max(0, wrap.clientHeight - padY - 6);
    if (W <= 0 || H <= 0) return;  // not yet laid out
    const cellByW = Math.floor((W - (cols - 1) * gap) / cols);
    const cellByH = Math.floor((H - (rows - 1) * gap) / rows);
    const cell = Math.max(1, Math.min(cellByW, cellByH));
    grid.style.width  = (cell * cols + (cols - 1) * gap) + 'px';
    grid.style.height = (cell * rows + (rows - 1) * gap) + 'px';
  }
  // Re-fit on resize/orientation/dpr changes — phones rotate, browser
  // address bar shows/hides, etc.
  window.addEventListener('resize', function() {
    if (typeof fitGrid === 'function') fitGrid();
  });

  // Score per merge. The (1 + (tier-1)*0.3) factor weights higher tiers more
  // heavily — Crown (tier 8) merges are worth ~3.1× a flat formula. This
  // turns the late-game grind into a payoff: a Crown achievement now scores
  // ~62K (versus ~15K with the old linear formula) without touching the
  // chain ladder (which would invalidate existing leaderboards).
  function pointsFor(tier, groupSize, chainMult) {
    return Math.round(tier * 10 * (1 + (tier - 1) * 0.3) * groupSize * chainMult);
  }
  function pieceValue(tier) {
    return pointsFor(tier, 2, 1);
  }

