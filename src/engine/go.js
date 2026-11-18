/**
 * [INPUT]: 无依赖。纯逻辑，不引用渲染库，也不产生随机数。
 * [OUTPUT]: 尺寸 W/H/N；颜色 BLACK/WHITE/other；坐标 sq/fileOf/rankOf/coord；
 *           规则 group/liberties/legalMoves/play/passMove/outcome/scoreOf；自检 selfTest。
 * [POS]: engine 的唯一成员，全项目的裁判。9 路小棋盘、中国规则（数子法）、白贴 5.5 子，规则完整但收敛，小朋友也能看懂。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */

// 9 路围棋。坐标：x 为列 0..8（左到右），y 为行 0..8（上到下，黑方在上、白方在下不区分先后）。
// 棋子编码："b" 黑、"w" 白。走法：{ point } 落子 或 { pass: true } 停一手。
export const W = 9;
export const H = 9;
export const N = W * H;
export const BLACK = "b";
export const WHITE = "w";
export const other = (c) => (c === BLACK ? WHITE : BLACK);
export const sq = (x, y) => y * W + x;
export const fileOf = (s) => s % W;
export const rankOf = (s) => (s / W) | 0;
export const KOMI = 5.5; // 白棋贴子：黑先占了便宜，数子时还给白棋一些
export const PLY_LIMIT = 500; // 谁也停不下时的保底：直接数子

const DIRS = [-1, 1, -W, W]; // 左、右、上、下（用一维下标走邻点）
const onBoard = (s, t) => {
  if (t < 0 || t >= N) return false;
  const d = t - s;
  if (d === -1 || d === 1) return rankOf(s) === rankOf(t); // 左右不跨行
  return true;
};

// 一团同色相连的棋子：返回 { stones:[], libs:Set }（气 = 紧挨着的空点）
export function group(board, s) {
  const color = board[s];
  const stones = [s];
  const seen = new Uint8Array(N);
  seen[s] = 1;
  const libs = new Set();
  for (let i = 0; i < stones.length; i++) {
    for (const d of DIRS) {
      const t = stones[i] + d;
      if (!onBoard(stones[i], t)) continue;
      if (!board[t]) libs.add(t);
      else if (board[t] === color && !seen[t]) {
        seen[t] = 1;
        stones.push(t);
      }
    }
  }
  return { stones, libs };
}

// 在副本上试下一手，返回 { ok, captured:[], board }。自杀、打劫点、已有子都判非法
export function tryPlay(board, color, point, koPoint = -1) {
  if (point < 0 || point >= N || board[point]) return { ok: false };
  if (point === koPoint) return { ok: false, ko: true };
  const next = board.slice();
  next[point] = color;
  const foe = other(color);
  const captured = [];
  for (const d of DIRS) {
    const t = point + d;
    if (!onBoard(point, t) || next[t] !== foe) continue;
    const g = group(next, t);
    if (g.libs.size === 0) for (const s of g.stones) if (!captured.includes(s)) captured.push(s);
  }
  for (const s of captured) next[s] = null;
  if (captured.length === 0 && group(next, point).libs.size === 0) return { ok: false, suicide: true };
  return { ok: true, captured, board: next };
}

export function createGame(board = new Array(N).fill(null), side = BLACK) {
  return { board, side, captures: { [BLACK]: 0, [WHITE]: 0 }, passes: 0, ko: -1, ply: 0, history: [], over: false, seen: new Map() };
}

export const passMove = () => ({ pass: true });

// 合法落子清单（不含停一手）。color 是要下子的一方
export function legalMoves(board, color, koPoint = -1) {
  const out = [];
  for (let s = 0; s < N; s++) if (tryPlay(board, color, s, koPoint).ok) out.push({ point: s });
  return out;
}

