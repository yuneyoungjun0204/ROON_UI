// 웨이포인트 경로 계획 — 항행 가능한 수역만 지나는 최단 경로를 만들고 부드럽게 다듬는다.
// 단계: (1) 시야선이 트이면 직선, (2) 막히면 격자 A*로 최단 경로 탐색,
//       (3) 시야선 단축(shortcut)으로 불필요한 꺾임 제거,
//       (4) 재샘플 + 이동평균으로 완만한 곡선화 (곡선점도 항행 가능해야 채택).

import type { LocalPoint } from "../geo/webMercator";

/** (x, z) 지점이 항행 가능한지 판정하는 콜백 */
export type NavigableFn = (x: number, z: number) => boolean;

export interface PlannedRoute {
  /** 최종 경로점 (씬 ENU 미터) — 첫 점은 계획 시점의 선박 위치 */
  points: LocalPoint[];
  /** 각 웨이포인트가 points에서 차지하는 인덱스 — 도달 판정·표시용 */
  wpIndex: number[];
}

const LOS_STEP_M = 4; // 시야선 검사 샘플 간격
const RESAMPLE_STEP_M = 8; // 경로점 간격 — 추종 정밀도와 곡선 해상도를 정한다
const MAX_GRID_CELLS = 160_000; // A* 격자 상한 — 넘으면 셀을 키워 해상도를 낮춘다
const SMOOTH_PASSES = 3;

const dist = (a: LocalPoint, b: LocalPoint) => Math.hypot(b.x - a.x, b.z - a.z);

