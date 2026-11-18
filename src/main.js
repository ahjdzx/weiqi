/**
 * [INPUT]: 依赖 engine/go 的自检与走法、game/match 的对局入口、ai/rng 的种子、render 的场景与导播、sim 的演出舞台
 * [OUTPUT]: 无导出。页面入口；在 window.__wq 上留一个调试把手
 * [POS]: 总控。回合流程：引擎决定 → AI 选择 → 演出 → 导播。各层只通过走法记录交流。
 *        界面文案是小朋友版：按钮、菜单、终局弹窗与状态栏都说大白话，终局原因在显示时翻译。
 *        适配屏幕也在这里：视野随宽高比变、轻点才算落子、窄屏默认收起设置。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import * as THREE from "three";
import { selfTest, legalMoves, passMove, fileOf, rankOf, sq } from "./engine/go.js";
import { createMatch, decide, commit, startTurn, branch } from "./game/match.js";
import { makeRng, freshSeed } from "./ai/rng.js";
import { createWorld, toWorld } from "./render/world.js";
import { Stage } from "./sim/show.js";
import { Director } from "./render/director.js";

const $ = (id) => document.getElementById(id);

// 终局原因的大白话：引擎里的原因是给测试和棋谱看的，弹窗上说小朋友听得懂的话
const KID_REASON = (r) =>
  r === "数子" ? "双方都停了手，数地盘分胜负"
  : r === "三次重复局面" ? "棋盘上你提我、我提你，总摆成一样的，就数地盘吧"
  : r === "步数上限" ? "下得太久啦，数地盘"
  : r;
// 「爱冒险」滑杆的大白话档位：数值是给行家看的，小朋友只看词
const tempWord = (t) =>
  t < 0.15 ? "特别稳重" : t < 0.35 ? "稳重" : t < 0.6 ? "有点冒险" : t < 0.85 ? "爱冒险" : "特别爱冒险";
const SIDE = { b: "黑", w: "白" };

// ---- 自检 ---------------------------------------------------------------------------
const test = selfTest();
if (test.ok) console.info(`[围棋自检] 通过：空盘 ${test.count} 个落子点全部合法`);
else {
  console.error(`[围棋自检] 失败：合法落子点 ${test.count}，应为 ${test.expected}`);
  $("selftest").className = "badge fail";
  $("selftest").textContent = `自检失败 ${test.count}/${test.expected}`;
}

// ---- 场景 ---------------------------------------------------------------------------
const canvas = $("scene");
const { renderer, scene, camera, trays, pickPlane } = createWorld(canvas);
const stage = new Stage(scene, camera, trays, makeRng("init"));
const director = new Director(camera, canvas);
director.obstacles = () => [...stage.actors.values()];
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

// 竖屏时把垂直视野撑大，让水平视野不小于 6:5 画面时的宽度；否则手机上只剩一条窄缝，全是特写
const FOV = { base: 38, aspect: 1.2, max: 78 };
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const half = Math.tan(THREE.MathUtils.degToRad(FOV.base / 2));
  camera.fov = camera.aspect >= FOV.aspect ? FOV.base : Math.min(FOV.max, THREE.MathUtils.radToDeg(2 * Math.atan((half * FOV.aspect) / camera.aspect)));
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ---- 状态 ---------------------------------------------------------------------------
const settings = { temperature: 0.35, depth: 3 };
const control = { b: "ai", w: "ai" };
let match = null;
let seed = freshSeed();
let paused = false;
let speed = 1;
let phase = "gap"; // gap | think | human | show | over
let gap = 1.2;
let thinker = null;
let thinkStart = 0;
let overTimer = 0;
let ready = null;

function newGame(s, script = null) {
  seed = s;
  match = createMatch(seed, { ...settings }, script);
  if (script) showSettings(match.settings);
  stage.reset(match.state.board);
  $("seed").textContent = seed;
  $("moves").innerHTML = "";
  $("army-b").textContent = "黑棋 · 先下";
  $("army-w").textContent = "白棋 · 让 5.5 子";
  setWin(0.5);
  say(script ? `重放种子 ${seed}` : `新的一局，种子 ${seed}`, script && script.events.length ? `按原局的设置改动和你的落子精确重放` : "黑白轮流放子，围地盘多的一方赢");
  $("end").classList.add("hidden");
  thinker = null;
  ready = null;
  clearMarks();
  phase = "gap";
  gap = 1.4;
}

// ---- 界面 ---------------------------------------------------------------------------
function setWin(p) {
  $("win-fill").style.transform = `scaleX(${p.toFixed(3)})`;
  $("win-b").textContent = `黑 ${Math.round(p * 100)}%`;
  $("win-w").textContent = `白 ${Math.round((1 - p) * 100)}%`;
}
function say(text, sub = "") {
  $("comment-text").textContent = text;
  $("comment-sub").textContent = sub;
  const el = $("comment");
  el.classList.remove("pop");
  void el.offsetWidth;
  el.classList.add("pop");
  setTimeout(() => el.classList.remove("pop"), 300);
}
function status(text) {
  $("status").textContent = text;
}
function addMove(rec) {
  const list = $("moves");
  const ply = match.log.length;
  const n = Math.ceil(ply / 2);
  let li = list.querySelector(`li[data-n="${n}"]`);
  if (!li) {
    li = document.createElement("li");
    li.dataset.n = n;
    li.innerHTML = `<span class="n">${n}.</span><span class="r"></span><span class="b"></span>`;
    list.appendChild(li);
  }
  const cell = li.querySelector(rec.side === "b" ? ".r" : ".b");
  cell.textContent = rec.notation;
  if (rec.captured.length) cell.classList.add("cap");
  list.querySelectorAll("li.latest").forEach((x) => x.classList.remove("latest"));
  li.classList.add("latest");
  list.scrollTop = list.scrollHeight;
}

$("btn-new").onclick = () => newGame(freshSeed());
$("btn-replay").onclick = () => newGame(seed, match.script);
// 终局弹窗：点空白处或「回看棋盘」都能收起，留在终局局面慢慢看
$("btn-again").onclick = () => newGame(freshSeed());
$("btn-review").onclick = () => $("end").classList.add("hidden");
$("end").onclick = (e) => {
  if (e.target.id === "end") $("end").classList.add("hidden");
};

// 界面显示某组设置（重放时跟随原局）
function showSettings(st) {
  settings.temperature = st.temperature;
  settings.depth = st.depth;
  $("temp").value = String(st.temperature);
  $("temp-out").textContent = tempWord(st.temperature);
  $("depth").value = String(st.depth);
}
// 重放途中用户自己改了东西：从这里起按新的来
function userChanged() {
  if (match?.replay) {
    branch(match);
    status("已偏离重放，从这一步起按现在的玩法继续");
  }
}
$("btn-pause").onclick = () => setPaused(!paused);
function setFolded(folded) {
  $("controls").classList.toggle("folded", folded);
  $("btn-fold").textContent = folded ? "设置" : "收起来";
}
$("btn-fold").onclick = () => setFolded(!$("controls").classList.contains("folded"));
setFolded(true);
$("btn-record").onclick = () => {
  if ($("record").classList.toggle("open")) setFolded(true);
};
$("btn-fold").addEventListener("click", () => $("record").classList.remove("open"));
function setPaused(p) {
  paused = p;
  $("btn-pause").textContent = paused ? "继续" : "暂停";
  $("btn-pause").setAttribute("aria-pressed", String(paused));
  status(paused ? "暂停啦，点「继续」或按空格键接着下" : "");
}
$("speed").oninput = (e) => {
  speed = Number(e.target.value);
  $("speed-out").textContent = `${speed.toFixed(1)}×`;
};
$("temp").oninput = (e) => {
  settings.temperature = Number(e.target.value);
  $("temp-out").textContent = tempWord(settings.temperature);
  userChanged();
};
$("depth").onchange = (e) => {
  settings.depth = Number(e.target.value);
  userChanged();
};
$("camera").onchange = (e) => director.setMode(e.target.value);
for (const c of ["b", "w"]) {
  $("ctl-" + c).onchange = (e) => {
    control[c] = e.target.value;
    userChanged();
    // 接管：如果这一方正在思考或等待，重新开始这一回合
    if (match && match.state.side === c && (phase === "think" || phase === "ready" || phase === "human")) {
      thinker = null;
      ready = null;
      clearMarks();
      phase = "gap";
      gap = 0.2;
    }
  };
}
window.addEventListener("keydown", (e) => {
  if (e.key === " " && e.target.tagName !== "INPUT" && e.target.tagName !== "SELECT") {
    e.preventDefault();
    setPaused(!paused);
  }
});

// ---- 人类落子 ------------------------------------------------------------------------
const marks = new THREE.Group();
scene.add(marks);
function clearMarks() {
  marks.clear();
}
function markAt(s, color, r = 0.34) {
  const m = new THREE.Mesh(new THREE.RingGeometry(r - 0.06, r, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.copy(toWorld(fileOf(s), rankOf(s))).setY(0.02);
  marks.add(m);
}
const ray = new THREE.Raycaster();
// 轻点才算落子：按下和抬起几乎在同一处。拖动是在转镜头（触屏上尤其如此），不能误放子
let press = null;
canvas.addEventListener("pointerdown", (e) => {
  press = e.button === 0 ? { x: e.clientX, y: e.clientY, at: performance.now() } : null;
});
canvas.addEventListener("pointerup", (e) => {
  const tap = press && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 10 && performance.now() - press.at < 600;
  press = null;
  if (!tap || phase !== "human" || paused) return;
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(pickPlane)[0];
  if (!hit) return;
  const [x, y] = fromWorldPoint(hit.point);
  if (x < 0 || x > 8 || y < 0 || y > 8) return;
  const s = sq(x, y);
  if (match.state.board[s]) return; // 已有子
  const legal = legalMoves(match.state.board, match.state.side, match.state.ko);
  if (!legal.some((m) => m.point === s)) {
    // 不合法：给个提示（自杀点或打劫点），不落子
    status("这一点不能下哦：下了自己就没气啦（或者要先隔一手解打劫）");
    return;
  }
  clearMarks();
  markAt(s, "#e9c46a");
  play({ move: { point: s }, kind: "human" });
});
function fromWorldPoint(v) {
  const x = Math.round(v.x / 1.05 + 4), y = Math.round(4 - v.z / 1.05);
  return [x, y];
}
// 停一手：轮到你时，不想下了就停
$("btn-pass").onclick = () => {
  if (phase !== "human" || paused) return;
  play({ move: passMove(), kind: "human" });
};

// ---- 回合流程 -----------------------------------------------------------------------
function beginTurn() {
  if (match.result.over) return finish();
  const side = match.state.side;
  const replaying = !!match.replay;
  const { scripted } = startTurn(match, { ...settings });
  if (replaying) showSettings(match.settings);
  if (scripted) {
    status("重放：这一步是当时你下的");
    ready = { choice: scripted, at: performance.now() + 700 / speed };
    phase = "ready";
    return;
  }
  if (replaying && !match.replay) status("重放完啦，接着往下下");
  if (control[side] === "human" && !match.replay) {
    phase = "human";
    status(`轮到你走啦：点一个交叉点放下${side === "b" ? "黑" : "白"}子，或点「停一手」`);
    return;
  }
  phase = "think";
  thinker = decide(match);
  thinkStart = performance.now();
  status(`${SIDE[side]}方在想怎么走…`);
}

function stepThinker(budget) {
  const t0 = performance.now();
  while (performance.now() - t0 < budget) {
    const r = thinker.next();
    if (r.done) {
      thinker = null;
      return r.value;
    }
  }
  return undefined;
}

function play(choice) {
  const rec = commit(match, choice);
  addMove(rec);
  say(rec.comment, rec.replayed ? "重放你当时的落子" : rec.kind === "blunder" ? "太爱冒险，走错啦" : rec.kind === "soft" ? "爱冒险让它走了一步不太好的棋" : "");
  setWin(match.winRate);
  status("");
  phase = "show";
  stage.perform(rec).then(() => {
    if (match.result.over) finish();
    else {
      phase = "gap";
      gap = 0.55;
    }
  });
}

function finish() {
  phase = "over";
  const r = match.result;
  const title = r.winner ? (r.winner === "b" ? "黑方赢啦" : "白方赢啦") : "平局啦";
  $("banner-title").textContent = title;
  $("banner-sub").textContent = `${KID_REASON(r.reason)} · 黑地 ${Math.round(r.score.black)} · 白地 ${Math.round(r.score.white)} · 走了 ${match.log.length} 步 · 种子 ${seed}`;
  $("end").classList.remove("hidden");
  say(`${title}：${KID_REASON(r.reason)}`, "下完啦，数数地盘见胜负");
  status($("auto-next").checked ? "马上开始新的一局" : "这盘棋下完啦");
  const last = match.log[match.log.length - 1];
  const at = last && !last.pass ? toWorld(last.point % 9, (last.point / 9) | 0) : toWorld(4, 4);
  stage.focus = { kind: "over", at };
  overTimer = 9;
}

// ---- 主循环 -------------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const sdt = paused ? 0 : dt * speed;
  if (!paused && match) {
    if (phase === "gap") {
      gap -= sdt;
      if (gap <= 0) beginTurn();
    } else if (phase === "think" && thinker) {
      const choice = stepThinker(8);
      if (choice !== undefined) {
        if (!choice) finish();
        else {
          ready = { choice, at: thinkStart + 450 / speed };
          phase = "ready";
        }
      }
    } else if (phase === "ready" && ready && now >= ready.at) {
      const c = ready.choice;
      ready = null;
      play(c);
    } else if (phase === "over" && $("auto-next").checked) {
      overTimer -= sdt;
      if (overTimer <= 0) newGame(freshSeed());
    }
  }
  stage.update(sdt);
  director.update(dt, stage.focus, !paused);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

newGame(seed);
requestAnimationFrame(frame);

// 调试入口（不影响对局）
window.__wq = {
  get match() { return match; },
  get phase() { return phase; },
  newGame,
  setPaused,
  stage,
  director,
  screenOf(x, y) {
    const v = toWorld(x, y).project(camera);
    return [(v.x + 1) / 2, (1 - v.y) / 2];
  },
};
