# הוראות לקלוד ב-Cursor — הוספת תחרויות חברים

## חשוב לקרוא לפני שמתחילים

זה פרויקט BLOOM של שלומי. המשתמש **כבר יש לו** מצב יומי עובד עם לוח מובילים גלובלי. **אל תשבור אותו.** המשימה היא להוסיף **בצדו** פיצ'ר חדש: תחרויות חברים פרטיות.

המבנה הקיים שאסור לפגוע בו:
- `public/index.html` — המשחק (1833 שורות)
- `server.js` — Express + 3 endpoints קיימים (תוחלף בגרסה חדשה שמכילה את הקיים + 4 חדשים)
- `db.js` — נשאר זהה
- `schema.sql` — תוחלף בגרסה שמכילה גם את הקיים + 2 טבלאות חדשות
- `package.json` — נשאר זהה

## משימה 1 — החלפת קבצי השרת

החלף את 2 הקבצים האלה בקבצים שצורפו לחבילה:

1. `server.js` — תוכן חדש, מכיל את כל ה-endpoints הקיימים בלי שינוי + 4 חדשים
2. `schema.sql` — תוכן חדש, מכיל את `daily_scores` הקיים + 2 טבלאות חדשות

**אל תיגע** ב-`db.js` ו-`package.json`.

## משימה 2 — עדכון `public/index.html`

הוסף את הפיצ'ר של תחרויות חברים. **לא לשכתב את הקובץ** — רק להוסיף את החלקים החדשים במקומות הספציפיים.

### 2.1 — הוסף `mode` חדש

מצא את השורה:
```javascript
if (mode === 'daily') {
```

יש כמה כאלה. אנחנו צריכים להוסיף `mode === 'contest'` שמתנהג דומה ל-`daily` אבל עם seed שונה ושליחת ציון ל-API שונה.

### 2.2 — הוסף state variables לתחרות

מצא את האזור עם הגדרת המשתנים הגלובליים (בערך אחרי `let leaderboard = [];` בשורה 1150). הוסף:

```javascript
// ============ FRIENDS CONTEST STATE ============
const CONTEST_CODE_KEY = 'bloom_active_contest';
let activeContestCode = localStorage.getItem(CONTEST_CODE_KEY) || null;
let activeContestData = null;
let contestSubmitted = false;
```

### 2.3 — הוסף פונקציות עזר לתחרות

הוסף את כל הבלוק הזה אחרי שאר פונקציות העזר (לפני `function init`):

```javascript
function setActiveContest(code) {
  activeContestCode = code || null;
  if (code) localStorage.setItem(CONTEST_CODE_KEY, code);
  else localStorage.removeItem(CONTEST_CODE_KEY);
}

function getPlayerName() {
  return localStorage.getItem(NAME_KEY) || '';
}

function setPlayerName(name) {
  if (name) localStorage.setItem(NAME_KEY, String(name).trim().slice(0, 50));
}

async function fetchContest(code) {
  try {
    const url = API_BASE + '/api/contests/' + encodeURIComponent(code) + '?deviceId=' + encodeURIComponent(deviceId);
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('fetchContest failed', e);
    return null;
  }
}

async function submitContestScore(code, scoreValue, tierValue) {
  try {
    const res = await fetch(API_BASE + '/api/contests/' + encodeURIComponent(code) + '/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: deviceId,
        displayName: getPlayerName() || 'אנונימי',
        score: scoreValue,
        tier: tierValue
      })
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('submitContestScore failed', e);
    return null;
  }
}

function buildContestShareLink(code) {
  const origin = window.location.origin + window.location.pathname;
  return origin + '?c=' + encodeURIComponent(code);
}

function formatTimeLeft(endsAt) {
  const ms = new Date(endsAt) - new Date();
  if (ms <= 0) return 'הסתיים';
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days > 0) return days + ' ימים';
  if (hours > 0) return hours + ' שעות';
  return 'פחות משעה';
}
```

### 2.4 — הוסף כפתור "תחרות חברים" במסך הבית

מצא ב-`function showHome()`:
```javascript
'<button class="home-start" id="home-start">בוא נתחיל</button>' +
'<button class="home-skip" id="home-skip">אני יודע לשחק, דלג</button>' +
```

