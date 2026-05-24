// ============================================================
// Stage 28 — Pet / Mascot (May 2026)
// A flower-pet that grows with the player. Tamagotchi pattern.
// 4 evolution stages (sprout → sapling → bloom → king-bloom).
// 4 moods (happy / neutral / sad / crying) based on time since visit.
// Daily pet (free, +gems) + feed (gems, +xp). XP also granted from games.
// ============================================================
(function() {
  var MOOD_LABELS = {
    happy:   { emoji: '😊', label: 'שמח',     color: '#10B981' },
    neutral: { emoji: '😐', label: 'בסדר',    color: '#F59E0B' },
    sad:     { emoji: '😢', label: 'עצוב',    color: '#3B82F6' },
    crying:  { emoji: '😭', label: 'בוכה',    color: '#DC2626' }
  };
  var _petCache = { data: null, fetchedAt: 0 };
  var _petInFlight = false;

  function fetchPetState(force) {
    if (!force && _petCache.data && (Date.now() - _petCache.fetchedAt) < 60000) {
      return Promise.resolve(_petCache.data);
    }
    if (_petInFlight) return Promise.resolve(_petCache.data);
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    if (!deviceId) return Promise.resolve(null);
    _petInFlight = true;
    return fetch('/api/pet/state?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        _petInFlight = false;
        if (d && d.ok) {
          _petCache.data = d;
          _petCache.fetchedAt = Date.now();
        }
        return d;
      });
  }

  function maybeShowPetWidget() {
    // T1.1 — Pet widget unlocks at L8 (alongside Daily Deal). Below that
    // a new player has too many tiles already; pet is emotional but not
    // the first dopamine surface they should meet.
    try { if (typeof getPlayerLevel === 'function' && getPlayerLevel() < 8) return; } catch (e) {}
    fetchPetState(false).then(function(d) {
      if (!d || !d.ok || !d.enabled) return;
      var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
      if (!home) return;
      if (document.getElementById('pet-home-widget')) {
        updatePetWidget(d);
        return;
      }
      mountPetWidget(home, d);
    });
  }

  function renderWidgetInner(data) {
    var mood = MOOD_LABELS[data.mood] || MOOD_LABELS.happy;
    var stageEmoji = (data.stage && data.stage.emoji) || '🌱';
    var nameHtml = data.name
      ? escapeHtml(data.name)
      : '<span style="opacity:0.7">תן לי שם!</span>';
    var dotsHtml = '';
    if (data.canPet || data.canFeed) {
      var dots = [];
      if (data.canPet) dots.push('💗');
      if (data.canFeed) dots.push('🍽');
      dotsHtml = '<span class="pet-widget-dots">' + dots.join(' ') + '</span>';
    }
    var moodClass = data.mood === 'crying' || data.mood === 'sad' ? ' pet-widget-needs-attention' : '';
    return (
      '<div class="pet-widget-emoji">' + stageEmoji + '</div>' +
      '<div class="pet-widget-body">' +
        '<div class="pet-widget-name">' + nameHtml + '<span class="pet-widget-mood">' + mood.emoji + '</span></div>' +
        '<div class="pet-widget-meta">דרגה ' + data.level + ' · ' + (data.stage && data.stage.label || '') + dotsHtml + '</div>' +
      '</div>'
    );
  }

  function mountPetWidget(homeEl, data) {
    var w = document.createElement('div');
    w.id = 'pet-home-widget';
    w.className = 'pet-home-widget';
    if (data.mood === 'crying' || data.mood === 'sad') w.classList.add('pet-widget-needs-attention');
    w.innerHTML = renderWidgetInner(data);
    // Insert after lives widget, before checklist tile (keeps checklist primary).
    var lives = document.getElementById('lives-home-widget');
    var checklist = document.getElementById('checklist-home-tile');
    var anchor = checklist || (lives && lives.nextSibling) || homeEl.firstChild;
    homeEl.insertBefore(w, anchor);
    w.onclick = function() {
      if (!data.name) {
        promptForPetName();
      } else {
        showPetModal(_petCache.data || data);
      }
    };
  }

  function updatePetWidget(data) {
    var w = document.getElementById('pet-home-widget');
    if (!w) return;
    w.className = 'pet-home-widget';
    if (data.mood === 'crying' || data.mood === 'sad') w.classList.add('pet-widget-needs-attention');
    w.innerHTML = renderWidgetInner(data);
  }

  function promptForPetName() {
    var ov = document.createElement('div');
    ov.id = 'pet-name-overlay';
    ov.className = 'pet-name-overlay';
    ov.innerHTML =
      '<div class="pet-name-card">' +
        '<div class="pet-name-emoji">🌱</div>' +
        '<div class="pet-name-title">תן לי שם!</div>' +
        '<div class="pet-name-sub">הפרח שלך יגדל איתך — איך תקרא לו?</div>' +
        '<input type="text" id="pet-name-input" class="pet-name-input" maxlength="20" placeholder="לדוגמה: פריחה, בלום, אורי..." />' +
        '<button class="pet-name-save" id="pet-name-save">💗 הצב שם</button>' +
        '<button class="pet-name-skip" id="pet-name-skip">דלג</button>' +
      '</div>';
    document.body.appendChild(ov);
    var close = function() { try { ov.remove(); } catch (e) {} };
    document.getElementById('pet-name-skip').onclick = close;
    ov.addEventListener('click', function(e) { if (e.target === ov) close(); });
    var input = document.getElementById('pet-name-input');
    if (input) setTimeout(function() { input.focus(); }, 80);
    document.getElementById('pet-name-save').onclick = function() {
      var name = input.value.trim();
      if (!name) { input.focus(); return; }
      var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
      var token = (typeof deviceToken !== 'undefined') ? deviceToken : null;
      fetch('/api/pet/name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId, token: token, name: name })
      })
        .then(function(r) { return r.json(); })
        .catch(function() { return null; })
        .then(function(d) {
          close();
          if (d && d.ok) {
            if (_petCache.data) {
              _petCache.data.name = d.name;
              _petCache.data.needsName = false;
              updatePetWidget(_petCache.data);
            } else {
              fetchPetState(true).then(function(fresh) { if (fresh) updatePetWidget(fresh); });
            }
            try { if (typeof soundMilestone === 'function') soundMilestone(3); } catch (e) {}
            try { if (typeof buzz === 'function') buzz([40, 30, 60]); } catch (e) {}
            // Auto-open the pet modal right after naming.
            setTimeout(function() { fetchPetState(true).then(function(d) { if (d) showPetModal(d); }); }, 400);
          }
        });
    };
  }

  function showPetModal(data) {
    var ex = document.getElementById('pet-modal');
    if (ex) ex.remove();
    var mood = MOOD_LABELS[data.mood] || MOOD_LABELS.happy;
    var stageEmoji = (data.stage && data.stage.emoji) || '🌱';
    var stageLabel = (data.stage && data.stage.label) || 'נבט';
    var xpPct = data.xpPerLevel > 0
      ? Math.round((data.xpIntoLevel / data.xpPerLevel) * 100)
      : 0;
    var bal = (typeof playerBalance !== 'undefined') ? playerBalance : 0;
    var canAffordFeed = bal >= data.feedPrice;
    var modal = document.createElement('div');
    modal.id = 'pet-modal';
    modal.className = 'pet-modal-overlay';
    modal.innerHTML =
      '<div class="pet-modal-card">' +
        '<button class="pet-modal-close" aria-label="סגור">×</button>' +
        '<div class="pet-modal-emoji-area">' +
          '<div class="pet-modal-emoji" id="pet-modal-emoji">' + stageEmoji + '</div>' +
          '<div class="pet-modal-mood" style="color:' + mood.color + '">' + mood.emoji + ' ' + mood.label + '</div>' +
        '</div>' +
        '<div class="pet-modal-name">' + escapeHtml(data.name || 'הפרח שלך') + '</div>' +
        '<div class="pet-modal-stage">' + stageLabel + ' · דרגה ' + data.level + ' / ' + data.maxLevel + '</div>' +
        '<div class="pet-modal-bar"><div class="pet-modal-bar-fill" style="width:' + xpPct + '%"></div></div>' +
        '<div class="pet-modal-xp-text">' + data.xpIntoLevel + ' / ' + data.xpPerLevel + ' XP · עוד ' + data.xpToNext + ' לדרגה הבאה</div>' +

        // Mood-based message
        '<div class="pet-modal-msg pet-modal-msg-' + data.mood + '">' +
          (data.mood === 'happy'   ? '💗 הפרח שלך שמח שאתה כאן!' :
           data.mood === 'neutral' ? '👋 הפרח שלך מחכה לראות אותך' :
           data.mood === 'sad'     ? '😢 הפרח שלך עצוב... שיחקת לאחרונה?' :
                                     '😭 הפרח שלך בוכה ממך! אל תעזוב יותר') +
        '</div>' +

        // Actions
        '<div class="pet-modal-actions">' +
          '<button class="pet-modal-action pet-modal-action-pet ' + (data.canPet ? '' : 'disabled') + '" id="pet-action-pet">' +
            '<div class="pet-modal-action-icon">💗</div>' +
            '<div class="pet-modal-action-label">' + (data.canPet ? 'ליטוף יומי' : 'כבר ליטפת היום') + '</div>' +
            '<div class="pet-modal-action-sub">' + (data.canPet ? '+' + data.dailyPetReward + '💎' : 'חוזר מחר') + '</div>' +
          '</button>' +
          '<button class="pet-modal-action pet-modal-action-feed ' + (data.canFeed && canAffordFeed ? '' : 'disabled') + '" id="pet-action-feed">' +
            '<div class="pet-modal-action-icon">🍽</div>' +
            '<div class="pet-modal-action-label">האכל</div>' +
            '<div class="pet-modal-action-sub">' + data.feedPrice + '💎 → +' + data.feedXpReward + ' XP (' + data.feedsToday + '/' + data.feedsPerDay + ')</div>' +
          '</button>' +
        '</div>' +
        '<div class="pet-modal-stats">' +
          '🌟 ' + data.totalPetCount + ' ליטופים · 🍽 ' + data.totalFedCount + ' האכלות' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.pet-modal-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    var petBtn = document.getElementById('pet-action-pet');
    if (petBtn && data.canPet) petBtn.onclick = function() { doPetAction(petBtn); };
    var feedBtn = document.getElementById('pet-action-feed');
    if (feedBtn && data.canFeed && canAffordFeed) feedBtn.onclick = function() { doFeedAction(feedBtn); };
  }

  function doPetAction(btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳'; }
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    fetch('/api/pet/pet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token })
    })
      .then(function(r) { return r.json(); })
      .catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) {
          if (typeof d.newBalance === 'number') {
            try { if (typeof playerBalance !== 'undefined') playerBalance = d.newBalance; } catch (e) {}
            try { if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(); } catch (e) {}
          }
          try { if (typeof soundMilestone === 'function') soundMilestone(3); } catch (e) {}
          try { if (typeof buzz === 'function') buzz([40, 30, 60]); } catch (e) {}
          // Heart burst animation
          showPetHeartBurst();
          fetchPetState(true).then(function(fresh) {
            if (fresh) {
              updatePetWidget(fresh);
              // Re-render modal with updated state.
              setTimeout(function() { showPetModal(fresh); }, 400);
            }
          });
        } else {
          if (btn) btn.disabled = false;
          showToast(d && d.reason === 'already_petted_today' ? 'כבר ליטפת היום!' : 'שגיאה', d && d.reason === 'already_petted_today' ? 'info' : 'error');
        }
      });
  }

  function doFeedAction(btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳'; }
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    fetch('/api/pet/feed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token })
    })
      .then(function(r) { return r.json(); })
      .catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) {
          if (typeof d.newBalance === 'number') {
            try { if (typeof playerBalance !== 'undefined') playerBalance = d.newBalance; } catch (e) {}
            try { if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(); } catch (e) {}
          }
          try { if (typeof soundMilestone === 'function') soundMilestone(d.leveledUp ? 5 : 3); } catch (e) {}
          try { if (typeof buzz === 'function') buzz(d.leveledUp ? [80, 60, 100, 60, 120] : [40, 30, 60]); } catch (e) {}
          showPetSparkleBurst();
          if (d.leveledUp) {
            showPetLevelUpToast(d.newLevel, d.stage);
          }
          fetchPetState(true).then(function(fresh) {
            if (fresh) {
              updatePetWidget(fresh);
              setTimeout(function() { showPetModal(fresh); }, 400);
            }
          });
        } else {
          if (btn) btn.disabled = false;
          if (d && d.reason === 'insufficient_funds') {
            showToast('💎 חסר ' + ((d.price || 0) - (d.balance || 0)) + '💎', 'warning');
          } else if (d && d.reason === 'daily_limit_reached') {
            showToast('🍽 הגעת למקסימום האכלות יומי (' + d.feedsPerDay + ')', 'info');
          } else {
            showToast('שגיאה', 'error');
          }
        }
      });
  }

  function showPetHeartBurst() {
    var emoji = document.getElementById('pet-modal-emoji');
    if (!emoji) return;
    for (var i = 0; i < 6; i++) {
      var heart = document.createElement('div');
      heart.className = 'pet-heart-burst';
      heart.textContent = '💗';
      var angle = (Math.PI * 2 / 6) * i + Math.random() * 0.3;
      heart.style.setProperty('--dx', Math.cos(angle) * 60 + 'px');
      heart.style.setProperty('--dy', Math.sin(angle) * 60 + 'px');
      heart.style.animationDelay = (i * 50) + 'ms';
      emoji.appendChild(heart);
      setTimeout((function(h) { return function() { try { h.remove(); } catch (e) {} }; })(heart), 1500);
    }
  }

  function showPetSparkleBurst() {
    var emoji = document.getElementById('pet-modal-emoji');
    if (!emoji) return;
    for (var i = 0; i < 8; i++) {
      var s = document.createElement('div');
      s.className = 'pet-sparkle-burst';
      s.textContent = '✨';
      var angle = (Math.PI * 2 / 8) * i;
      s.style.setProperty('--dx', Math.cos(angle) * 70 + 'px');
      s.style.setProperty('--dy', Math.sin(angle) * 70 + 'px');
      s.style.animationDelay = (i * 35) + 'ms';
      emoji.appendChild(s);
      setTimeout((function(h) { return function() { try { h.remove(); } catch (e) {} }; })(s), 1400);
    }
  }

  function showPetLevelUpToast(newLevel, stage) {
    var t = document.createElement('div');
    t.className = 'pet-levelup-toast';
    t.innerHTML =
      '<div class="pet-levelup-icon">' + (stage && stage.emoji || '🌱') + '</div>' +
      '<div class="pet-levelup-body">' +
        '<div class="pet-levelup-title">🎉 הפרח שלך עלה דרגה!</div>' +
        '<div class="pet-levelup-sub">דרגה ' + newLevel + ' · ' + (stage && stage.label || '') + '</div>' +
      '</div>';
    document.body.appendChild(t);
    setTimeout(function() { try { t.remove(); } catch (e) {} }, 3500);
  }

  // Public: called from game-over flow to grant pet XP server-side.
  function grantPetXpForGame(gameId) {
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    if (!deviceId) return Promise.resolve(null);
    return fetch('/api/pet/grant-xp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token, gameId: gameId })
    })
      .then(function(r) { return r.json(); })
      .catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok && d.leveledUp) {
          // Schedule a toast after game-over UI settles.
          setTimeout(function() {
            var stage = (function() {
              if (d.newLevel >= 16) return { emoji: '🌺', label: 'מלך פריחה' };
              if (d.newLevel >= 11) return { emoji: '🌸', label: 'פריחה מלאה' };
              if (d.newLevel >= 6)  return { emoji: '🌿', label: 'שתיל' };
              return { emoji: '🌱', label: 'נבט' };
            })();
            showPetLevelUpToast(d.newLevel, stage);
          }, 5500);
          // Invalidate cache so home widget shows the new level on return.
          _petCache.data = null;
        }
        return d;
      });
  }

  window.maybeShowPetWidget = maybeShowPetWidget;
  window.showPetModal = showPetModal;
  window.grantPetXpForGame = grantPetXpForGame;
  window.fetchPetState = fetchPetState;
})();
