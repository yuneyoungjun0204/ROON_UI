// 경로 추종 자동조타 — 순수 추종(pure pursuit) 방식.
// 경로 위 전방 주시점(lookahead)을 향해 조타하고, 급선회·종점 접근에서는
// 스로틀을 줄여 배가 흔들리지 않고 부드럽게 따라가도록 한다.
//
// 도착 판정은 반경 + 최근접점 통과(CPA) 병용: 목표가 선박의 최소 선회 반경보다
// 가까우면 도착 반경 안으로 파고들지 못하고 목표 주위를 영원히 도는(orbit) 상태에
// 빠질 수 있다 — 포착 반경 안에서 거리가 다시 멀어지기 시작하면 도착으로 처리한다.

import { clampRudder, clampThrottle, type UsvState } from "../sim/usvSim";
import type { LocalPoint } from "../geo/webMercator";

const CRUISE_THROTTLE = 60; // 순항 스로틀 (%)
const MIN_LOOKAHEAD_M = 14; // 저속 주시 거리 — 너무 짧으면 경로 위에서 사행한다
const MAX_LOOKAHEAD_M = 60; // 고속 주시 거리 상한
const LOOKAHEAD_PER_MS = 3.2; // 속도(m/s)당 주시 거리 증가
const ARRIVE_RADIUS_M = 9; // 종점 도착 판정 반경
const CAPTURE_RADIUS_M = 25; // CPA 도착 포착 반경 — 이 안에서 멀어지기 시작하면 도착
const SLOW_RADIUS_M = 80; // 이 거리 안에 들어오면 감속 시작 — 타력(coast)을 감안한 여유
const HEADING_GAIN = 1.5; // 침로 오차(deg) → 타각 지령 비례 이득
const PROGRESS_WINDOW = 50; // 진행 인덱스 갱신 시 앞으로 살펴볼 경로점 수

/** 추종 진행 상태 — 재계획 때마다 새로 만든다 */
export interface FollowState {
  /** 지나온 경로점 인덱스 */
  progress: number;
  /** 포착 반경 안에서 기록한 목표까지의 최소 거리 (CPA 판정용) */
  minGoalDist: number;
}

export function createFollowState(): FollowState {
  return { progress: 0, minGoalDist: Infinity };
}

export interface AutopilotOutput {
  rudderCmd: number;
  throttle: number;
  /** 종점 도착 여부 */
  arrived: boolean;
  /** 경로에서 벗어난 거리 (m) — 크면 호출자가 재계획한다 */
  crossTrack: number;
}

/** 경로를 한 틱 추종한다. state는 재계획 시 createFollowState()로 리셋해 넘긴다. */
export function followRoute(
  usv: UsvState,
  points: LocalPoint[],
  state: FollowState,
): AutopilotOutput {
  const last = points.length - 1;

  // 1) 진행 인덱스 갱신 — 전방 구간에서 현재 위치와 가장 가까운 경로점 (후진 금지)
  let best = state.progress;
  let bestD = Math.hypot(points[best].x - usv.x, points[best].z - usv.z);
  const windowEnd = Math.min(last, state.progress + PROGRESS_WINDOW);
  for (let i = state.progress + 1; i <= windowEnd; i += 1) {
    const d = Math.hypot(points[i].x - usv.x, points[i].z - usv.z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  state.progress = best;

  // 2) 경로 기준 남은 거리
  let remaining = bestD;
  for (let i = best; i < last; i += 1) {
    remaining += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
  }

  // 3) 전방 주시점 — 속도에 비례해 멀리 본다 (빠를수록 완만하게 선회)
  const lookahead = Math.min(
    MAX_LOOKAHEAD_M,
    Math.max(MIN_LOOKAHEAD_M, Math.abs(usv.speed) * LOOKAHEAD_PER_MS),
  );
  let target = points[last];
  let acc = bestD;
  for (let i = best; i < last; i += 1) {
    acc += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
    if (acc >= lookahead) {
      target = points[i + 1];
      break;
    }
  }

  // 4) 조타 — 주시점 방위와 현재 침로의 차이에 비례 (heading: 0=북, 시계방향 / 북 = -z)
  const desired = (Math.atan2(target.x - usv.x, usv.z - target.z) * 180) / Math.PI;
  const err = ((desired - usv.heading + 540) % 360) - 180;
  const rudderCmd = clampRudder(err * HEADING_GAIN);

  // 5) 스로틀 — 선회가 클수록, 종점이 가까울수록 감속
  const turnScale = Math.min(1, Math.max(0.3, 1 - (Math.abs(err) - 20) / 90));
  let throttle = CRUISE_THROTTLE * turnScale;
  if (remaining < SLOW_RADIUS_M) {
    throttle = Math.min(throttle, 8 + 40 * (remaining / SLOW_RADIUS_M));
    // 근접 상태에서 크게 선회 중이면 바짝 감속 — 선회 반경을 줄여 궤도 이탈 방지
    if (Math.abs(err) > 60) throttle = Math.min(throttle, 10);
  }

  // 6) 도착 판정 — 반경 안 진입 또는 포착 반경 내 최근접점 통과(CPA)
  const distToGoal = Math.hypot(points[last].x - usv.x, points[last].z - usv.z);
  let arrived = remaining <= ARRIVE_RADIUS_M || distToGoal <= ARRIVE_RADIUS_M;
  if (!arrived && distToGoal <= CAPTURE_RADIUS_M) {
    if (distToGoal > state.minGoalDist + 1.5) arrived = true; // 스쳐 지나감 — 그만 돌고 도착
    state.minGoalDist = Math.min(state.minGoalDist, distToGoal);
  }

  return {
    rudderCmd,
    throttle: arrived ? 0 : clampThrottle(throttle),
    arrived,
    crossTrack: bestD,
  };
}