החלף את שתי השורות האלה ב:
```javascript
'<button class="home-start" id="home-start">בוא נתחיל</button>' +
'<button class="home-contest" id="home-contest"><span class="home-contest-badge">חדש</span>תחרות חברים</button>' +
'<button class="home-skip" id="home-skip">אני יודע לשחק, דלג</button>' +
```

ובסוף הפונקציה (אחרי `document.getElementById('home-skip').onclick = enter;`) הוסף:
```javascript
const contestBtn = document.getElementById('home-contest');
if (contestBtn) contestBtn.onclick = function() {
  ensureAudio();
  showContestMenu();
};
```

### 2.5 — הוסף CSS לכפתור החדש

מצא את ה-CSS של `.home-skip` (שורה 420 בערך) ואחריו הוסף:

```css
.home-contest {
  width: 100%; max-width: 280px;
  margin-top: 10px;
  padding: 14px 18px; border-radius: 12px;
  background: #FFF5E1; color: #854F0B;
  border: 1px solid #FAC775;
  font-size: 14px; font-weight: 600;
  cursor: pointer; font-family: inherit;
  position: relative;
  transition: transform 0.12s;
}
.home-contest:active { transform: scale(0.98); }
.home-contest-badge {
  position: absolute;
  top: -8px; right: 14px;
  background: #EF9F27;
  color: #412402;
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
}

/* Contest screens - shared styles */
.contest-screen {
  position: absolute; inset: 0;
  background: linear-gradient(180deg, #F5F5F0 0%, #FFFFFF 100%);
  z-index: 50;
  padding: 30px 24px;
  overflow-y: auto;
  direction: rtl;
  display: flex; flex-direction: column;
}
.contest-back-btn {
  position: absolute;
  top: 16px; right: 16px;
  background: none;
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 8px;
  width: 34px; height: 34px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; padding: 0;
  z-index: 51;
}
.contest-back-btn svg { width: 16px; height: 16px; color: #6F6E68; }
.contest-title {
  font-size: 22px; font-weight: 700;
  color: #1C1A18; text-align: center;
  margin-top: 40px;
}
.contest-sub {
  font-size: 13px; color: #6F6E68;
  text-align: center; margin: 6px 0 24px;
  line-height: 1.5;
}
.contest-cards {
  display: flex; flex-direction: column; gap: 10px;
  width: 100%; max-width: 300px;
  margin: 0 auto;
}
.contest-card {
  background: #FAFAF6;
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 12px;
  padding: 16px;
  display: flex; align-items: center; gap: 14px;
  cursor: pointer; text-align: right;
}
.contest-card:hover { background: #F0EDE3; }
.contest-card:active { transform: scale(0.98); }
.contest-card-icon {
  width: 42px; height: 42px;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.contest-card-icon svg { width: 22px; height: 22px; }
.contest-card-title { font-size: 14px; font-weight: 600; color: #1C1A18; }
.contest-card-desc { font-size: 12px; color: #6F6E68; margin-top: 3px; line-height: 1.5; }

.contest-form { width: 100%; max-width: 300px; margin: 12px auto 0; }
.contest-form-label {
  font-size: 11px; font-weight: 600;
  color: #444441;
  margin-bottom: 5px;
  letter-spacing: 0.03em;
  text-align: right;
}
.contest-input {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid rgba(0,0,0,0.12);
  border-radius: 9px;
  background: #FAFAF6;
  font-size: 14px; color: #1C1A18;
  margin-bottom: 14px;
  font-family: inherit;
  direction: rtl;
}
.contest-input:focus { outline: 2px solid #FAC775; outline-offset: -1px; }
.contest-duration-row { display: flex; gap: 6px; margin-bottom: 16px; }
.contest-duration-pill {
  flex: 1; padding: 10px;
  border: 1px solid rgba(0,0,0,0.12);
  border-radius: 8px;
  background: #FAFAF6;
  text-align: center;
  font-size: 13px;
  color: #444441;
  cursor: pointer;
}
.contest-duration-pill.selected {
  background: #1C1A18;
  color: #FFFFFF;
  border-color: #1C1A18;
}
.contest-error {
  color: #C84040; font-size: 12px;
  text-align: center; margin-top: 10px;
  min-height: 16px;
}
.contest-submit-btn {
  width: 100%;
  padding: 14px;
  border-radius: 10px;
  background: #1C1A18; color: #FFFFFF;
  border: none;
  font-size: 14px; font-weight: 600;
  cursor: pointer; font-family: inherit;
  margin-top: 8px;
}
.contest-submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.contest-secondary-btn {
  width: 100%;
  padding: 12px;
  border-radius: 10px;
  background: transparent; color: #1C1A18;
  border: 1px solid rgba(0,0,0,0.12);
  font-size: 13px; font-weight: 500;
  cursor: pointer; font-family: inherit;
  margin-top: 8px;
}
.contest-ghost-btn {
  background: none; border: none;
  color: #A8A6A0; font-size: 13px;
  cursor: pointer; padding: 10px;
  font-family: inherit;
  margin-top: 6px;
}

/* Share screen */
.contest-link-card {
  background: #FFF5E1;
  border: 1px solid #FAC775;
  border-radius: 12px;
  padding: 16px;
  text-align: center;
  margin: 16px auto;
  max-width: 300px;
}
.contest-link-label {
  font-size: 10px; color: #854F0B;
  font-weight: 700; letter-spacing: 0.08em;
  margin-bottom: 6px;
}
.contest-link-code {
  font-size: 28px; font-weight: 700;
  color: #412402;
  letter-spacing: 0.2em;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
}
.contest-share-row {
  display: flex; gap: 6px;
  max-width: 300px; margin: 14px auto;
}
.contest-share-btn {
  flex: 1; padding: 12px 8px;
  border-radius: 9px;
  font-size: 12px; font-weight: 600;
  text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  border: none;
  cursor: pointer;
  font-family: inherit;
}
.contest-share-btn svg { width: 18px; height: 18px; }
.contest-share-wa { background: #DCF8C6; color: #1B5E20; }
.contest-share-copy { background: #F1EFE8; color: #444441; }

/* Leaderboard */
.contest-info-card {
  background: #FAFAF6;
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 10px;
  padding: 12px 14px;
  margin: 14px auto;
  max-width: 320px;
}
.contest-info-row {
  display: flex; justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  font-size: 13px;
  color: #1C1A18;
}
.contest-info-row span:first-child { color: #6F6E68; font-size: 12px; }
.contest-board {
  width: 100%; max-width: 340px;
  margin: 14px auto 0;
  display: flex; flex-direction: column;
  gap: 5px;
}
.contest-board-row {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 13px;
  border-radius: 10px;
  background: #FAFAF6;
}
.contest-board-row.first { background: #FFF5E1; }
.contest-board-row.me { background: #E1F5EE; }
.contest-board-rank {
  width: 28px; height: 28px;
  border-radius: 50%;
  background: #FFFFFF;
  border: 1px solid rgba(0,0,0,0.08);
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700;
  color: #444441;
  flex-shrink: 0;
}
.contest-board-row.first .contest-board-rank {
  background: #FAC775; color: #412402; border-color: #FAC775;
}
.contest-board-name {
  flex: 1; font-size: 14px; color: #1C1A18; font-weight: 500;
}
.contest-board-name small {
  color: #6F6E68; font-size: 10px;
  margin-right: 5px; font-weight: 400;
}
.contest-board-score {
  font-size: 14px; font-weight: 700;
  color: #1C1A18;
  font-variant-numeric: tabular-nums;
}
.contest-board-empty {
  text-align: center; padding: 20px;
  color: #6F6E68; font-size: 13px;
}
.contest-loading {
  text-align: center; padding: 40px;
  color: #6F6E68; font-size: 14px;
}
```

