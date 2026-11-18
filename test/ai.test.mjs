/**
 * [INPUT]: 依赖 ai/rng 的种子流、engine/go 的对局状态
 * [OUTPUT]: 无导出。运行后打印逐项结果，有失败则进程退出码为 1
 * [POS]: test 的 AI 关卡。不开界面，在 Node 里把整盘棋跑完：不崩、会终局、可复现。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import { runSync, createMatch, commit, decide, startTurn } from "../src/game/match.js";
import { freshSeed } from "../src/ai/rng.js";

let failed = 0;
const ok = (cond, name, extra = "") => {
  if (cond) console.log("  ✓", name);
  else {
    failed++;
    console.log("  ✗", name, extra);
  }
};

console.log("整盘对局");
{
  const t0 = performance.now();
  const m = runSync(freshSeed(), { temperature: 0.35, depth: 3 });
  const ms = performance.now() - t0;
  ok(m.result.over, "AI 能自己下完一整盘（双方都停一手后数子）", `步数 ${m.log.length}`);
  ok(m.log.length < 600, "步数在保底之内", `走了 ${m.log.length} 步`);
  ok(typeof m.result.score?.black === "number", "终局有数子结果", JSON.stringify(m.result.score));
  ok(ms < 30000, "一整盘在 30 秒内下完", `${Math.round(ms)} ms`);
  console.log(`    · 这盘走了 ${m.log.length} 步，${Math.round(ms)} ms，黑地 ${Math.round(m.result.score.black)} 对 白地 ${Math.round(m.result.score.white)}，${m.result.winner === "b" ? "黑" : "白"}胜`);
}
{
  const seed = freshSeed();
  const a = runSync(seed, { temperature: 0.35, depth: 3 });
  const b = runSync(seed, { temperature: 0.35, depth: 3 });
  const ka = a.log.map((e) => e.notation).join();
  const kb = b.log.map((e) => e.notation).join();
  ok(ka === kb, "同一种子复现同一盘棋");
}
{
  const seeds = [freshSeed(), freshSeed(), freshSeed()];
  let allOver = true;
  for (const s of seeds) if (!runSync(s, { temperature: 0.35, depth: 2 }).result.over) allOver = false;
  ok(allOver, "换个几个种子也都能下完");
}

console.log("重放与接管");
{
  const seed = freshSeed();
  const first = createMatch(seed, { temperature: 0.35, depth: 3 });
  // 让电脑下 10 步
  for (let i = 0; i < 10 && !first.result.over; i++) {
    const it = decide(first);
    let r = it.next();
    while (!r.done) r = it.next();
    commit(first, r.value);
  }
  // 重放这 10 步：AI 对 AI 没有脚本事件，但同一种子、同设置应当走出同一盘棋
  const again = createMatch(first.script.seed, {}, first.script);
  for (let i = 0; i < 10; i++) {
    startTurn(again, null);
    const it = decide(again);
    let r = it.next();
    while (!r.done) r = it.next();
    commit(again, r.value);
  }
  ok(JSON.stringify(again.state.board) === JSON.stringify(first.state.board), "重放 10 步后局面一致");
}

console.log(failed ? `\n${failed} 项失败` : "\nAI 全部通过");
process.exitCode = failed ? 1 : 0;
