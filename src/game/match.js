/**
 * [INPUT]: 依赖 engine/go 的 createGame/play/outcome/legalMoves/passMove；依赖 ai/rng 的种子流；依赖 ai/brain 的 think；依赖 ai/commentary 的解说
 * [OUTPUT]: createMatch、startTurn、branch、decide、commit、runSync
 * [POS]: game 的唯一成员，把裁判（engine）和棋手（ai）串成一盘棋。commit() 是唯一能改变对局状态的入口，只接受合法走法。仍然是纯逻辑，可在 Node 里无界面地跑完整盘。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import { createGame, play, outcome, legalMoves, passMove } from "../engine/go.js";
import { makeRng } from "../ai/rng.js";
import { think } from "../ai/brain.js";
import { commentFor, endComment } from "../ai/commentary.js";

export const DEFAULTS = { temperature: 0.35, depth: 3 };

export function createMatch(seed, settings = {}, script = null) {
  const initial = { ...DEFAULTS, ...(script ? script.settings : settings) };
  return {
    seed,
    settings: { ...initial },
    state: createGame(),
    rng: makeRng(seed).fork("choice"),
    log: [],
    result: { over: false },
    winRate: 0.5,
    script: { seed, settings: { ...initial }, events: [] },
    replay: script ? script.events.slice() : null,
  };
}

const sameSettings = (a, b) => a.temperature === b.temperature && a.depth === b.depth;

// 回合开始：重放时按脚本设定；否则采用界面上的当前设置，有变化就记进脚本
export function startTurn(match, live) {
  const ply = match.log.length;
  if (match.replay) {
    const ev = match.replay.find((e) => e.ply === ply && e.type === "settings");
    if (ev) {
      match.settings = { temperature: ev.temperature, depth: ev.depth };
      match.script.events.push({ ...ev });
    }
    const human = match.replay.find((e) => e.ply === ply && e.type === "human");
    if (!match.replay.some((e) => e.ply > ply || (e.ply === ply && e.type === "human"))) match.replay = null; // 脚本走完
    if (human) {
      const move = human.pass ? passMove() : { point: human.point };
      if (human.pass || legalMoves(match.state.board, match.state.side, match.state.ko).some((m) => m.point === human.point)) {
        return { scripted: { move, kind: "human", replayed: true } };
      }
    }
    return { scripted: null };
  }
  if (live && !sameSettings(live, match.settings)) {
    match.settings = { ...live };
    match.script.events.push({ ply, type: "settings", ...match.settings });
  }
  return { scripted: null };
}

// 重放途中用户改了东西：从这里起不再跟随脚本
export function branch(match) {
  match.replay = null;
}

// 生成器：AI 思考（可分片推进），返回选择
export function* decide(match) {
  return yield* think(match.state, match.rng, match.settings);
}

// 落子：唯一会改变对局状态的入口，并且只接受合法走法
export function commit(match, choice) {
  const { state } = match;
  const move = choice.move;
  if (!move.pass) {
    const legal = legalMoves(state.board, state.side, state.ko);
    if (!legal.some((l) => l.point === move.point)) throw new Error("非法落子被拒绝：" + JSON.stringify(move));
  }
  const entry = play(state, move);
  const comment = commentFor(state.board, entry, choice);
  match.result = outcome(state);
  match.winRate = match.result.over
    ? match.result.winner === "b" ? 1 : match.result.winner === "w" ? 0 : 0.5
    : Math.max(0.02, Math.min(0.98, choice.winRate ?? 0.5));
  if (choice.kind === "human") match.script.events.push({ ply: match.log.length, type: "human", ...(move.pass ? { pass: true } : { point: move.point }) });
  const record = { ...entry, comment, kind: choice.kind, replayed: !!choice.replayed, end: match.result.over ? endComment(match.result) : "" };
  match.log.push(record);
  return record;
}

export function runSync(seed, settings, maxPlies = 600) {
  const match = createMatch(seed, settings);
  while (!match.result.over && match.log.length < maxPlies) {
    const it = decide(match);
    let r = it.next();
    while (!r.done) r = it.next();
    commit(match, r.value);
  }
  return match;
}