/** a→b 직선이 전부 항행 가능한가 (끝점은 호출자가 보장) */
function hasLineOfSight(a: LocalPoint, b: LocalPoint, nav: NavigableFn): boolean {
  const n = Math.max(1, Math.ceil(dist(a, b) / LOS_STEP_M));
  for (let i = 1; i < n; i += 1) {
    const t = i / n;
    if (!nav(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
  }
  return true;
}

/** 최소 힙 — A* 오픈 리스트 (f값 기준) */
class MinHeap {
  private items: number[] = []; // 셀 인덱스
  private keys: number[] = []; // f값

  get size() {
    return this.items.length;
  }

  push(item: number, key: number) {
    const { items, keys } = this;
    let i = items.length;
    items.push(item);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= keys[i]) break;
      [items[p], items[i]] = [items[i], items[p]];
      [keys[p], keys[i]] = [keys[i], keys[p]];
      i = p;
    }
  }

  pop(): number {
    const { items, keys } = this;
    const top = items[0];
    const lastItem = items.pop()!;
    const lastKey = keys.pop()!;
    if (items.length > 0) {
      items[0] = lastItem;
      keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < items.length && keys[l] < keys[smallest]) smallest = l;
        if (r < items.length && keys[r] < keys[smallest]) smallest = r;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        [keys[smallest], keys[i]] = [keys[i], keys[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

/** 격자 A* — start→goal 최단 경로 (셀 중심점 폴리라인). 실패 시 null. */
function aStar(start: LocalPoint, goal: LocalPoint, nav: NavigableFn): LocalPoint[] | null {
  const d = dist(start, goal);
  const pad = Math.max(150, d * 0.6); // 우회 여지 — 직선 거리의 절반 이상 돌아갈 수 있게
  const minX = Math.min(start.x, goal.x) - pad;
  const maxX = Math.max(start.x, goal.x) + pad;
  const minZ = Math.min(start.z, goal.z) - pad;
  const maxZ = Math.max(start.z, goal.z) + pad;

  let cell = Math.max(5, d / 150);
  let cols = Math.ceil((maxX - minX) / cell);
  let rows = Math.ceil((maxZ - minZ) / cell);
  while (cols * rows > MAX_GRID_CELLS) {
    cell *= 1.4;
    cols = Math.ceil((maxX - minX) / cell);
    rows = Math.ceil((maxZ - minZ) / cell);
  }

  const total = cols * rows;
  const clampCol = (x: number) => Math.min(cols - 1, Math.max(0, Math.floor((x - minX) / cell)));
  const clampRow = (z: number) => Math.min(rows - 1, Math.max(0, Math.floor((z - minZ) / cell)));
  const centerX = (cx: number) => minX + (cx + 0.5) * cell;
  const centerZ = (cz: number) => minZ + (cz + 0.5) * cell;

  // 항행 가능 캐시: 0=미확인, 1=가능, 2=불가
  const navCache = new Int8Array(total);
  const cellNav = (cx: number, cz: number): boolean => {
    if (cx < 0 || cz < 0 || cx >= cols || cz >= rows) return false;
    const i = cz * cols + cx;
    let v = navCache[i];
    if (v === 0) {
      v = nav(centerX(cx), centerZ(cz)) ? 1 : 2;
      navCache[i] = v;
    }
    return v === 1;
  };

  /** 기준 셀에서 가장 가까운 항행 가능 셀 (나선 탐색, 반경 제한) */
  const nearestNavigable = (cx: number, cz: number, maxR: number): [number, number] | null => {
    if (cellNav(cx, cz)) return [cx, cz];
    for (let r = 1; r <= maxR; r += 1) {
      for (let dz = -r; dz <= r; dz += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // 링 테두리만
          if (cellNav(cx + dx, cz + dz)) return [cx + dx, cz + dz];
        }
      }
    }
    return null;
  };

  // 시작 셀은 배가 실제로 있는 곳 — 클리어런스에 걸려도 출발은 가능해야 하므로 근처로 스냅
  const startCell = nearestNavigable(clampCol(start.x), clampRow(start.z), 10);
  const goalCell = nearestNavigable(clampCol(goal.x), clampRow(goal.z), 10);
  if (!startCell || !goalCell) return null;

  const startIdx = startCell[1] * cols + startCell[0];
  const goalIdx = goalCell[1] * cols + goalCell[0];

  const gScore = new Float64Array(total).fill(Infinity);
  const parent = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const heap = new MinHeap();

  const heuristic = (cx: number, cz: number) =>
    Math.hypot(cx - goalCell[0], cz - goalCell[1]) * cell;

  gScore[startIdx] = 0;
  heap.push(startIdx, heuristic(startCell[0], startCell[1]));

  const DIAG = Math.SQRT2;
  let found = false;
  while (heap.size > 0) {
    const cur = heap.pop();
    if (cur === goalIdx) {
      found = true;
      break;
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % cols;
    const cz = (cur / cols) | 0;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dz === 0) continue;
        const nx = cx + dx;
        const nz = cz + dz;
        if (!cellNav(nx, nz)) continue;
        // 대각 이동은 양옆 직교 셀도 뚫려 있어야 한다 (모서리 끼어 통과 방지)
        if (dx !== 0 && dz !== 0 && (!cellNav(cx + dx, cz) || !cellNav(cx, cz + dz))) continue;
        const ni = nz * cols + nx;
        if (closed[ni]) continue;
        const g = gScore[cur] + (dx !== 0 && dz !== 0 ? DIAG : 1) * cell;
        if (g >= gScore[ni]) continue;
        gScore[ni] = g;
        parent[ni] = cur;
        heap.push(ni, g + heuristic(nx, nz));
      }
    }
  }
  if (!found) return null;

  const cells: LocalPoint[] = [];
  for (let i = goalIdx; i !== -1; i = parent[i]) {
    cells.push({ x: centerX(i % cols), z: centerZ((i / cols) | 0) });
  }
  cells.reverse();
  // 셀 중심 대신 정확한 출발·목적 좌표로 양 끝을 맞춘다
  cells[0] = { ...start };
  cells[cells.length - 1] = { ...goal };
  return cells;
}

/** 시야선 단축 — 폴리라인에서 직선으로 건너뛸 수 있는 중간점을 제거 */
function shortcut(pts: LocalPoint[], nav: NavigableFn): LocalPoint[] {
  const out: LocalPoint[] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !hasLineOfSight(pts[i], pts[j], nav)) j -= 1;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

/** 한 구간(시작→웨이포인트) 계획: 직선 우선, 막히면 A* + 단축. 탐색 실패 시 직선 폴백. */
function planSegment(a: LocalPoint, b: LocalPoint, nav: NavigableFn): LocalPoint[] {
  if (hasLineOfSight(a, b, nav)) return [a, b];
  const raw = aStar(a, b, nav);
  if (!raw) return [a, b]; // 경로를 못 찾으면 직선 — 충돌 판정이 최후 방어선
  return shortcut(raw, nav);
}

/** 꼭짓점을 유지한 채 각 변에 중간점을 삽입해 간격을 촘촘하게 */
function densify(pts: LocalPoint[], step: number): LocalPoint[] {
  const out: LocalPoint[] = [pts[0]];
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 1; k <= n; k += 1) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

/** 이동평균으로 꺾임을 둥글린다 — 웨이포인트·양 끝점은 고정, 새 점이 물 밖이면 원래 점 유지 */
function smoothInPlace(pts: LocalPoint[], pinned: number[], nav: NavigableFn): void {
  const pin = new Set([0, pts.length - 1, ...pinned]);
  for (let pass = 0; pass < SMOOTH_PASSES; pass += 1) {
    for (let i = 1; i < pts.length - 1; i += 1) {
      if (pin.has(i)) continue;
      const x = pts[i - 1].x * 0.25 + pts[i].x * 0.5 + pts[i + 1].x * 0.25;
      const z = pts[i - 1].z * 0.25 + pts[i].z * 0.5 + pts[i + 1].z * 0.25;
      if (nav(x, z)) pts[i] = { x, z };
    }
  }
}

/** 현재 위치에서 웨이포인트들을 차례로 지나는 부드러운 경로를 계획한다. */
export function planRoute(
  start: LocalPoint,
  waypoints: LocalPoint[],
  nav: NavigableFn,
): PlannedRoute {
  const points: LocalPoint[] = [{ ...start }];
  const wpIndex: number[] = [];
  let cur = start;
  for (const wp of waypoints) {
    const seg = densify(planSegment(cur, wp, nav), RESAMPLE_STEP_M);
    for (let i = 1; i < seg.length; i += 1) points.push(seg[i]);
    wpIndex.push(points.length - 1);
    cur = wp;
  }
  smoothInPlace(points, wpIndex, nav);
  return { points, wpIndex };
}
