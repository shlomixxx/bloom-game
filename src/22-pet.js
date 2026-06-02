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
    // UX audit 2026-06-02 — actionable guilt: when the pet is sad/crying the
    // widget pulsed red but tapping only opened the modal. Now it carries a
    // one-tap direct CTA so the loss-aversion is something the player can
    // resolve instantly ("feed me now" Tamagotchi pattern).
    var ctaHtml = '';
    if (data.mood === 'crying' || data.mood === 'sad') {
      if (data.canPet) ctaHtml = '<button class="pet-widget-cta" data-petcta="pet">💗 ליטוף עכשיו · הרגע אותו</button>';
      else if (data.canFeed) ctaHtml = '<button class="pet-widget-cta" data-petcta="feed">🍽 האכל אותי עכשיו</button>';
    }
    return (
      '<div class="pet-widget-emoji">' + stageEmoji + '</div>' +
      '<div class="pet-widget-body">' +
        '<div class="pet-widget-name">' + nameHtml + '<span class="pet-widget-mood">' + mood.emoji + '</span></div>' +
        '<div class="pet-widget-meta">דרגה ' + data.level + ' · ' + (data.stage && data.stage.label || '') + dotsHtml + '</div>' +
      '</div>' +
      ctaHtml
    );
  }
  // Wire the needs-attention CTA (stopPropagation so it doesn't also open
  // the modal). pet → instant inline pet; feed → open the modal (cost-aware).
  function wireWidgetCta(w) {
    if (!w) return;
    var cta = w.querySelector('.pet-widget-cta');
    if (!cta) return;
    cta.onclick = function(e) {
      e.stopPropagation();
      if (cta.getAttribute('data-petcta') === 'pet') quickPetFromWidget(cta);
      else if (_petCache.data) showPetModal(_petCache.data);
    };
  }
  // One-tap pet straight from the home widget — instant relief + reward,
  // no modal hop. Mirrors doPetAction's server flow, widget-scoped UI.
  function quickPetFromWidget(btn) {
    if (!btn || btn._busy) return;
    btn._busy = true;
    var orig = btn.textContent;
    btn.textContent = '⏳';
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    fetch('/api/pet/pet', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token })
    })
      .then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) {
          if (typeof d.newBalance === 'number') {
            try { if (typeof playerBalance !== 'undefined') playerBalance = d.newBalance; } catch (e) {}
            try { if (typeof window.__bloomBumpBal === 'function') window.__bloomBumpBal(d.newBalance, d.reward || 0); } catch (e) {}
          }
          try { if (typeof soundMilestone === 'function') soundMilestone(5); } catch (e) {}
          try { if (typeof buzz === 'function') buzz([60, 40, 80]); } catch (e) {}
          try { if (typeof showToast === 'function') showToast('💗 ליטפת! הפרח שלך מחייך עכשיו · +' + (d.reward || 20) + '💎', 'success'); } catch (e) {}
          fetchPetState(true).then(function(fresh) { if (fresh) updatePetWidget(fresh); });
        } else {
          btn._busy = false; btn.textContent = orig;
          var reason = d && d.reason;
          if (reason === 'already_petted_today') {
            if (typeof showToast === 'function') showToast('💗 כבר ליטפת היום! בוא מחר', 'info');
            fetchPetState(true).then(function(fresh) { if (fresh) updatePetWidget(fresh); });
          } else if (typeof showToast === 'function') {
            showToast('שגיאה — נסה שוב', 'error');
          }
        }
      });
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
    // insertBefore REQUIRES anchor to be a direct child of homeEl. The
    // bottom-nav (src/46) routes tiles like checklist/lives into other tab
    // panels, so they can exist in the DOM but NOT be children of homeEl —
    // then insertBefore throws "The object can not be found here." (Safari)
    // / "node ... is not a child of this node" (Chrome). 106 such crashes in
    // the issues tab. Guard the anchor; fall back to append.
    if (anchor && anchor.parentNode === homeEl) {
      homeEl.insertBefore(w, anchor);
    } else {
      homeEl.appendChild(w);
    }
    w.onclick = function() {
      if (!data.name) {
        promptForPetName();
      } else {
        showPetModal(_petCache.data || data);
      }
    };
    wireWidgetCta(w);
  }

  function updatePetWidget(data) {
    var w = document.getElementById('pet-home-widget');
    if (!w) return;
    w.className = 'pet-home-widget';
    if (data.mood === 'crying' || data.mood === 'sad') w.classList.add('pet-widget-needs-attention');
    w.innerHTML = renderWidgetInner(data);
    wireWidgetCta(w);
  }

  function promptForPetName() {
    var ov = document.createElement('div');
    ov.id = 'pet-name-overlay';
    ov.className = 'pet-name-overlay';
    ov.innerHTML =
      '<div class="pet-name-card">' +
        '<button class="pet-name-close" aria-label="סגור">×</button>' +
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
    var nameCloseBtn = ov.querySelector('.pet-name-close');
    if (nameCloseBtn) nameCloseBtn.onclick = close;
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
            // Task #17 — cross-system link payoff: the server unlocked the
            // "Gardener" achievement → surface the ecosystem moment (rank bump)
            // so naming the pet feels connected to the wider game, not isolated.
            if (d.gardenerUnlocked) {
              var rankTxt = d.achRank ? ' · אתה #' + d.achRank + ' בלוח ההישגים' : '';
              try { if (typeof showToast === 'function') showToast('🌱 הישג חדש: גנן! נתת שם לחיית המחמד' + rankTxt, 'success'); } catch (e) {}
              try { if (typeof window.__bloomConfetti === 'function') window.__bloomConfetti(20); } catch (e) {}
              try { if (typeof soundMilestone === 'function') setTimeout(function() { soundMilestone(5); }, 320); } catch (e) {}
            }
            // Auto-open the pet modal right after naming.
            setTimeout(function() { fetchPetState(true).then(function(d) { if (d) showPetModal(d); }); }, 400);
          }
        });
    };
  }

  // UX audit 2026-06-02 — evolution anticipation: tease the NEXT stage so the
  // modal pulls progression ("2 more levels to full bloom 🌸") instead of only
  // showing the current state. Stage thresholds mirror the server (6/11/16).
  function nextStageInfo(level) {
    var stages = [
      { at: 6,  emoji: '🌿', label: 'שתיל' },
      { at: 11, emoji: '🌸', label: 'פריחה מלאה' },
      { at: 16, emoji: '🌺', label: 'מלך פריחה' }
    ];
    for (var i = 0; i < stages.length; i++) {
      if (level < stages[i].at) return { emoji: stages[i].emoji, label: stages[i].label, toGo: stages[i].at - level };
    }
    return null;
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

        // Next-stage evolution tease (UX audit 2026-06-02)
        (function() {
          var ns = nextStageInfo(data.level);
          return ns
            ? '<div class="pet-modal-next-stage">' + ns.emoji + ' עוד ' + ns.toGo + ' דרגות ל' + ns.label + '!</div>'
            : '<div class="pet-modal-next-stage pet-modal-next-stage-max">👑 הפרח שלך הגיע לשיא הפריחה!</div>';
        })() +

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
    // 2026-05-26: mark the modal as currently open so the post-action
    // setTimeout that re-shows the modal can be cancelled when the
    // user closes mid-flight (previously the modal popped up every
    // second after every action).
    _petModalOpen = true;
    var close = function() {
      _petModalOpen = false;
      // Cancel any pending re-show timer.
      if (_pendingReshowTimer) { clearTimeout(_pendingReshowTimer); _pendingReshowTimer = null; }
      try { modal.remove(); } catch (e) {}
    };
    modal.querySelector('.pet-modal-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    // 2026-05-26: ALWAYS wire onclick for both buttons. If canPet=false
    // we still want the click to fire a toast "כבר ליטפת היום!" instead
    // of the click being silently absorbed (the user's bug — they
    // clicked "ליטוף יומי" but the count stayed at 0 because data.canPet
    // had drifted to false due to stale cache or earlier race).
    var petBtn = document.getElementById('pet-action-pet');
    if (petBtn) {
      petBtn.onclick = function() {
        if (!data.canPet) {
          // Don't fire fetch — server would reject anyway. But show
          // user-friendly toast so the click feels acknowledged.
          if (typeof showToast === 'function') showToast('💗 כבר ליטפת היום! בוא מחר', 'info');
          return;
        }
        doPetAction(petBtn);
      };
    }
    var feedBtn = document.getElementById('pet-action-feed');
    if (feedBtn) {
      feedBtn.onclick = function() {
        if (!data.canFeed) {
          if (typeof showToast === 'function') showToast('🍽 הגעת למקסימום האכלות יומי (' + data.feedsPerDay + ')', 'info');
          return;
        }
        if (!canAffordFeed) {
          if (typeof showToast === 'function') showToast('💎 חסר ' + (data.feedPrice - bal) + '💎 כדי להאכיל', 'warning');
          return;
        }
        doFeedAction(feedBtn);
      };
    }
  }

  // 2026-05-26: shared state for cancelling the re-show timer when
  // the modal closes. Without this the setTimeout fired regardless,
  // re-creating the modal even after the user clicked ✕.
  var _petModalOpen = false;
  var _pendingReshowTimer = null;

  // 2026-05-26: rewrote the pet/feed action handlers because the old
  // flow looked broken to the user:
  //   • Success path: only tiny heart burst (60px area) + sound + no
  //     toast → player clicked button, saw nothing change in the modal
  //     for ~500ms while waiting for re-render. Thought it didn't work.
  //   • Error path: btn left as '⏳' forever (only btn.disabled reset).
  //     Subsequent clicks also did nothing because the button looked
  //     "loading". Hence "לוחץ ולא קורה כלום".
  //
  // New flow:
  //   • Save original innerHTML before swapping to ⏳ so we can restore
  //     on error.
  //   • On success: swap button to "✓ קיבלת +20💎" + show floating +N
  //     badge inside the modal. THIS is the dopamine moment.
  //   • On error: restore original innerHTML + show toast.
  function doPetAction(btn) {
    if (!btn) return;
    var originalHtml = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<div style="font-size:24px">⏳</div>';
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
            try { if (typeof window.__bloomBumpBal === 'function') window.__bloomBumpBal(d.newBalance, d.reward || 0); } catch (e) {}
          }
          try { if (typeof soundMilestone === 'function') soundMilestone(5); } catch (e) {}
          try { if (typeof buzz === 'function') buzz([60, 40, 80, 40, 120]); } catch (e) {}
          showPetHeartBurst();
          // Immediate visual confirmation BEFORE the modal re-render.
          var reward = d.reward || 20;
          btn.innerHTML =
            '<div style="font-size:28px">✓</div>' +
            '<div style="font-weight:900;font-size:13px">קיבלת!</div>' +
            '<div style="color:#FFD700;font-weight:800;font-size:14px">+' + reward + '💎</div>';
          showPetRewardFloater(reward);
          fetchPetState(true).then(function(fresh) {
            if (fresh) {
              updatePetWidget(fresh);
              // 2026-05-26: only re-show the modal if the player
              // hasn't already closed it. Track via _pendingReshowTimer
              // so the close handler can cancel.
              if (_pendingReshowTimer) clearTimeout(_pendingReshowTimer);
              _pendingReshowTimer = setTimeout(function() {
                _pendingReshowTimer = null;
                if (_petModalOpen) showPetModal(fresh);
              }, 1500);
            }
          });
        } else {
          // Restore original button content so player can see what state
          // the button is in instead of being stuck on '⏳'.
          btn.disabled = false;
          btn.innerHTML = originalHtml;
          var reason = d && d.reason;
          if (reason === 'already_petted_today') {
            if (typeof showToast === 'function') showToast('💗 כבר ליטפת היום! בוא מחר', 'info');
          } else if (reason === 'disabled') {
            if (typeof showToast === 'function') showToast('הפיצ׳ר כבוי כרגע', 'warning');
          } else {
            if (typeof showToast === 'function') showToast('שגיאה — נסה שוב', 'error');
          }
          // Update widget but DON'T re-show the modal on error — that's
          // what created the "modal pops up every second" loop.
          fetchPetState(true).then(function(fresh) {
            if (fresh) updatePetWidget(fresh);
          });
        }
      });
  }

  // Big "+N💎" badge that floats up from the modal center. Used by
  // both pet and feed actions so the dopamine moment is impossible
  // to miss even if the home-widget bump is off-screen.
  function showPetRewardFloater(amount) {
    var modal = document.getElementById('pet-modal');
    if (!modal) return;
    var card = modal.querySelector('.pet-modal-card') || modal;
    var floater = document.createElement('div');
    // Accept (number) — formatted as +N💎 / -N💎, or (string) — used as-is.
    var isNumber = (typeof amount === 'number');
    var text, color;
    if (isNumber) {
      text = (amount < 0 ? '' : '+') + amount + '💎';
      color = amount < 0 ? '#E84A5F' : '#FFD700';
    } else {
      text = String(amount);
      color = '#9FE1CB';
    }
    floater.style.cssText =
      'position:absolute;top:42%;left:50%;transform:translate(-50%,-50%);' +
      'font-size:32px;font-weight:900;color:' + color + ';' +
      'text-shadow:0 4px 16px rgba(0,0,0,0.6),0 0 24px rgba(255,215,0,0.7);' +
      'pointer-events:none;z-index:1000;direction:ltr;' +
      'animation:petRewardFloat 1.5s ease-out forwards';
    floater.textContent = text;
    if (!document.getElementById('pet-reward-floater-style')) {
      var st = document.createElement('style');
      st.id = 'pet-reward-floater-style';
      st.textContent = '@keyframes petRewardFloat{0%{opacity:0;transform:translate(-50%,-30%) scale(0.5)}20%{opacity:1;transform:translate(-50%,-50%) scale(1.15)}60%{opacity:1;transform:translate(-50%,-90%) scale(1)}100%{opacity:0;transform:translate(-50%,-160%) scale(0.85)}}';
      document.head.appendChild(st);
    }
    if (card.style.position !== 'absolute' && card.style.position !== 'relative') {
      card.style.position = 'relative';
    }
    card.appendChild(floater);
    setTimeout(function() { try { floater.remove(); } catch (e) {} }, 1600);
  }

  function doFeedAction(btn) {
    if (!btn) return;
    var originalHtml = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<div style="font-size:24px">⏳</div>';
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
            try { if (typeof window.__bloomBumpBal === 'function') window.__bloomBumpBal(d.newBalance, -(d.feedCost || 0)); } catch (e) {}
          }
          try { if (typeof soundMilestone === 'function') soundMilestone(d.leveledUp ? 7 : 5); } catch (e) {}
          try { if (typeof buzz === 'function') buzz(d.leveledUp ? [80, 60, 100, 60, 120, 60, 160] : [60, 40, 80, 40, 100]); } catch (e) {}
          showPetSparkleBurst();
          // Visible confirmation: -N💎 (spend) and +N XP, plus level-up.
          var spent = d.feedCost || 10;
          var xpGain = d.xpGain || 50;
          btn.innerHTML =
            '<div style="font-size:28px">✓</div>' +
            '<div style="font-weight:900;font-size:13px">האכלת!</div>' +
            '<div style="color:#9FE1CB;font-weight:800;font-size:13px">+' + xpGain + ' XP</div>';
          showPetRewardFloater(-spent);
          setTimeout(function() { showPetRewardFloater(xpGain + ' XP'); }, 350);
          if (d.leveledUp) {
            showPetLevelUpToast(d.newLevel, d.stage);
          }
          fetchPetState(true).then(function(fresh) {
            if (fresh) {
              updatePetWidget(fresh);
              if (_pendingReshowTimer) clearTimeout(_pendingReshowTimer);
              _pendingReshowTimer = setTimeout(function() {
                _pendingReshowTimer = null;
                if (_petModalOpen) showPetModal(fresh);
              }, 1500);
            }
          });
        } else {
          btn.disabled = false;
          btn.innerHTML = originalHtml;
          if (d && d.reason === 'insufficient_funds') {
            if (typeof showToast === 'function') showToast('💎 חסר ' + ((d.price || 0) - (d.balance || 0)) + '💎', 'warning');
          } else if (d && d.reason === 'daily_limit_reached') {
            if (typeof showToast === 'function') showToast('🍽 הגעת למקסימום האכלות יומי (' + d.feedsPerDay + ')', 'info');
          } else {
            if (typeof showToast === 'function') showToast('שגיאה — נסה שוב', 'error');
          }
          fetchPetState(true).then(function(fresh) {
            if (fresh) updatePetWidget(fresh);
          });
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