### 2.6 — הוסף את הפונקציות של המסכים החדשים

הוסף את כל הקוד הבא **אחרי** הפונקציה `hideHome()` (בערך שורה 1085):

```javascript
/* ============ FRIENDS CONTEST SCREENS ============ */

function hideContestScreens() {
  const el = document.getElementById('contest-screen');
  if (el) el.remove();
}

function createBackButton(onclick) {
  return '<button class="contest-back-btn" onclick="' + onclick + '" aria-label="חזור">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>' +
    '</button>';
}

function showContestMenu() {
  const app = document.querySelector('.app');
  hideContestScreens();
  hideHome();
  const screen = document.createElement('div');
  screen.id = 'contest-screen';
  screen.className = 'contest-screen';
  screen.innerHTML =
    createBackButton('window.__bloomBackToHome()') +
    '<div class="contest-title">תחרות חברים</div>' +
    '<div class="contest-sub">בחר את התפקיד שלך</div>' +
    '<div class="contest-cards">' +
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
}

window.__bloomBackToHome = function() {
  hideContestScreens();
  showHome();
};

function showCreateContestForm() {
  const screen = document.getElementById('contest-screen');
  if (!screen) return;
  screen.innerHTML =
    createBackButton('window.__bloomBackToContestMenu()') +
    '<div class="contest-title">תחרות חדשה</div>' +
    '<div class="contest-sub">פרטים בסיסיים בלבד</div>' +
    '<div class="contest-form">' +
      '<div class="contest-form-label">שם התחרות</div>' +
      '<input class="contest-input" id="ctf-name" placeholder="משפחת כהן · פסח" maxlength="100" />' +
      '<div class="contest-form-label">השם שלך בלוח</div>' +
      '<input class="contest-input" id="ctf-host" placeholder="סבא משה" maxlength="50" value="' + getPlayerName() + '" />' +
      '<div class="contest-form-label">משך התחרות</div>' +
      '<div class="contest-duration-row" id="ctf-duration">' +
        '<div class="contest-duration-pill" data-days="1">יום</div>' +
        '<div class="contest-duration-pill selected" data-days="7">שבוע</div>' +
        '<div class="contest-duration-pill" data-days="30">חודש</div>' +
      '</div>' +
      '<button class="contest-submit-btn" id="ctf-submit">צור והעתק קוד</button>' +
      '<div class="contest-error" id="ctf-error"></div>' +
    '</div>';

  let selectedDays = 7;
  document.querySelectorAll('#ctf-duration .contest-duration-pill').forEach(function(pill) {
    pill.onclick = function() {
      document.querySelectorAll('#ctf-duration .contest-duration-pill').forEach(function(p) { p.classList.remove('selected'); });
      pill.classList.add('selected');
      selectedDays = parseInt(pill.dataset.days, 10);
    };
  });

  document.getElementById('ctf-submit').onclick = async function() {
    const nameVal = document.getElementById('ctf-name').value.trim();
    const hostVal = document.getElementById('ctf-host').value.trim();
    const errEl = document.getElementById('ctf-error');
    errEl.textContent = '';
    if (!nameVal) { errEl.textContent = 'נא לתת שם לתחרות'; return; }
    if (!hostVal) { errEl.textContent = 'נא להזין שם תצוגה'; return; }

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
          boardType: 'shared'
        })
      });
      if (!res.ok) throw new Error('Server error');
      const data = await res.json();
      setPlayerName(hostVal);
      setActiveContest(data.contest.code);
      showContestShareScreen(data.contest);
    } catch (e) {
      errEl.textContent = 'שגיאה ביצירת התחרות';
      this.disabled = false;
      this.textContent = 'צור והעתק קוד';
    }
  };
}

window.__bloomBackToContestMenu = function() {
  hideContestScreens();
  showContestMenu();
};

function showContestShareScreen(contest) {
  const screen = document.getElementById('contest-screen');
  if (!screen) return;
  const link = buildContestShareLink(contest.code);
  const shareText = (contest.host_name || 'מישהו') + ' הזמין/ה אותך לתחרות BLOOM 🎮\n' +
    'כל המשפחה משחקת — מי יביא את הציון הכי גבוה?\n' + link;

  screen.innerHTML =
    createBackButton('window.__bloomBackToContestMenu()') +
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
    window.open('https://wa.me/?text=' + encodeURIComponent(shareText), '_blank');
  };
  document.getElementById('ctsh-copy').onclick = function() {
    navigator.clipboard.writeText(link).then(function() {
      const lbl = document.getElementById('ctsh-copy-label');
      const orig = lbl.textContent;
      lbl.textContent = '✓ הועתק';
      setTimeout(function() { lbl.textContent = orig; }, 1500);
    });
  };
  document.getElementById('ctsh-leaderboard').onclick = function() {
    showContestLeaderboard(contest.code);
  };
  document.getElementById('ctsh-play').onclick = function() {
    hideContestScreens();
    init('contest');
  };
}

function showJoinContestForm() {
  const screen = document.getElementById('contest-screen');
  if (!screen) return;
  screen.innerHTML =
    createBackButton('window.__bloomBackToContestMenu()') +
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
  const screen = document.getElementById('contest-screen');
  if (!screen) return;
  screen.innerHTML = '<div class="contest-loading">טוען תחרות...</div>';
  const data = await fetchContest(code);
  if (!data) {
    screen.innerHTML =
      createBackButton('window.__bloomBackToContestMenu()') +
      '<div class="contest-title" style="margin-top:60px">תחרות לא נמצאה</div>' +
      '<div class="contest-sub">בדוק את הקוד ונסה שוב</div>';
    return;
  }
  const ended = new Date(data.contest.ends_at) < new Date();
  const topScore = data.players.length ? data.players[0].score : 0;

  screen.innerHTML =
    createBackButton('window.__bloomBackToContestMenu()') +
    '<div class="contest-title">' + data.contest.name + '</div>' +
    '<div class="contest-sub">' + (ended ? 'התחרות הסתיימה' : 'הוזמנת על ידי ' + data.contest.host_name) + '</div>' +
    '<div class="contest-info-card">' +
      '<div class="contest-info-row"><span>שחקנים</span><span>' + data.players.length + '</span></div>' +
      '<div class="contest-info-row"><span>ציון מוביל</span><span>' + topScore.toLocaleString() + '</span></div>' +
      '<div class="contest-info-row"><span>זמן שנותר</span><span>' + formatTimeLeft(data.contest.ends_at) + '</span></div>' +
    '</div>' +
    '<div class="contest-form">' +
      '<div class="contest-form-label">השם שלך בלוח</div>' +
      '<input class="contest-input" id="cjp-name" placeholder="הנכד דניאל" maxlength="50" value="' + getPlayerName() + '" />' +
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
        if (!res.ok) throw new Error('Join failed');
        setPlayerName(nameVal);
        setActiveContest(code);
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
      createBackButton('window.__bloomBackToHome()') +
      '<div class="contest-title" style="margin-top:60px">שגיאת חיבור</div>';
    return;
  }

  const playersHtml = data.players.length === 0
    ? '<div class="contest-board-empty">אין עדיין שחקנים</div>'
    : data.players.map(function(p, i) {
        const cls = i === 0 ? 'contest-board-row first' : p.you ? 'contest-board-row me' : 'contest-board-row';
        const youBadge = p.you ? ' <small>(אתה)</small>' : '';
        return '<div class="' + cls + '">' +
          '<div class="contest-board-rank">' + (i + 1) + '</div>' +
          '<div class="contest-board-name">' + p.name + youBadge + '</div>' +
          '<div class="contest-board-score">' + p.score.toLocaleString() + '</div>' +
        '</div>';
      }).join('');

  const link = buildContestShareLink(code);

  screen.innerHTML =
    createBackButton('window.__bloomBackToHome()') +
    '<div class="contest-title">' + data.contest.name + '</div>' +
    '<div class="contest-sub">' + data.players.length + ' שחקנים · ' + formatTimeLeft(data.contest.ends_at) + '</div>' +
    '<div class="contest-board">' + playersHtml + '</div>' +
    '<div class="contest-form" style="margin-top:18px">' +
      '<button class="contest-submit-btn" id="clb-play">שחק עכשיו</button>' +
      '<button class="contest-secondary-btn" id="clb-share">שתף קישור</button>' +
    '</div>';

  document.getElementById('clb-play').onclick = function() {
    setActiveContest(code);
    hideContestScreens();
    init('contest');
  };
  document.getElementById('clb-share').onclick = function() {
    const shareText = data.contest.host_name + ' הזמין/ה אותך לתחרות BLOOM 🎮\n' + link;
    if (navigator.share) {
      navigator.share({ text: shareText });
    } else {
      navigator.clipboard.writeText(link);
      this.textContent = '✓ הקישור הועתק';
    }
  };
}
```

