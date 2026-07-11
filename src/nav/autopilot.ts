// 경로 추종 자동조타 — 순수 추종(pure pursuit) 방식.
// 경로 위 전방 주시점(lookahead)을 향해 조타하고, 급선회·종점 접근에서는
// 스로틀을 줄여 배가 흔들리지 않고 부드럽게 따라가도록 한다.

import { clampRudder, clampThrottle, type UsvState } from "../sim/usvSim";
import type { LocalPoint } from "../geo/webMercator";

const CRUISE_THROTTLE = 60; // 순항 스로틀 (%)
const MIN_LOOKAHEAD_M = 14; // 저속 주시 거리 — 너무 짧으면 경로 위에서 사행한다
const MAX_LOOKAHEAD_M = 60; // 고속 주시 거리 상한
const LOOKAHEAD_PER_MS = 3.2; // 속도(m/s)당 주시 거리 증가
const ARRIVE_RADIUS_M = 9; // 종점 도착 판정 반경
const SLOW_RADIUS_M = 80; // 이 거리 안에 들어오면 감속 시작 — 타력(coast)을 감안한 여유
const HEADING_GAIN = 1.5; // 침로 오차(deg) → 타각 지령 비례 이득
const PROGRESS_WINDOW = 50; // 진행 인덱스 갱신 시 앞으로 살펴볼 경로점 수

export interface AutopilotOutput {
  rudderCmd: number;
  throttle: number;
  /** 갱신된 진행 인덱스 — 다음 틱에 그대로 넘겨준다 */
  progress: number;
  /** 종점 도착 여부 */
  arrived: boolean;
}

/** 경로를 한 틱 추종한다. progress는 지난 틱의 반환값(최초 0). */
export function followRoute(
  usv: UsvState,
  points: LocalPoint[],
  progress: number,
): AutopilotOutput {
  const last = points.length - 1;

  // 1) 진행 인덱스 갱신 — 전방 구간에서 현재 위치와 가장 가까운 경로점 (후진 금지)
  let best = progress;
  let bestD = Math.hypot(points[progress].x - usv.x, points[progress].z - usv.z);
  const windowEnd = Math.min(last, progress + PROGRESS_WINDOW);
  for (let i = progress + 1; i <= windowEnd; i += 1) {
    const d = Math.hypot(points[i].x - usv.x, points[i].z - usv.z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  progress = best;

  // 2) 경로 기준 남은 거리
  let remaining = bestD;
  for (let i = progress; i < last; i += 1) {
    remaining += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
  }

  // 3) 전방 주시점 — 속도에 비례해 멀리 본다 (빠를수록 완만하게 선회)
  const lookahead = Math.min(
    MAX_LOOKAHEAD_M,
    Math.max(MIN_LOOKAHEAD_M, Math.abs(usv.speed) * LOOKAHEAD_PER_MS),
  );
  let target = points[last];
  let acc = bestD;
  for (let i = progress; i < last; i += 1) {
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
    throttle = Math.min(throttle, 10 + 45 * (remaining / SLOW_RADIUS_M));
  }

  const distToGoal = Math.hypot(points[last].x - usv.x, points[last].z - usv.z);
  const arrived = remaining <= ARRIVE_RADIUS_M || distToGoal <= ARRIVE_RADIUS_M;

  return {
    rudderCmd,
    throttle: arrived ? 0 : clampThrottle(throttle),
    progress,
    arrived,
  };
}
