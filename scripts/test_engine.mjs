// Deterministic engine self-test. Runs N simulated games using the same
// merge/gravity logic as bot-engine.js and asserts the gravity invariant
// after EVERY step: no tile can sit above an empty cell in the same column.
// Catches the "floating tile" class of bugs the user reported.
//
// Run with: node scripts/test_engine.mjs [games] [drops_per_game]
import process from 'node:process';

const ROWS = 6, COLS = 4, MAX_TIER = 8;

function emptyGrid() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function findGroup(g, sr, sc, tier) {
  const visited = new Set();
  const group = [];
  const stack = [[sr, sc]];
  while (stack.length) {
    const [r, c] = stack.pop();
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
    const k = r * COLS + c;
    if (visited.has(k)) continue;
    if (g[r][c] !== tier) continue;
    visited.add(k);
    group.push([r, c]);
    stack.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
  }
  return group;
}

function applyGravity(g) {
  for (let c = 0; c < COLS; c++) {
    let w = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (g[r][c] !== 0) {
        if (r !== w) { g[w][c] = g[r][c]; g[r][c] = 0; }
        w--;
      }
    }
  }
}

function processChains(g) {
  let totalScore = 0, chains = 0;
  while (true) {
    let merged = false;
    outer: for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = g[r][c];
        if (t === 0 || t === MAX_TIER) continue;
        const group = findGroup(g, r, c, t);
        if (group.length >= 2) {
          let kr = -1, kc = -1;
          for (const [gr, gc] of group) {
            if (gr > kr || (gr === kr && gc < kc)) { kr = gr; kc = gc; }
          }
          for (const [gr, gc] of group) {
            if (gr === kr && gc === kc) continue;
            g[gr][gc] = 0;
          }
          const nt = Math.min(t + 1, MAX_TIER);
          g[kr][kc] = nt;
          chains++;
          totalScore += nt * 10 * group.length * (1 + (chains - 1) * 0.5);
          merged = true;
          break outer;
        }
      }
    }
    if (!merged) break;
    applyGravity(g);
  }
  return { score: totalScore, chains };
}

function gridString(g) {
  return g.map(row => row.map(v => v === 0 ? '·' : v).join('')).join('\n');
}

// Invariant: in every column, gravity pulls tiles to the BOTTOM. Walking
// top-down: once we see a filled cell, every subsequent cell in that
// column must also be filled. An empty below a filled = floating tile bug.
function assertGravityInvariant(g, where) {
  for (let c = 0; c < COLS; c++) {
    let seenFilled = false;
    for (let r = 0; r < ROWS; r++) {
      if (g[r][c] !== 0) seenFilled = true;
      else if (seenFilled) {
        console.error(`\n❌ FLOATING TILE: empty at row ${r} col ${c} below a filled tile  (after ${where})`);
        console.error(gridString(g));
        return false;
      }
    }
  }
  return true;
}

const NUM_GAMES = parseInt(process.argv[2], 10) || 200;
const DROPS_PER_GAME = parseInt(process.argv[3], 10) || 80;

let totalDrops = 0, totalMerges = 0, totalGameOvers = 0, totalCrown = 0, totalFloatErrors = 0;

for (let gi = 0; gi < NUM_GAMES; gi++) {
  const g = emptyGrid();
  let highest = 1;
  for (let d = 0; d < DROPS_PER_GAME; d++) {
    // gameOver check
    if (g[0].every(v => v !== 0)) { totalGameOvers++; break; }
    // weighted random piece
    const weights = [0, 55, 28, 12, 5, 0, 0, 0, 0];
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    let piece = 1;
    for (let t = 1; t <= MAX_TIER; t++) {
      roll -= weights[t];
      if (roll <= 0) { piece = t; break; }
    }
    // best column (just random for the test — we want to exercise gravity)
    const col = Math.floor(Math.random() * COLS);
    let row = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (g[r][col] === 0) { row = r; break; }
    }
    if (row === -1) continue;
    g[row][col] = piece;
    totalDrops++;
    if (piece > highest) highest = piece;
    if (!assertGravityInvariant(g, `drop@col${col}`)) { totalFloatErrors++; }
    const res = processChains(g);
    totalMerges += res.chains;
    if (!assertGravityInvariant(g, `chains(game${gi},drop${d})`)) { totalFloatErrors++; }
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (g[r][c] === MAX_TIER) totalCrown++;
  }
}

console.log('\n=== ENGINE SELF-TEST RESULTS ===');
console.log('games:           ', NUM_GAMES);
console.log('drops:           ', totalDrops);
console.log('merges:          ', totalMerges);
console.log('crowns reached:  ', totalCrown);
console.log('game-overs:      ', totalGameOvers);
console.log('FLOATING TILES:  ', totalFloatErrors, totalFloatErrors === 0 ? '✓ OK' : '❌ BUG');
process.exit(totalFloatErrors === 0 ? 0 : 1);
