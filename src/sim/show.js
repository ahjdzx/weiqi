/**
 * [INPUT]: 依赖 three；依赖 engine/go 的 fileOf/rankOf；依赖 render/world 的 toWorld/traySlot；
 *          依赖 render/stones 的 createStone；依赖 sim/fx 的 Effects
 * [OUTPUT]: 导出 Stage（reset、perform、update、on、busy、actors、focus）
 * [POS]: sim 的导演台，演出层对外的唯一入口。把引擎已经判定的那手棋演出来：棋子从空中落下、被提的子飞进木盒。只读走法记录，从不写回对局。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import * as THREE from "three";
import { fileOf, rankOf } from "../engine/go.js";
import { toWorld, traySlot } from "../render/world.js";
import { createStone } from "../render/stones.js";
import { Effects } from "./fx.js";

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
function* wait(sec) {
  let e = 0;
  while (e < sec) e += yield;
}
function* tween(sec, fn) {
  let e = 0;
  fn(0);
  while (e < sec) {
    e += yield;
    fn(clamp01(e / sec));
  }
}
const at = (s) => toWorld(fileOf(s), rankOf(s));

export class Stage {
  constructor(scene, camera, trays, rng) {
    this.scene = scene;
    this.trays = trays;
    this.fx = new Effects(scene, camera);
    this.actors = new Map(); // 点位 → 棋子，只含棋盘上的
    this.tasks = [];
    this.rng = rng;
    this.focus = { kind: "idle" };
    this.listeners = [];
    this.calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  on(fn) {
    this.listeners.push(fn);
  }
  emit(ev) {
    for (const fn of this.listeners) fn(ev);
  }

  reset(board) {
    for (const a of this.actors.values()) this.scene.remove(a);
    this.actors.clear();
    this.tasks = [];
    this.fx.clear();
    for (const t of Object.values(this.trays)) t.count = 0;
    for (let s = 0; s < board.length; s++) {
      if (!board[s]) continue;
      const a = createStone(board[s]);
      a.position.copy(at(s));
      this.scene.add(a);
      this.actors.set(s, a);
    }
    this.focus = { kind: "idle" };
  }

  run(gen, done) {
    gen.next();
    this.tasks.push({ gen, done });
  }

  get busy() {
    return this.tasks.length > 0;
  }

  update(dt, real = dt) {
    for (const task of this.tasks.slice()) {
      const r = task.gen.next(dt);
      if (r.done) {
        this.tasks.splice(this.tasks.indexOf(task), 1);
        task.done?.(r.value);
      }
    }
    this.fx.update(dt);
  }

  // ---- 一手棋的演出 -------------------------------------------------------------------
  perform(entry) {
    return new Promise((resolve) => this.run(this.placeShow(entry), resolve));
  }

  *placeShow(entry) {
    if (entry.pass) {
      this.focus = { kind: "idle" };
      yield* wait(this.calm ? 0 : 0.25);
      return;
    }
    const actor = createStone(entry.side);
    const end = at(entry.point);
    const start = end.clone().add(new THREE.Vector3(0, 2.4, 0));
    actor.position.copy(start);
    actor.rotation.y = this.rng() * Math.PI;
    this.scene.add(actor);
    this.actors.set(entry.point, actor);
    const dir = end.clone().sub(new THREE.Vector3(0, 0, 0)).setY(0).normalize();
    this.focus = { kind: "attack", actor, at: end.clone(), dir };
    yield* tween(this.calm ? 0 : 0.3, (t) => {
      const e = t * t;
      actor.position.lerpVectors(start, end, e);
    });
    // 落地：轻微压扁弹起，扬一点尘
    this.fx.puff(end, 4, 0.28);
    yield* tween(this.calm ? 0 : 0.12, (t) => {
      const squash = 1 - 0.18 * Math.sin(Math.PI * t);
      actor.scale.set(1 + 0.18 * Math.sin(Math.PI * t), 0.52 * squash / 0.52, 1 + 0.18 * Math.sin(Math.PI * t));
    });
    actor.scale.set(1, 1, 1);
    // 提子：被吃掉的子一颗颗飞进对方的木盒
    if (entry.captured.length) {
      yield* wait(this.calm ? 0 : 0.12);
      for (const s of entry.captured) {
        const dead = this.actors.get(s);
        this.actors.delete(s);
        if (!dead) continue;
        const tray = this.trays[entry.side === "b" ? "w" : "b"];
        const slot = traySlot(tray, tray.count++);
        const p0 = dead.position.clone();
        yield* tween(this.calm ? 0 : 0.55, (t) => {
          const e = ease(t);
          dead.position.lerpVectors(p0, slot, e);
          dead.position.y += Math.sin(Math.PI * e) * 1.6;
          dead.scale.setScalar(1 - 0.35 * e);
        });
        this.fx.puff(p0, 8, 0.5);
        yield* wait(this.calm ? 0 : 0.06);
      }
      this.focus = { kind: "attack", actor, at: end.clone(), dir };
    }
    this.focus = { kind: "settle", at: end.clone() };
    yield* wait(this.calm ? 0 : 0.2);
  }
}
