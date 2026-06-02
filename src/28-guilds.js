// ============================================================
// Stage 27 — Guilds / Clans (May 2026)
// Peer-pressure retention. Shared daily goal + member leaderboard.
// Industry: +35% D30 retention, 3.4× sessions/day vs solo players.
// ============================================================
(function() {
  var _guildCache = { data: null, fetchedAt: 0 };
  var _guildInFlight = false;

  function fetchGuildState(force) {
    if (!force && _guildCache.data && (Date.now() - _guildCache.fetchedAt) < 30000) {
      return Promise.resolve(_guildCache.data);
    }
    if (_guildInFlight) return Promise.resolve(_guildCache.data);
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    if (!deviceId) return Promise.resolve(null);
    _guildInFlight = true;
    return fetch('/api/guilds/mine?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        _guildInFlight = false;
        if (d && d.ok) {
          _guildCache.data = d;
          _guildCache.fetchedAt = Date.now();
        }
        return d;
      });
  }

  // Auto-contribute called from game-over with score + crowns reached
  function contributeToGuild(score, crowns) {
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    if (!deviceId || crowns < 0 || score < 0) return;
    fetch('/api/guilds/contribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token, score: score, crowns: crowns })
    }).then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) {
          _guildCache.data = null;
          if (d.justCompleted) {
            // Big celebration!
            showGuildGoalCompleteToast();
          } else if (crowns > 0) {
            // Subtle "contributed" toast.
            showGuildContribToast(crowns, d.newProgress, d.goal);
          }
        }
      });
  }

  function showGuildContribToast(crowns, newProgress, goal) {
    var t = document.createElement('div');
    t.className = 'guild-toast';
    t.innerHTML =
      '<span class="guild-toast-icon">🛡</span>' +
      '<span>+' + crowns + ' לקלאן · ' + newProgress + '/' + goal + '</span>';
    document.body.appendChild(t);
    setTimeout(function() { try { t.remove(); } catch (e) {} }, 3000);
  }

  function showGuildGoalCompleteToast() {
    var t = document.createElement('div');
    t.className = 'guild-toast guild-toast-complete';
    t.innerHTML =
      '<span class="guild-toast-icon">🎉</span>' +
      '<span><strong>הקלאן השלים את היעד היומי!</strong> תפתח את האפליקציה כדי לאסוף את הפרס</span>';
    document.body.appendChild(t);
    try { if (typeof soundMilestone === 'function') soundMilestone(6); } catch (e) {}
    try { if (typeof buzz === 'function') buzz([80, 60, 100, 60, 120]); } catch (e) {}
    setTimeout(function() { try { t.remove(); } catch (e) {} }, 6000);
  }

  function maybeShowGuildTile() {
    // FD.1 — Guilds lowered from L15 to L8. Industry data (Royal Match,
    // Clash Royale, Brawl Stars): clan retention = +35% D30 and 3.4×
    // sessions/day vs solo. Pulling the gate 7 games forward activates
    // the single strongest retention lever earlier — peer pressure
    // beats every other mechanic in F2P puzzles. Create cost (500💎
    // from config) still keeps it from being noise for L1-7 players;
    // joining via code is free + the modal lets them browse first.
    // Task #20 — gate lowered L8 → L3. Clan retention is the strongest social
    // lever (+35% D30, 3.4× sessions/day); exposing "join a clan" earlier pulls
    // it forward. CREATE stays at L8 (gated inside the modal) — the 500💎 cost +
    // level keep new players from spawning dead clans; joining by code is free.
    try { if (typeof getPlayerLevel === 'function' && getPlayerLevel() < 3) return; } catch (e) {}
    fetchGuildState(false).then(function(d) {
      if (!d || !d.ok || !d.enabled) return;
      var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
      if (!home) return;
      if (document.getElementById('guild-home-tile')) { updateGuildTile(d); return; }
      mountGuildTile(home, d);
    });
  }

  function tileInner(data) {
    if (!data.guild) {
      // Not in a guild — "Join one" CTA
      return (
        '<span class="guild-tile-icon">🛡</span>' +
        '<span class="guild-tile-body">' +
          '<span class="guild-tile-title">הצטרף לקלאן</span>' +
          '<span class="guild-tile-sub">מטרה משותפת + פרסים יומיים עם שחקנים אחרים</span>' +
        '</span>' +
        '<span class="guild-tile-arrow">›</span>'
      );
    }
    var g = data.guild;
    var p = data.todayProgress;
    var pct = p.target > 0 ? Math.min(100, Math.round((p.progress / p.target) * 100)) : 0;
    var claimBadge = p.canClaim ? '<span class="guild-tile-claim">🎁 ' + p.rewardPerMember + '💎</span>' : '';
    var sub = p.isComplete
      ? (p.canClaim ? '✓ יעד הושלם — קח את הפרס שלך!' : (p.claimed ? '✓ קיבלת היום — חזור מחר' : '✓ יעד יומי הושלם!'))
      : 'יעד: ' + p.progress + ' / ' + p.target + ' כתרים היום';
    return (
      '<span class="guild-tile-icon">' + (g.emoji || '🛡') + '</span>' +
      '<span class="guild-tile-body">' +
        '<span class="guild-tile-title">' + escapeHtml(g.name) + ' · ' + g.memberCount + ' חברים' + claimBadge + '</span>' +
        '<span class="guild-tile-bar"><span class="guild-tile-bar-fill" style="width:' + pct + '%"></span></span>' +
        '<span class="guild-tile-sub">' + sub + '</span>' +
      '</span>' +
      '<span class="guild-tile-arrow">›</span>'
    );
  }

  function mountGuildTile(homeEl, data) {
    var tile = document.createElement('button');
    tile.id = 'guild-home-tile';
    tile.className = 'guild-home-tile' + (data.guild && data.todayProgress && data.todayProgress.canClaim ? ' can-claim' : '');
    tile.innerHTML = tileInner(data);
    homeEl.appendChild(tile);
    tile.onclick = function() {
      if (!data.guild) showGuildJoinCreateModal();
      else showGuildModal();
    };
  }

  function updateGuildTile(data) {
    var tile = document.getElementById('guild-home-tile');
    if (!tile) return;
    tile.className = 'guild-home-tile' + (data.guild && data.todayProgress && data.todayProgress.canClaim ? ' can-claim' : '');
    tile.innerHTML = tileInner(data);
  }

  function showGuildJoinCreateModal() {
    var ex = document.getElementById('guild-jc-modal');
    if (ex) ex.remove();
    var modal = document.createElement('div');
    modal.id = 'guild-jc-modal';
    modal.className = 'guild-modal-overlay';
    // Task #20 — CREATE is gated to L8; L3-7 players can only JOIN by code.
    var guildLvl = 99;
    try { if (typeof getPlayerLevel === 'function') guildLvl = getPlayerLevel(); } catch (e) {}
    var guildCanCreate = guildLvl >= 8;
    var createSectionHtml = guildCanCreate
      ? '<div class="guild-jc-section">' +
          '<div class="guild-jc-section-title">✨ צור קלאן חדש</div>' +
          '<div class="guild-jc-create-fields">' +
            '<input type="text" id="guild-create-name" placeholder="שם הקלאן" maxlength="60" />' +
            '<input type="text" id="guild-create-emoji" placeholder="אימוג\'י (לדוגמה: 🛡)" maxlength="4" style="text-align:center;font-size:18px" />' +
            '<textarea id="guild-create-desc" placeholder="תיאור (אופציונלי)" maxlength="300" rows="2"></textarea>' +
            '<button class="guild-jc-btn-create" id="guild-jc-create">צור · 500💎</button>' +
          '</div>' +
        '</div>'
      : '<div class="guild-jc-section guild-jc-create-locked">' +
          '<div class="guild-jc-section-title">✨ צור קלאן חדש</div>' +
          '<div class="guild-jc-locked-note">🔒 יצירת קלאן נפתחת ברמה 8 · בינתיים הצטרף לקלאן קיים עם קוד (חינם!)</div>' +
        '</div>';
    modal.innerHTML =
      '<div class="guild-modal-card">' +
        '<button class="guild-modal-close" aria-label="סגור">×</button>' +
        '<div class="guild-modal-icon">🛡</div>' +
        '<div class="guild-modal-title">הצטרף או צור קלאן</div>' +
        '<div class="guild-modal-sub">קלאן = קבוצה של עד 30 שחקנים שמשתפים פעולה ליעד יומי משותף</div>' +

        '<div class="guild-jc-section">' +
          '<div class="guild-jc-section-title">🔑 הצטרף לקלאן קיים</div>' +
          '<div class="guild-jc-row">' +
            '<input type="text" id="guild-join-code" placeholder="קוד קלאן (לדוגמה: AB12CD)" maxlength="8" style="text-transform:uppercase;letter-spacing:2px;font-family:monospace" />' +
            '<button class="guild-jc-btn-join" id="guild-jc-join">הצטרף</button>' +
          '</div>' +
        '</div>' +

        '<div class="guild-jc-divider">— או —</div>' +

        createSectionHtml +

        '<div id="guild-jc-status" class="guild-jc-status"></div>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.guild-modal-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });

    document.getElementById('guild-jc-join').onclick = function() {
      var code = document.getElementById('guild-join-code').value.trim().toUpperCase();
      if (code.length < 4) { setGuildStatus('הקוד קצר מדי', true); return; }
      doGuildJoin(code, close);
    };
    var createBtn = document.getElementById('guild-jc-create');
    if (createBtn) createBtn.onclick = function() {
      var name = document.getElementById('guild-create-name').value.trim();
      var emoji = document.getElementById('guild-create-emoji').value.trim();
      var desc = document.getElementById('guild-create-desc').value.trim();
      if (name.length < 2) { setGuildStatus('שם קצר מדי', true); return; }
      doGuildCreate(name, emoji || '🛡', desc, close);
    };
  }

  function setGuildStatus(msg, isError) {
    var el = document.getElementById('guild-jc-status');
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? '#DC2626' : '#10B981';
  }

  function doGuildJoin(code, onSuccess) {
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    fetch('/api/guilds/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token, code: code })
    }).then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) {
          _guildCache.data = null;
          try { if (typeof soundMilestone === 'function') soundMilestone(4); } catch (e) {}
          try { if (typeof buzz === 'function') buzz([40, 30, 60]); } catch (e) {}
          if (onSuccess) onSuccess();
          // Refresh + open guild modal.
          fetchGuildState(true).then(function(fresh) {
            if (fresh) {
              maybeShowGuildTile();
              showGuildModal();
            }
          });
        } else {
          var reason = (d && d.reason) || 'unknown';
          var msg = {
            'already_in_guild': 'אתה כבר בקלאן',
            'guild_not_found': 'קוד לא נמצא',
            'guild_full': 'הקלאן מלא'
          }[reason] || ('שגיאה: ' + reason);
          setGuildStatus(msg, true);
        }
      });
  }

  function doGuildCreate(name, emoji, desc, onSuccess) {
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    var bal = (typeof playerBalance !== 'undefined') ? playerBalance : 0;
    if (bal < 500) {
      setGuildStatus('💎 חסר ' + (500 - bal) + '💎 לעלות יצירת קלאן (500💎)', true);
      return;
    }
    fetch('/api/guilds/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token, name: name, emoji: emoji, description: desc })
    }).then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) {
          if (typeof d.newBalance === 'number') {
            try { if (typeof playerBalance !== 'undefined') playerBalance = d.newBalance; } catch (e) {}
            try { if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(); } catch (e) {}
          }
          _guildCache.data = null;
          try { if (typeof soundMilestone === 'function') soundMilestone(5); } catch (e) {}
          try { if (typeof buzz === 'function') buzz([80, 60, 100]); } catch (e) {}
          if (onSuccess) onSuccess();
          // Show the new guild's modal — and show the share code!
          showToast('🎉 הקלאן נוצר! קוד שיתוף: ' + (d.guild && d.guild.code), 'success');
          fetchGuildState(true).then(function(fresh) {
            if (fresh) {
              maybeShowGuildTile();
              showGuildModal();
            }
          });
        } else {
          var reason = (d && d.reason) || 'unknown';
          var msg = {
            'insufficient_funds': '💎 חסר ביתרה (' + (d.price || 500) + '💎 נדרש)',
            'already_in_guild': 'אתה כבר בקלאן',
            'name_too_short': 'שם קצר מדי'
          }[reason] || ('שגיאה: ' + reason);
          setGuildStatus(msg, true);
        }
      });
  }

  function showGuildModal() {
    fetchGuildState(true).then(function(d) {
      if (!d || !d.ok || !d.enabled || !d.guild) return;
      renderGuildModal(d);
    });
  }

  function renderGuildModal(data) {
    var ex = document.getElementById('guild-modal');
    if (ex) ex.remove();
    var g = data.guild;
    var p = data.todayProgress;
    var members = data.members || [];
    var pct = p.target > 0 ? Math.min(100, Math.round((p.progress / p.target) * 100)) : 0;
    var membersHtml = members.map(function(m, idx) {
      var medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : ('#' + (idx + 1));
      var roleBadge = m.role === 'leader' ? ' <span class="guild-member-role">👑 מנהיג</span>' :
                       m.role === 'officer' ? ' <span class="guild-member-role">⭐ קצין</span>' : '';
      var meMark = m.isMe ? ' (אתה)' : '';
      var flag = m.country ? (String.fromCodePoint(0x1F1E6 + m.country.toUpperCase().charCodeAt(0) - 65) +
                String.fromCodePoint(0x1F1E6 + m.country.toUpperCase().charCodeAt(1) - 65) + ' ') : '';
      return '<div class="guild-member-row' + (m.isMe ? ' guild-member-me' : '') + '">' +
        '<span class="guild-member-rank">' + medal + '</span>' +
        '<span class="guild-member-name">' + flag + escapeHtml(m.name) + meMark + roleBadge + '</span>' +
        '<span class="guild-member-stats">👑 ' + m.crownsContrib + ' · ' + m.scoreContrib.toLocaleString() + '</span>' +
      '</div>';
    }).join('');
    var claimBtn = '';
    if (p.canClaim) {
      claimBtn = '<button class="guild-claim-btn" id="guild-claim-btn">🎁 קבל פרס יומי · ' + p.rewardPerMember + '💎</button>';
    } else if (p.claimed) {
      claimBtn = '<div class="guild-claim-done">✓ קיבלת היום — חזור מחר</div>';
    } else if (p.isComplete) {
      claimBtn = '<div class="guild-claim-done">✓ היעד הושלם · הפרס שלך נאסף</div>';
    } else {
      claimBtn = '<div class="guild-claim-locked">🔒 השלם יעד יומי כדי לקבל ' + p.rewardPerMember + '💎</div>';
    }
    var modal = document.createElement('div');
    modal.id = 'guild-modal';
    modal.className = 'guild-modal-overlay';
    modal.innerHTML =
      '<div class="guild-modal-card guild-modal-card-mine">' +
        '<button class="guild-modal-close" aria-label="סגור">×</button>' +
        '<div class="guild-modal-header">' +
          '<div class="guild-modal-emoji">' + (g.emoji || '🛡') + '</div>' +
          '<div class="guild-modal-name">' + escapeHtml(g.name) + '</div>' +
          '<div class="guild-modal-code">קוד: <strong>' + g.code + '</strong></div>' +
          '<div class="guild-modal-stats">' + g.memberCount + ' / ' + g.maxMembers + ' חברים · ' + (parseInt(g.totalScoreAlltime, 10) || 0).toLocaleString() + ' ניקוד בסך הכל</div>' +
        '</div>' +

        '<div class="guild-modal-goal">' +
          '<div class="guild-modal-goal-title">🎯 יעד יומי: ' + p.progress + ' / ' + p.target + ' כתרים</div>' +
          '<div class="guild-modal-goal-bar"><div class="guild-modal-goal-bar-fill" style="width:' + pct + '%"></div></div>' +
          claimBtn +
        '</div>' +

        '<div class="guild-modal-section-title">👥 חברי הקלאן (לפי תרומה)</div>' +
        '<div class="guild-modal-members">' + membersHtml + '</div>' +

        '<div class="guild-modal-foot">' +
          '<button class="guild-modal-share" id="guild-share-code">📤 שתף קוד הקלאן</button>' +
          '<button class="guild-modal-leave" id="guild-leave-btn">🚪 צא מהקלאן</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.guild-modal-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    if (p.canClaim) {
      document.getElementById('guild-claim-btn').onclick = function() { doGuildClaim(); };
    }
    document.getElementById('guild-share-code').onclick = function() {
      var text = '🛡 הצטרף לקלאן שלי ב-BLOOM!\nקוד: ' + g.code + '\nhttps://bloom-web-production-f3bd.up.railway.app';
      if (navigator.share) {
        navigator.share({ text: text }).catch(function() {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function() {
          var btn = document.getElementById('guild-share-code');
          btn.textContent = '✓ הועתק!';
          setTimeout(function() { btn.textContent = '📤 שתף קוד הקלאן'; }, 1800);
        });
      }
    };
    document.getElementById('guild-leave-btn').onclick = async function() {
      var ok = (typeof window.__bloomConfirm === 'function')
        ? await window.__bloomConfirm('לעזוב את הקלאן "' + g.name + '"?', { icon: '🛡', danger: true, confirmText: 'עזוב' })
        : confirm('בטוח שאתה רוצה לעזוב את "' + g.name + '"?');
      if (!ok) return;
      doGuildLeave(close);
    };
  }

  function doGuildClaim() {
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    var btn = document.getElementById('guild-claim-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
    fetch('/api/guilds/claim-daily', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token })
    }).then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) {
          if (typeof d.newBalance === 'number') {
            try { if (typeof playerBalance !== 'undefined') playerBalance = d.newBalance; } catch (e) {}
            try { if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(); } catch (e) {}
          }
          try { if (typeof soundMilestone === 'function') soundMilestone(5); } catch (e) {}
          try { if (typeof buzz === 'function') buzz([80, 60, 100, 60, 120]); } catch (e) {}
          _guildCache.data = null;
          fetchGuildState(true).then(function(fresh) {
            if (fresh) {
              renderGuildModal(fresh);
              maybeShowGuildTile();
            }
          });
        } else {
          if (btn) { btn.disabled = false; btn.textContent = '🎁 קבל פרס יומי'; }
          showToast(d && d.reason ? d.reason : 'שגיאה', 'error');
        }
      });
  }

  function doGuildLeave(onSuccess) {
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    fetch('/api/guilds/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token })
    }).then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) {
          _guildCache.data = null;
          if (onSuccess) onSuccess();
          var tile = document.getElementById('guild-home-tile');
          if (tile) tile.remove();
          maybeShowGuildTile();
        } else {
          showToast(d && d.reason ? d.reason : 'שגיאה', 'error');
        }
      });
  }

  window.maybeShowGuildTile = maybeShowGuildTile;
  window.showGuildModal = showGuildModal;
  window.showGuildJoinCreateModal = showGuildJoinCreateModal;
  window.contributeToGuild = contributeToGuild;
  window.fetchGuildState = fetchGuildState;
})();