// 数子法：己方活子 + 围住的空点。空地只挨着一种颜色才算它的地盘
export function scoreOf(board) {
  const black = { stones: 0, area: 0 };
  const white = { stones: 0, area: 0 };
  const seen = new Uint8Array(N);
  for (let s = 0; s < N; s++) {
    if (board[s] === BLACK) black.stones++;
    else if (board[s] === WHITE) white.stones++;
  }
  black.area = black.stones;
  white.area = white.stones;
  for (let s = 0; s < N; s++) {
    if (board[s] || seen[s]) continue;
    // 洪水填一遍空点，记下这一片空地挨到了谁
    const region = [s];
    seen[s] = 1;
    let touchB = false, touchW = false;
    for (let i = 0; i < region.length; i++) {
      for (const d of DIRS) {
        const t = region[i] + d;
        if (!onBoard(region[i], t)) continue;
        if (board[t] === BLACK) touchB = true;
        else if (board[t] === WHITE) touchW = true;
        else if (!seen[t]) {
          seen[t] = 1;
          region.push(t);
        }
      }
    }
    if (touchB && !touchW) black.area += region.length;
    else if (touchW && !touchB) white.area += region.length;
  }
  return { black: black.area, white: white.area + KOMI };
}

// 在棋局状态上走一步（已由调用方确认合法，或在这里被拒绝）。返回记录：提子、停一手等
export function play(state, move) {
  const color = state.side;
  let entry;
  if (move.pass) {
    state.passes++;
    state.ko = -1;
    entry = { side: color, pass: true, captured: [], notation: "停一手" };
  } else {
    const res = tryPlay(state.board, color, move.point, state.ko);
    if (!res.ok) throw new Error("非法落子被拒绝：" + JSON.stringify(move));
    for (const s of res.captured) state.board[s] = null;
    state.board[move.point] = color;
    state.captures[color] += res.captured.length;
    // 打劫：刚刚提掉一颗子、自己这颗子孤零零只剩一口气时，对方下一手不能立即提回
    state.ko = res.captured.length === 1 && group(state.board, move.point).libs.size === 1 && group(state.board, move.point).stones.length === 1 ? res.captured[0] : -1;
    state.passes = 0;
    entry = { side: color, point: move.point, captured: res.captured, notation: coord(move.point) };
  }
  state.side = other(color);
  state.ply++;
  state.history.push(entry);
  // 终局判定，按优先级：双方各停一手 → 数子；步数保底；同一个棋盘局面出现第三次（提来提去摆回原样）→ 也数子
  const done = (why) => {
    const s = scoreOf(state.board);
    state.over = true;
    state.score = s;
    state.winner = s.black > s.white ? BLACK : WHITE;
    state.reason = why;
    entry.end = { winner: state.winner, score: s, reason: why };
  };
  if (state.passes >= 2) done("数子");
  else if (!move.pass) {
    // 同型局面计数只在真的落子时进行：停一手不改棋盘，不能算「重复」
    const key = state.board.map((p) => p || ".").join("");
    const repeats = (state.seen.get(key) || 0) + 1;
    state.seen.set(key, repeats);
    if (repeats >= 3) done("三次重复局面");
  }
  if (!state.over && state.ply >= PLY_LIMIT) done("步数上限");
  return entry;
}

// 对局状态的结果（每次 play 后或刚开局时查询）
export function outcome(state) {
  if (!state.over) return { over: false };
  return { over: true, winner: state.winner, reason: state.reason || "数子", score: state.score };
}

// 坐标记谱：列 A–J（跳过 I）从左到右，行 1–9 从下往上。小朋友也能学着念
export function coord(s) {
  return "ABCDEFGHJ"[fileOf(s)] + (H - rankOf(s));
}

// 自检：空盘 81 个落子点都合法；提子、打劫、数子在 test/engine.test.mjs 里把关
export function selfTest() {
  const board = new Array(N).fill(null);
  let legal = 0;
  for (let s = 0; s < N; s++) if (tryPlay(board, BLACK, s).ok) legal++;
  const star = [sq(2, 2), sq(6, 2), sq(4, 4), sq(2, 6), sq(6, 6)];
  return { ok: legal === N && star.length === 5, count: legal, expected: N };
}
