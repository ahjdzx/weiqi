/**
 * [INPUT]: 依赖 engine/go 的 coord/N
 * [OUTPUT]: 导出 commentFor（每步一句解说）、endComment（终局解说）
 * [POS]: ai 的解说员。只看走法记录和棋盘公开事实，用小朋友能懂的大白话说每一步。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import { coord, group, H } from "../engine/go.js";

// 数数一团棋还剩几口气
const libsOf = (board, s) => group(board, s).libs.size;

export function commentFor(board, entry, choice) {
  if (entry.pass) return choice?.kind === "soft" ? "先停一手，看看对方怎么走" : "这里没有好棋了，停一手";
  const color = entry.side === "b" ? "黑" : "白";
  const at = coord(entry.point);
  if (entry.captured.length > 0)
    return `${color}子在 ${at} 一提，${entry.captured.length} 颗${entry.side === "b" ? "白" : "黑"}子被吃掉啦！`;
  // 下完之后，紧挨着的敌子只剩一口气了吗？
  for (const d of [-1, 1, -9, 9]) {
    const t = entry.point + d;
    if (t < 0 || t >= 81) continue;
    if (Math.abs((entry.point % 9) - (t % 9)) > 1) continue;
    if (board[t] && board[t] !== entry.side && libsOf(board, t) === 1)
      return `${color}子走到 ${at}，${entry.side === "b" ? "白" : "黑"}子只剩一口气，危险啦！`;
  }
  // 刚落下的这颗子和几个伙伴连在一起？
  const mine = group(board, entry.point);
  if (mine.stones.length >= 3) return `${color}子连成 ${mine.stones.length} 颗的一大团，站稳啦`;
  if (entry.point === 40) return `${color}子占了天元，棋盘正中间，好位置！`;
  const flavors = ["抢了一块好地方", "这一步稳稳的", "轻轻放下一颗子", "棋盘上又多一颗子"];
  return `${color}子在 ${at}：${flavors[entry.point % flavors.length]}`;
}

export function endComment(result) {
  if (!result.winner) return "双方地盘一样多，握手言和！";
  const s = result.score;
  const who = result.winner === "b" ? "黑" : "白";
  return `${who}棋围的地盘更大（${Math.round(s.black)} 对 ${Math.round(s.white)}），${who}棋赢啦！`;
}
