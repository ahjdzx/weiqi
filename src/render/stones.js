/**
 * [INPUT]: 依赖 three
 * [OUTPUT]: 导出 STONE_R、createStone（一颗围棋子：扁圆的云子）
 * [POS]: render 的棋子工厂。黑子亮黑、白子温润米白，微微高出棋盘一点，落下来会压扁一点点。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */
import * as THREE from "three";

export const STONE_R = 0.42;

const blackMat = new THREE.MeshStandardMaterial({ color: "#17181c", roughness: 0.22, metalness: 0.08 });
const whiteMat = new THREE.MeshStandardMaterial({ color: "#efeadd", roughness: 0.38, metalness: 0.02 });

export function createStone(color) {
  const geo = new THREE.SphereGeometry(STONE_R, 24, 16);
  geo.scale(1, 0.52, 1);
  const m = new THREE.Mesh(geo, color === "b" ? blackMat : whiteMat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
