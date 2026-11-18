/**
 * [INPUT]: 依赖 engine/go 的棋盘尺寸与颜色
 * [OUTPUT]: evaluate（局面分差，黑为正）、winRate（换算成 0..1 的胜率）
 * [POS]: ai 的估值器。围棋数子是终局的事，中盘用「势力图」估：每颗棋子向四周辐射影响，越远越弱，
 *        影响超过门槛的点算作它的地盘。打入对方势力圈会削减对方地盘，防守和逃跑也因此有意义。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import { N, W, BLACK, WHITE, KOMI } from "../engine/go.js";

const STRENGTH = [10, 5, 2.5, 1]; // 影响随距离衰减
const DIRS = [-1, 1, -W, W];

// 每个点的势力值：黑正白负。空点按周围棋子的辐射累加
export function influence(board) {
  const inf = new Float64Array(N);
  for (let s = 0; s < N; s++) if (board[s]) inf[s] = board[s] === BLACK ? 99 : -99;
  const wave = [];
  for (let s = 0; s < N; s++) if (board[s]) wave.push([s, 0, inf[s] > 0 ? 1 : -1]);
  const acc = new Float64Array(N);
  for (let head = 0; head < wave.length; head++) {
    const [s, depth, sign] = wave[head];
    if (depth >= STRENGTH.length) continue;
    for (const d of DIRS) {
      const t = s + d;
      if (t < 0 || t >= N) continue;
      if (Math.abs((s % W) - (t % W)) > 1) continue; // 左右不跨行
      if (board[t] === (sign > 0 ? WHITE : BLACK)) continue; // 被对方棋子挡住，影响过不去
      acc[t] += sign * STRENGTH[depth];
      if (!board[t] && acc[t] !== 0) {
        // 继续扩散：只沿自己势力方向走，避免来回叠加爆炸
        wave.push([t, depth + 1, sign]);
        acc[t] = sign > 0 ? Math.min(acc[t], 60) : Math.max(acc[t], -60);
        wave[wave.length - 1][2] = sign;
        // 防止同一空点反复入队：直接允许，量级小无所谓
      }
    }
  }
  for (let s = 0; s < N; s++) if (!board[s]) inf[s] = acc[s];
  return inf;
}

// 局面分差（黑减白，含贴子）：子 + 势力超门槛的地盘
export function evaluate(board) {
  const inf = influence(board);
  let black = 0, white = 0;
  for (let s = 0; s < N; s++) {
    if (board[s] === BLACK) black++;
    else if (board[s] === WHITE) white++;
    else if (inf[s] > 6) black++;
    else if (inf[s] < -6) white++;
  }
  return black - (white + KOMI);
}

// 从黑棋视角看胜率：分差越大越确定，用温和的 S 曲线压到 0..1
export function winRate(board) {
  const diff = evaluate(board);
  return 1 / (1 + Math.exp(-diff / 14));
}