### 2.7 — טפל בלינק נכנס (`?c=CODE`)

מצא את הסוף של הקובץ — האזור שמתחיל בהפעלת המשחק (חפש משהו כמו `init(mode === 'daily'` או היכן שהמשחק מתחיל לרוץ).

לפני שורת ה-`init` הראשונה, הוסף:

```javascript
// Check for contest link
const urlParams = new URLSearchParams(window.location.search);
const contestCodeFromURL = urlParams.get('c');
if (contestCodeFromURL) {
  setTimeout(function() {
    showContestPreview(contestCodeFromURL.toUpperCase());
  }, 100);
}
```

### 2.8 — שילוב מצב התחרות עם מנוע המשחק

מצא את ה-`function init(nextMode)` (שורה 1167). אחרי הבלוק של `if (mode === 'daily')` והבלוק של `else`, **לפני** `nextPiece = pickPiece();`, הוסף:

```javascript
if (mode === 'contest') {
  contestSubmitted = false;
  // Try to use shared board seed from the contest
  if (activeContestCode) {
    fetchContest(activeContestCode).then(function(data) {
      if (data && data.contest && data.contest.board_seed != null) {
        activeContestData = data.contest;
      }
    });
  }
  // Use a seeded RNG if we have the seed, otherwise random
  rng = activeContestData && activeContestData.board_seed != null
    ? mulberry32(activeContestData.board_seed)
    : Math.random;
}
```

