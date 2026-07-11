// USV(무인수상정) 운동학 시뮬레이션 — 쌍동선 차동 추진(differential thrust) 모델.
// 좌/우 헐 최후미에 정·역회전 가능한 쓰러스터가 하나씩 달려 있다고 가정한다:
//   양쪽 정방향 = 전진, 양쪽 역방향 = 후진, 차동(좌우 반대) = 선회.
//   좌 +100 / 우 -100처럼 극단적으로 반대면 거의 제자리에서 회전한다.
// 조종 지령은 스로틀(전후진)·조향 두 축이고, 믹서가 좌/우 쓰러스터 출력으로 변환한다.

export const MAX_SPEED_KN = 40; // 최대 속력 (knots) — 임시 상향 (답답함 해소용, 현실값은 ~20)
const KN_TO_MS = 0.514444;
export const MAX_SPEED_MS = MAX_SPEED_KN * KN_TO_MS;

/** 풀 차동(좌 +100 / 우 -100) 제자리 회전 속도 (deg/s) */
export const MAX_YAW_RATE_DPS = 28;

// 3-tau 동역학 (shipmulator 이식): 상황별 시간 상수 분리로 "배다운" 관성을 만든다.
const ACCEL_TAU = 4.0; // 가속 (s)
const COAST_TAU = 7.0; // 타력 — 스로틀을 내리면 천천히 미끄러지며 감속
const BRAKE_TAU = 3.0; // 제동 — 역추진(반대 방향 지령) 시 또렷하게
const THRUST_SLEW = 160; // 쓰러스터 출력 변화 속도 (%/s) — 풀스윙(−100→+100)까지 약 1.25s
const YAW_TAU = 1.1; // 회두 관성 — 차동 추력이 요 레이트로 반영되는 지연 (s)
const METERS_PER_DEG_LAT = 111_320;

export interface UsvState {
  lat: number;
  lon: number;
  /** 침로 (deg, 0 = 북, 시계방향) */
  heading: number;
  /** 대지속력 (m/s, 후진 음수) */
  speed: number;
  /** 요 레이트 (deg/s, 우회전 양수) */
  yawRate: number;
  /** 좌현(port) 쓰러스터 실제 출력 (%, 역방향 -100 ~ 정방향 +100) */
  thrustPort: number;
  /** 우현(starboard) 쓰러스터 실제 출력 (%) */
  thrustStbd: number;
  /** 전후진 지령 (%, -100 ~ +100) — 좌우 쓰러스터 공통 성분 */
  throttle: number;
  /** 조향 지령 (%, 좌회전 -100 ~ 우회전 +100) — 좌우 쓰러스터 차동 성분 */
  steer: number;
  /** 씬 ENU 좌표 (m) — x: 동, z: 남 (three.js 평면) */
  x: number;
  z: number;
}

export function createUsvState(lat: number, lon: number): UsvState {
  return {
    lat,
    lon,
    heading: 45,
    speed: 0,
    yawRate: 0,
    thrustPort: 0,
    thrustStbd: 0,
    throttle: 0,
    steer: 0,
    x: 0,
    z: 0,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function clampThrottle(pct: number): number {
  return clamp(pct, -100, 100);
}

export function clampSteer(pct: number): number {
  return clamp(pct, -100, 100);
}

/** dt(초)만큼 상태를 전진시킨다. 상태 객체를 제자리에서 갱신. */
export function stepUsv(s: UsvState, dt: number): void {
  // 믹서: 지령(스로틀·조향) → 좌/우 쓰러스터 목표 출력.
  // 우회전(+steer)은 좌현을 증속, 우현을 감속 — 포화되면 전진 추력이 자연히 줄어든다.
  const cmdPort = clamp(s.throttle + s.steer, -100, 100);
  const cmdStbd = clamp(s.throttle - s.steer, -100, 100);

  // 쓰러스터 응답 (출력 변화 속도 제한)
  s.thrustPort += clamp(cmdPort - s.thrustPort, -THRUST_SLEW * dt, THRUST_SLEW * dt);
  s.thrustStbd += clamp(cmdStbd - s.thrustStbd, -THRUST_SLEW * dt, THRUST_SLEW * dt);

  // 전진: 좌우 평균 추력 → 목표 속력. 상황(가속/타력/제동)에 맞는 시간 상수로 1차 지연 수렴.
  const surge = (s.thrustPort + s.thrustStbd) / 2; // -100 ~ 100
  const targetSpeed = MAX_SPEED_MS * (surge / 100);
  let tau: number;
  if (Math.abs(targetSpeed) > Math.abs(s.speed) && targetSpeed * s.speed >= 0) {
    tau = ACCEL_TAU; // 같은 방향으로 더 빠르게
  } else if (targetSpeed * s.speed < -0.01) {
    tau = BRAKE_TAU; // 역추진 제동
  } else {
    tau = COAST_TAU; // 타력으로 미끄러지며 감속
  }
  s.speed += ((targetSpeed - s.speed) / tau) * dt;
  if (Math.abs(s.speed) < 0.005 && Math.abs(surge) < 1) s.speed = 0;

  // 회두: 차동 추력 → 목표 요 레이트. 속도와 무관하게 작동 — 제자리 회전이 가능하다.
  const diff = (s.thrustPort - s.thrustStbd) / 2; // -100 ~ 100 (우회전 양수)
  const targetYaw = MAX_YAW_RATE_DPS * (diff / 100);
  s.yawRate += ((targetYaw - s.yawRate) / YAW_TAU) * dt;
  s.heading = (s.heading + s.yawRate * dt + 360) % 360;

  // 급선회 시 속력 손실 — 코너에서 자연스럽게 감속하는 느낌
  const turnLoss = (Math.abs(s.yawRate) / MAX_YAW_RATE_DPS) * 0.1;
  s.speed -= s.speed * turnLoss * dt;

  // 위치 적분 (위경도 + 씬 ENU 동시)
  const rad = (s.heading * Math.PI) / 180;
  const vNorth = s.speed * Math.cos(rad);
  const vEast = s.speed * Math.sin(rad);
  s.lat += (vNorth * dt) / METERS_PER_DEG_LAT;
  s.lon += (vEast * dt) / (METERS_PER_DEG_LAT * Math.cos((s.lat * Math.PI) / 180));
  s.x += vEast * dt;
  s.z -= vNorth * dt; // three.js: 북쪽 = -z
}
