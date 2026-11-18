/**
 * [INPUT]: 依赖 engine/go 的 tryPlay/legalMoves/scoreOf/尺寸；依赖 ai/rng 的种子流；依赖 ai/evaluate 的 evaluate
 * [OUTPUT]: 导出 think（生成器：按时间片算候选点，返回 { move, winRate, kind }）
 * [POS]: ai 的棋手。思路很朴实：把每个能下的点试摆一遍，数数地盘涨了多少、提了几颗子，挑分高又带点随机的下手。
 *        电脑只看得到棋盘本身，围棋没有暗棋，所以不藏着。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import { N, W, BLACK, WHITE, other, tryPlay, legalMoves, scoreOf, group, sq } from "../engine/go.js";
import { evaluate } from "./evaluate.js";

const DEPTH_CANDIDATES = { 2: 14, 3: 24, 4: 40 };

// 这个点是不是对方的“眼”：空点，上下左右全是同一色，四个斜角也大多被占。往眼里下是送死
function isEyeLike(board, s, foe) {
  for (const d of [-1, 1, -W, W]) {
    const t = s + d;
    if (t < 0 || t >= N) continue;
    if (Math.abs((s % W) - (t % W)) > 1) continue; // 左右不跨行
    if (board[t] !== foe) return false;
  }
  // 数斜角：边界与己方都算安全
  const x = s % W, y = (s / W) | 0;
  let bad = 0, total = 0;
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H9()) continue;
    total++;
    if (board[ny * W + nx] === foe) bad++;
  }
  return total === 0 || bad <= (y === 0 || y === 8 || x === 0 || x === 8 ? 0 : 1);
}
const H9 = () => 9;

export function* think(state, rng, settings) {
  const { board, side, ko } = state;
  const foe = other(side);
  const base = evaluate(board);
  const candidates = [];
  for (const m of legalMoves(board, side, ko)) {
    if (isEyeLike(board, m.point, side)) continue; // 不往自己眼里下
    const res = tryPlay(board, side, m.point, ko);
    if (!res.ok) continue;
    // 打分：地盘涨了多少 + 提子的奖励；开局时更爱往宽的地方下
    const after = evaluate(res.board) - base;
    const gain = side === BLACK ? after : -after;
    let score = gain + res.captured.length * 14;
    // 战术：落下后自己只剩一口气 → 别送吃；让紧挨着的敌子只剩一口气 → 打吃
    const myLibs = group(res.board, m.point).libs.size;
    if (myLibs === 1 && res.captured.length === 0) score -= 12;
    for (const d of [-1, 1, -W, W]) {
      const t = m.point + d;
      if (t < 0 || t >= N) continue;
      if (Math.abs((m.point % W) - (t % W)) > 1) continue;
      if (res.board[t] === foe && group(res.board, t).libs.size === 1) score += 7;
    }
    // 别把棋盘摆回见过几次的旧样子：提来提去不长棋
    const key = res.board.map((p) => p || ".").join("");
    if (state.seen.has(key)) score -= 40;
    candidates.push({ point: m.point, score, captured: res.captured.length });
  }
  // 深度档位只决定看多少个候选：越多越精，越慢
  candidates.sort((a, b) => b.score - a.score);
  const keep = DEPTH_CANDIDATES[settings.depth] || 24;
  const shortlist = candidates.slice(0, keep);
  yield; // 候选算完，交一次时间片

  // 开局阶段（棋盘还很空）加一点“抢大场”的偏好：三四线的点最值钱，第一二线和贴着棋子的点不着急
  const emptyCount = board.reduce((n, p) => n + (p ? 0 : 1), 0);
  const opening = emptyCount > N * 0.72;
  if (opening) {
    for (const c of shortlist) {
      const x = c.point % W, y = (c.point / W) | 0;
      const lineDist = Math.min(x, 8 - x, y, 8 - y);
      c.score += lineDist === 3 ? 6 : lineDist === 2 ? 4 : lineDist === 4 ? 2 : -3;
    }
  }

  // 温度抽选：分数接近的几步里带点随机，温度高爱冒险
  const T = Math.max(0.05, settings.temperature * 2.2);
  const top = shortlist.slice(0, Math.max(1, Math.min(shortlist.length, 8)));
  const weights = top.map((c) => Math.exp((c.score - top[0].score) / T));
  const total = weights.reduce((a, b) => a + b, 0);
  let pick = rng() * total;
  let chosen = top[0];
  for (let i = 0; i < top.length; i++) {
    pick -= weights[i];
    if (pick <= 0) {
      chosen = top[i];
      break;
    }
  }

  // 什么时候停一手：
  //   ① 对方刚停了一手（棋局已经下到中后段），自己也没找到大棋 → 跟着停，把棋下完
  //   ② 没有值得下的点（比如全都是自己眼里），也停一手
  const afterScore = scoreOf(board);
  const leading = side === BLACK ? afterScore.black > afterScore.white : afterScore.white > afterScore.black;
  const bestScore = shortlist[0]?.score ?? -99;
  const endgame = emptyCount < N * 0.28 && bestScore < 6 && shortlist.every((c) => c.captured === 0);
  const followPass = state.passes === 1 && emptyCount < N * 0.72 && (leading || bestScore < 8);
  if (followPass || bestScore < -6 || endgame) {
    return { move: { pass: true }, winRate: leading ? 0.9 : 0.5, kind: "soft" };
  }
  const win = 1 / (1 + Math.exp(-(base + (side === BLACK ? 1 : -1) * chosen.score * 0.9) / 12));
  return { move: { point: chosen.point }, winRate: Math.max(0.02, Math.min(0.98, win)), kind: chosen.captured ? "capture" : "move" };
}
