// ============================================================
// Stage 26 — Live Ops Calendar + Daily Checklist (May 2026)
// Two surfaces:
// 1. Daily Checklist tile on home — 5 to-do items the player should
//    complete today. Activates completionist drive.
// 2. Full 30-day calendar modal — shows tournaments + daily specials
//    + admin events. Plan-ahead anchoring.
// ============================================================
(function() {
  var _checklistCache = { data: null, fetchedAt: 0 };
  var _calendarCache = { data: null, fetchedAt: 0 };
  var _ticker = null;

  function fetchChecklist(force) {
    if (!force && _checklistCache.data && (Date.now() - _checklistCache.fetchedAt) < 60000) {
      return Promise.resolve(_checklistCache.data);
    }
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    if (!deviceId) return Promise.resolve(null);
    return fetch('/api/checklist/today?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) {
          // Client-side override for daily_special — read from localStorage flag
          // that markDailySpecialPlayed wrote on game-over.
          if (d.items) {
            d.items.forEach(function(item) {
              if (item.key === 'daily_special') {
                try {
                  var raw = localStorage.getItem('bloom_dyn_daily_special_played');
                  if (raw) {
                    var obj = JSON.parse(raw);
                    var todayJer = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
                    if (obj && obj.date === todayJer) item.done = true;
                  }
                } catch (e) {}
              }
            });
            d.doneCount = d.items.filter(function(i) { return i.done; }).length;
            d.allDone = d.totalCount > 0 && d.doneCount === d.totalCount;
          }
          _checklistCache.data = d;
          _checklistCache.fetchedAt = Date.now();
        }
        return d;
      });
  }

  function fetchCalendar(force) {
    if (!force && _calendarCache.data && (Date.now() - _calendarCache.fetchedAt) < 5 * 60 * 1000) {
      return Promise.resolve(_calendarCache.data);
    }
    return fetch('/api/calendar/upcoming?days=30')
      .then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) {
          _calendarCache.data = d;
          _calendarCache.fetchedAt = Date.now();
        }
        return d;
      });
  }

  function mountChecklistTile() {
    // T1.1 — Daily Checklist unlocks at L5 (alongside contests). A new
    // player without quests/streaks to track shouldn't see an empty list.
    try { if (typeof getPlayerLevel === 'function' && getPlayerLevel() < 5) return; } catch (e) {}
    var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
    if (!home) return;
    if (document.getElementById('checklist-home-tile')) return;
    fetchChecklist(true).then(function(d) {
      if (!d || !d.ok || !d.enabled || !d.items || !d.items.length) return;
      renderChecklistTile(home, d);
    });
  }

  function renderChecklistTile(homeEl, data) {
    var existing = document.getElementById('checklist-home-tile');
    if (existing) existing.remove();
    var tile = document.createElement('div');
    tile.id = 'checklist-home-tile';
    tile.className = 'checklist-home-tile' + (data.allDone ? ' all-done' : '');
    var progressPct = data.totalCount > 0 ? Math.round((data.doneCount / data.totalCount) * 100) : 0;
    var itemsHtml = data.items.map(function(item) {
      var cls = item.done ? 'checklist-item-done' : 'checklist-item-pending';
      return '<div class="checklist-item ' + cls + '" data-checklist-action="' + item.action + '">' +
        '<div class="checklist-item-check">' + (item.done ? '✓' : '○') + '</div>' +
        '<div class="checklist-item-title">' + escapeHtml(item.title) + '</div>' +
      '</div>';
    }).join('');
    var headerLabel = data.allDone
      ? '🏆 כל המשימות היומיות הושלמו!'
      : '📋 משימות היום · ' + data.doneCount + '/' + data.totalCount;
    tile.innerHTML =
      '<div class="checklist-tile-header">' +
        '<div class="checklist-tile-title">' + headerLabel + '</div>' +
        '<button class="checklist-tile-calendar" id="checklist-open-calendar">📅 לוח שנה →</button>' +
      '</div>' +
      '<div class="checklist-tile-bar"><div class="checklist-tile-bar-fill" style="width:' + progressPct + '%"></div></div>' +
      '<div class="checklist-tile-items">' + itemsHtml + '</div>';
    // Insert after lives widget if present, else top.
    var lives = document.getElementById('lives-home-widget');
    var anchor = lives && lives.nextSibling ? lives.nextSibling : homeEl.firstChild;
    homeEl.insertBefore(tile, anchor);
    // Wire actions
    tile.querySelectorAll('[data-checklist-action]').forEach(function(el) {
      el.onclick = function() {
        var action = el.getAttribute('data-checklist-action');
        handleChecklistAction(action);
      };
    });
    var calBtn = document.getElementById('checklist-open-calendar');
    if (calBtn) calBtn.onclick = showCalendarModal;
  }

  function handleChecklistAction(action) {
    if (action === 'open_gacha' && typeof showGachaModal === 'function') {
      if (typeof fetchGachaState === 'function') {
        fetchGachaState(true).then(function(d) { if (d) showGachaModal(d); });
      }
    } else if (action === 'open_dynamic_boards' && typeof showDynamicBoardsPicker === 'function') {
      showDynamicBoardsPicker();
    } else if (action === 'open_daily_deal' && typeof fetchTodayDeal === 'function') {
      fetchTodayDeal(true).then(function(d) {
        if (d && d.deal && typeof showDailyDealModal === 'function') showDailyDealModal(d);
      });
    } else if (action === 'start_game') {
      // Bring up the dynamic boards picker (most direct path to start a game).
      if (typeof showDynamicBoardsPicker === 'function') showDynamicBoardsPicker();
    }
  }

  // Public: re-fetch and re-render checklist (e.g. after a quest claim).
  function refreshChecklistTile() {
    var existing = document.getElementById('checklist-home-tile');
    if (!existing) return;
    var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
    if (!home) return;
    fetchChecklist(true).then(function(d) {
      if (d && d.ok && d.enabled) renderChecklistTile(home, d);
    });
  }

  function showCalendarModal() {
    var ex = document.getElementById('calendar-modal');
    if (ex) ex.remove();
    var modal = document.createElement('div');
    modal.id = 'calendar-modal';
    modal.className = 'calendar-modal-overlay';
    modal.innerHTML =
      '<div class="calendar-modal-card">' +
        '<button class="calendar-modal-close" aria-label="סגור">×</button>' +
        '<div class="calendar-modal-title">📅 לוח שנה — 30 ימים הקרובים</div>' +
        '<div class="calendar-modal-sub">תכנון מראש: ראה מה צפוי בכל יום</div>' +
        '<div class="calendar-modal-body" id="calendar-modal-body"><div style="padding:30px;text-align:center;color:#999">⏳ טוען...</div></div>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.calendar-modal-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    fetchCalendar(true).then(function(d) { renderCalendarBody(d); });
  }

  var CAT_COLORS = {
    tournament:    { bg: '#FEE2E2', fg: '#991B1B', dot: '#DC2626' },
    daily_special: { bg: '#FEF3C7', fg: '#78350F', dot: '#F59E0B' },
    season_end:    { bg: '#F3E8FF', fg: '#581C87', dot: '#A855F7' },
    weekend:       { bg: '#DBEAFE', fg: '#1E3A8A', dot: '#3B82F6' },
    gacha:         { bg: '#FCE7F3', fg: '#831843', dot: '#EC4899' },
    battle_pass:   { bg: '#FEF3C7', fg: '#78350F', dot: '#F59E0B' },
    general:       { bg: '#F3F4F6', fg: '#374151', dot: '#6B7280' }
  };

  function renderCalendarBody(data) {
    var host = document.getElementById('calendar-modal-body');
    if (!host) return;
    if (!data || !data.ok || !data.enabled) {
      host.innerHTML = '<div style="padding:30px;text-align:center;color:#999">לוח השנה כבוי כרגע</div>';
      return;
    }
    var byDate = data.eventsByDate || {};
    var todayJer = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    // Build a 30-day vertical list — each day a card with its events.
    var html = '';
    for (var i = 0; i < (data.days || 30); i++) {
      var d = new Date();
      d.setDate(d.getDate() + i);
      var dateStr = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
      var events = byDate[dateStr] || [];
      var dayLabel = d.toLocaleDateString('he-IL', { weekday: 'long', day: '2-digit', month: '2-digit' });
      var isToday = dateStr === todayJer;
      var dotsHtml = events.map(function(ev) {
        var c = CAT_COLORS[ev.category] || CAT_COLORS.general;
        return '<span class="cal-day-dot" style="background:' + c.dot + '"></span>';
      }).join('');
      var eventsHtml = events.length
        ? events.map(function(ev) {
            var c = CAT_COLORS[ev.category] || CAT_COLORS.general;
            var timeStr = '';
            if (ev.startsAt) {
              try {
                timeStr = new Date(ev.startsAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
              } catch (e) {}
            }
            return '<div class="cal-event-row" style="background:' + c.bg + ';color:' + c.fg + '">' +
              '<div class="cal-event-emoji">' + (ev.emoji || '📅') + '</div>' +
              '<div class="cal-event-body">' +
                '<div class="cal-event-title">' + escapeHtml(ev.title) + (timeStr ? ' · ' + timeStr : '') + '</div>' +
                (ev.description ? '<div class="cal-event-desc">' + escapeHtml(ev.description) + '</div>' : '') +
              '</div>' +
            '</div>';
          }).join('')
        : '<div class="cal-empty-row">אין אירועים מתוכננים</div>';
      html += '<div class="cal-day-card' + (isToday ? ' cal-day-today' : '') + (events.length ? ' cal-day-has-events' : '') + '">' +
        '<div class="cal-day-head">' +
          '<div class="cal-day-label">' + (isToday ? '<strong>היום</strong> · ' : '') + dayLabel + '</div>' +
          (dotsHtml ? '<div class="cal-day-dots">' + dotsHtml + '</div>' : '') +
        '</div>' +
        '<div class="cal-day-events">' + eventsHtml + '</div>' +
      '</div>';
    }
    host.innerHTML = html;
  }

  window.maybeShowChecklistTile = mountChecklistTile;
  window.refreshChecklistTile = refreshChecklistTile;
  window.showCalendarModal = showCalendarModal;
  window.fetchChecklist = fetchChecklist;
  window.fetchCalendar = fetchCalendar;
})();