### 2.9 — שלח ציון לתחרות בסיום משחק

מצא את הקוד ששולח ציון יומי (חפש `if (mode === 'daily' && !dailySubmitted)` בשורה 1621). אחרי הבלוק הזה, הוסף:

```javascript
if (mode === 'contest' && !contestSubmitted && activeContestCode) {
  contestSubmitted = true;
  submitContestScore(activeContestCode, score, highestTier);
}
```

### 2.10 — עדכן את `mode-bar` למצב תחרות

מצא את `function updateModeBar()` (שורה 1204). אחרי הבלוק של `if (mode === 'daily')`, הוסף:

```javascript
if (mode === 'contest') {
  bar.classList.remove('practice');
  title.textContent = 'תחרות חברים';
  sub.textContent = activeContestData ? activeContestData.name : 'תחרות פעילה';
  sw.textContent = 'אימון חופשי';
  return;
}
```

(שים לב — אולי תצטרך להתאים את זה לאיך שה-mode-bar בנוי בקובץ. תסתכל איך הוא עובד עבור 'daily' ועשה דומה.)

### 2.11 — הוסף לוח מובילים של התחרות במסך סיום

מצא את הקוד שמציג לוח מובילים אחרי משחק יומי (משהו עם `showLeaderboard = mode === 'daily'` סביב שורה 1738). הוסף ל-`showLeaderboard`:

