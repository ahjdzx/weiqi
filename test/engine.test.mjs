/**
 * [INPUT]: 依赖 src/engine/go.js 的全部导出
 * [OUTPUT]: 无导出。运行后打印逐项结果，有失败则进程退出码为 1
 * [POS]: test 的规则关卡。只测裁判（引擎），不碰 AI。CI 和 `npm test` 先跑它。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import * as G from "../src/engine/go.js";

let failed = 0;
const ok = (cond, name, extra = "") => {
  if (cond) console.log("  ✓", name);
  else {
    failed++;
    console.log("  ✗", name, extra);
  }
};
const empty = () => new Array(G.N).fill(null);
const put = (b, x, y, p) => (b[G.sq(x, y)] = p);

console.log("棋盘与自检");
{
  const t = G.selfTest();
  ok(t.ok, "selfTest 通过：空盘 81 个点都能落子", JSON.stringify(t));
  ok(G.N === 81, "9 路棋盘 81 个点");
  ok(G.coord(G.sq(4, 4)) === "E5", "天元记谱 E5");
  ok(G.coord(G.sq(8, 0)) === "J9", "右上角记谱 J9（列名跳过 I）");
}

console.log("提子");
{
  const b = empty();
  put(b, 2, 2, "w");
  put(b, 1, 2, "b");
  put(b, 3, 2, "b");
  put(b, 2, 1, "b");
  const r = G.tryPlay(b, G.BLACK, G.sq(2, 3));
  ok(r.ok && r.captured.length === 1 && r.captured[0] === G.sq(2, 2), "堵住最后一口气，提掉白子");
}
{
  const b = empty();
  put(b, 2, 2, "w");
  put(b, 2, 3, "w");
  put(b, 1, 2, "b");
  put(b, 3, 2, "b");
  put(b, 2, 1, "b");
  const r = G.tryPlay(b, G.BLACK, G.sq(2, 4));
  ok(r.ok && r.captured.length === 0, "两颗白子连成一体还剩气，提不掉");
  put(b, 1, 3, "b");
  put(b, 2, 4, "b");
  const r2 = G.tryPlay(b, G.BLACK, G.sq(3, 3));
  ok(r2.ok && r2.captured.length === 2, "三口气全堵上，两颗一起提");
}

console.log("自杀与例外");
{
  const b = empty();
  put(b, 2, 1, "b");
  put(b, 4, 1, "b");
  put(b, 3, 0, "b");
  put(b, 3, 2, "b");
  const r = G.tryPlay(b, G.WHITE, G.sq(3, 1));
  ok(!r.ok && r.suicide, "落进去自己没气 → 自杀，不合法");
}
{
  const b = empty();
  put(b, 3, 2, "b");
  put(b, 2, 2, "w");
  put(b, 4, 2, "w");
  put(b, 3, 1, "w");
  put(b, 2, 3, "b");
  put(b, 4, 3, "b");
  put(b, 3, 4, "b");
  const r = G.tryPlay(b, G.WHITE, G.sq(3, 3));
  ok(r.ok && r.captured.length === 1 && r.captured[0] === G.sq(3, 2), "落点像自杀，但能提掉对方 → 合法");
}

console.log("打劫");
{
  const b = empty();
  put(b, 4, 4, "b");
  put(b, 6, 4, "b");
  put(b, 5, 3, "b");
  put(b, 5, 4, "w");
  put(b, 4, 5, "w");
  put(b, 6, 5, "w");
  put(b, 5, 6, "w");
  const st = G.createGame(b, G.BLACK);
  const e = G.play(st, { point: G.sq(5, 5) });
  ok(e.captured.length === 1 && e.captured[0] === G.sq(5, 4), "黑提掉白一颗子");
  ok(st.ko === G.sq(5, 4), "劫点 = 被提子的位置");
  const r = G.tryPlay(st.board, G.WHITE, G.sq(5, 4), st.ko);
  ok(!r.ok, "白不能马上提回来（打劫）");
  G.play(st, G.passMove());
  ok(st.ko === -1, "停一手后劫解除");
}

console.log("数子");
{
  const b = empty();
  for (let y = 0; y < 9; y++) {
    put(b, 2, y, "b");
    put(b, 4, y, "w");
  }
  const s = G.scoreOf(b);
  ok(s.black === 9 + 18, "黑：9 颗子 + 左边 18 点空地", JSON.stringify(s));
  ok(s.white === 9 + 36 + G.KOMI, "白：9 颗子 + 右边 36 点空地 + 贴子", JSON.stringify(s));
  // 中间一条空地两边都挨着 → 谁的都不算
  ok(s.black + s.white < 81 + G.KOMI, "中间的空地不算数");
}

console.log("对局流程");
{
  const st = G.createGame();
  const e1 = G.play(st, { point: G.sq(4, 4) });
  ok(e1.notation === "E5" && e1.side === G.BLACK, "记谱 E5");
  G.play(st, G.passMove());
  const e3 = G.play(st, { point: G.sq(2, 2) });
  ok(!st.over && st.passes === 0, "一方停一手不算终局，对方落子后清零");
  const e4 = G.play(st, G.passMove());
  ok(!st.over && st.passes === 1, "再停一手还差一停");
  const e5 = G.play(st, G.passMove());
  ok(st.over && st.winner === G.BLACK, "双方各停两手 → 终局数子，黑地多黑赢", JSON.stringify(st.score));
  ok(e5.end && typeof e5.end.score.black === "number", "终局那手记录里带上数子结果");
  ok(G.outcome(st).over && G.outcome(st).winner === G.BLACK, "outcome 报告终局");
}
{
  const st = G.createGame();
  for (let i = 0; i < G.PLY_LIMIT + 2; i++) G.play(st, G.passMove());
  ok(st.over && st.ply >= G.PLY_LIMIT, "步数保底也会终局数子");
}
{
  const st = G.createGame();
  G.play(st, { point: G.sq(0, 0) });
  let threw = false;
  try {
    G.play(st, { point: G.sq(0, 0) });
  } catch {
    threw = true;
  }
  ok(threw, "同一个点下两次 → 引擎拒绝");
}

console.log(failed ? `\n${failed} 项失败` : "\n规则引擎全部通过");
process.exitCode = failed ? 1 : 0;
