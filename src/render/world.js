/**
 * [INPUT]: 依赖 three；依赖 sim/fx 的 groundAt 需要（本文件导出）
 * [OUTPUT]: 尺寸常量 CELL/BOARD_W/BOARD_D/BOARD_T/TABLE/TRAY_X；坐标换算 toWorld/fromWorld/groundAt/traySlot；场景工厂 createWorld
 * [POS]: render 的地基。低矮漆木桌、9 路围棋盘、两侧收子木盒、灯光。只负责「看起来」，不碰对局状态。
 *        触屏设备（pointer: coarse）自动降一档像素比和阴影贴图。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import * as THREE from "three";

export const CELL = 1.05; // 交叉点间距
export const BOARD_W = 9.6;
export const BOARD_D = 9.6;
export const BOARD_T = 0.3;
export const TABLE = { w: 16.5, d: 13, top: -BOARD_T, rimX: 8, rimZ: 6 };
export const TRAY_X = 6.8;

// 棋盘坐标 → 世界坐标。(0,0) 在远处，y 越大越靠近观众
export const toWorld = (x, y) => new THREE.Vector3((x - 4) * CELL, 0, (4 - y) * CELL);
export const fromWorld = (v) => [Math.round(v.x / CELL + 4), Math.round(4 - v.z / CELL)];

export function groundAt(x, z) {
  if (Math.abs(x) <= BOARD_W / 2 && Math.abs(z) <= BOARD_D / 2) return 0;
  return TABLE.top;
}

function boardTexture() {
  const S = 110;
  const c = document.createElement("canvas");
  c.width = Math.round(BOARD_W * S);
  c.height = Math.round(BOARD_D * S);
  const g = c.getContext("2d");
  // 木纹
  const grad = g.createLinearGradient(0, 0, c.width, c.height);
  grad.addColorStop(0, "#e6c17c");
  grad.addColorStop(1, "#d5a765");
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 140; i++) {
    g.strokeStyle = `rgba(120,70,30,${0.03 + Math.random() * 0.05})`;
    g.lineWidth = 1 + Math.random() * 2.5;
    g.beginPath();
    const y0 = Math.random() * c.height;
    g.moveTo(0, y0);
    for (let x = 0; x <= c.width; x += 40) g.lineTo(x, y0 + Math.sin(x / 90 + i) * 6 + Math.random() * 2);
    g.stroke();
  }
  const px = (x) => (x + BOARD_W / 2) * S;
  const pz = (z) => (z + BOARD_D / 2) * S;
  const P = (gx, gy) => [px((gx - 4) * CELL), pz((4 - gy) * CELL)];
  g.strokeStyle = "#4a2710";
  g.lineCap = "round";
  g.lineWidth = 3;
  const line = (a, b) => {
    g.beginPath();
    g.moveTo(...P(...a));
    g.lineTo(...P(...b));
    g.stroke();
  };
  for (let i = 0; i < 9; i++) {
    line([i, 0], [i, 8]);
    line([0, i], [8, i]);
  }
  // 外框加粗
  g.lineWidth = 6;
  g.strokeRect(...P(0, 8), 8 * CELL * S, 8 * CELL * S);
  // 星位
  g.fillStyle = "#4a2710";
  for (const [sx, sy] of [[2, 2], [6, 2], [4, 4], [2, 6], [6, 6]]) {
    const [cx, cy] = P(sx, sy);
    g.beginPath();
    g.arc(cx, cy, 0.055 * S, 0, Math.PI * 2);
    g.fill();
  }
  // 边缘坐标：列 A–J（跳过 I），行 1–9
  g.fillStyle = "rgba(74,39,16,0.55)";
  g.font = `bold ${Math.round(S * 0.14)}px ui-monospace,Menlo,monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let x = 0; x < 9; x++) {
    g.fillText("ABCDEFGHJ"[x], px((x - 4) * CELL), pz(-4.35 * CELL));
    g.fillText("ABCDEFGHJ"[x], px((x - 4) * CELL), pz(4.35 * CELL));
  }
  for (let y = 0; y < 9; y++) {
    g.fillText(String(9 - y), px(-4.35 * CELL), pz((4 - y) * CELL));
    g.fillText(String(9 - y), px(4.35 * CELL), pz((4 - y) * CELL));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function lacquer(color, rough = 0.32) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 });
}

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  const lite = window.matchMedia("(pointer: coarse)").matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, lite ? 1.5 : 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#1b1714");
  scene.fog = new THREE.Fog("#1b1714", 28, 58);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  camera.position.set(0, 12, 13);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight("#fff4e0", "#3a2a20", 0.85));
  const key = new THREE.DirectionalLight("#ffe2b8", 2.4);
  key.position.set(-7, 15, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(lite ? 1024 : 2048, lite ? 1024 : 2048);
  const sc = key.shadow.camera;
  sc.left = -11;
  sc.right = 11;
  sc.top = 11;
  sc.bottom = -11;
  sc.near = 1;
  sc.far = 45;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const fill = new THREE.DirectionalLight("#9fc4ff", 0.45);
  fill.position.set(9, 7, -8);
  scene.add(fill);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: "#3b3127", roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.2;
  floor.receiveShadow = true;
  scene.add(floor);

  const table = new THREE.Group();
  const topMat = lacquer("#5a1d14", 0.28);
  const edgeMat = lacquer("#2a0d08", 0.35);
  const top = new THREE.Mesh(new THREE.BoxGeometry(TABLE.w, 0.4, TABLE.d), topMat);
  top.position.y = TABLE.top - 0.2;
  top.receiveShadow = true;
  top.castShadow = true;
  table.add(top);
  const rimH = 0.12;
  for (const [w, d, x, z] of [
    [TABLE.w, 0.18, 0, TABLE.d / 2 - 0.09],
    [TABLE.w, 0.18, 0, -TABLE.d / 2 + 0.09],
    [0.18, TABLE.d, TABLE.w / 2 - 0.09, 0],
    [0.18, TABLE.d, -TABLE.w / 2 + 0.09, 0],
  ]) {
    const rim = new THREE.Mesh(new THREE.BoxGeometry(w, rimH, d), edgeMat);
    rim.position.set(x, TABLE.top + rimH / 2, z);
    rim.castShadow = rim.receiveShadow = true;
    table.add(rim);
  }
  const apron = new THREE.Mesh(new THREE.BoxGeometry(TABLE.w - 1, 0.5, TABLE.d - 1), edgeMat);
  apron.position.y = TABLE.top - 0.65;
  table.add(apron);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.4, 0.6), edgeMat);
      leg.position.set(sx * (TABLE.w / 2 - 0.9), TABLE.top - 1.3, sz * (TABLE.d / 2 - 0.9));
      leg.castShadow = true;
      table.add(leg);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.9), lacquer("#c9a24a", 0.4));
      foot.position.set(sx * (TABLE.w / 2 - 0.9), -2.14, sz * (TABLE.d / 2 - 0.9));
      table.add(foot);
    }
  scene.add(table);

  const boardTop = new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.6 });
  const boardSide = new THREE.MeshStandardMaterial({ color: "#c39350", roughness: 0.55 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W, BOARD_T, BOARD_D), [boardSide, boardSide, boardTop, boardSide, boardSide, boardSide]);
  board.position.y = -BOARD_T / 2;
  board.receiveShadow = true;
  board.castShadow = true;
  scene.add(board);

  // 两侧木盒：左边收白方被提的子，右边收黑方被提的子
  const trays = {};
  for (const [color, x] of [["w", -TRAY_X], ["b", TRAY_X]]) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.5, 28), lacquer(color === "w" ? "#1e262f" : "#6d2418", 0.4));
    base.position.y = TABLE.top + 0.25;
    base.receiveShadow = true;
    base.castShadow = true;
    g.add(base);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.05, 10, 40), lacquer("#c9a24a", 0.35));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = TABLE.top + 0.5;
    g.add(ring);
    g.position.x = x;
    scene.add(g);
    trays[color] = { group: g, x, count: 0 };
  }

  const pickPlane = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_W, BOARD_D), new THREE.MeshBasicMaterial({ visible: false }));
  pickPlane.rotation.x = -Math.PI / 2;
  pickPlane.position.y = 0.01;
  scene.add(pickPlane);

  return { renderer, scene, camera, trays, pickPlane, key };
}

// 木盒里第 i 颗被提的子：叠成一摞小塔
export function traySlot(tray, i) {
  const ring = Math.floor(i / 6);
  const k = i % 6;
  const a = (k / 6) * Math.PI * 2 + ring * 0.5;
  return new THREE.Vector3(tray.x + Math.cos(a) * (0.55 + ring * 0.12), TABLE.top + 0.42 + ring * 0.17, tray.group.position.z + Math.sin(a) * (0.55 + ring * 0.12));
}