```javascript
const showLeaderboard = mode === 'daily' || mode === 'contest';
```

ובמקום שבו טוענים את הלוח, אם `mode === 'contest'`, קרא ל-`fetchContest(activeContestCode)` במקום ל-`loadLeaderboard()`.

## משימה 3 — deploy ל-Railway

תפעיל בטרמינל:
```bash
git add .
git commit -m "Add friends contest feature"
git push
```

Railway יראה את ה-push ויפרוס אוטומטית. תמתין 1-2 דקות ותרענן את הדף.

## משימה 4 — בדיקות

1. תפתח את האתר. במסך הבית — אמור להופיע כפתור צהוב "תחרות חברים" עם תווית "חדש"
2. תלחץ עליו — אמור לעבור למסך עם 2 כרטיסים
3. תיצור תחרות חדשה — אמור להופיע קוד 6 תווים
4. תפתח את הלינק שאתה מקבל בחלון פרטי — אמור לראות את מסך ההצטרפות
5. תוודא שהמצב היומי הקיים **עדיין עובד** — לחץ "בוא נתחיל", שחק משחק, ראה את לוח המובילים

אם משהו לא עובד, **תפסיק ותשאל לפני שאתה מנסה לתקן**. הקפד לא לפגוע במצב היומי הקיים.

## כללי זהב

- אל תיגע ב-`function init` חוץ מהמקום שצוין
- אל תיגע במנוע המשחק (`drop`, `processChains`, `processMerge`)
- אל תיגע בצלילים, במוזיקה, או בסייר
- אל תיגע ב-CSS של דברים שכבר עובדים
- אל תוסיף תלויות חיצוניות
- שמור על vanilla JS — בלי React, בלי Vue, בלי שום framework

אחרי שסיימת, תגיד **"בוצע"** ושלומי יבדוק.
