// USV(무인수상정) 운동학 시뮬레이션 — 타각/스로틀 입력을 받아 침로·속도·위경도를 적분한다.

export const MAX_SPEED_KN = 40; // 최대 속력 (knots) — 임시 상향 (답답함 해소용, 현실값은 ~20)
export const MAX_RUDDER_DEG = 35;
const KN_TO_MS = 0.514444;
export const MAX_SPEED_MS = MAX_SPEED_KN * KN_TO_MS;
// 3-tau 동역학 (shipmulator 이식): 상황별 시간 상수 분리로 "배다운" 관성을 만든다.
const ACCEL_TAU = 4.0; // 가속 (s)
const COAST_TAU = 7.0; // 타력 — 스로틀을 내리면 천천히 미끄러지며 감속
const BRAKE_TAU = 3.0; // 제동 — 역추진(반대 방향 지령) 시 또렷하게
const RUDDER_SLEW = 40; // 타각 변화 속도 (deg/s) — 풀타까지 약 0.9s
const METERS_PER_DEG_LAT = 111_320;

export interface UsvState {
  lat: number;
  lon: number;
  /** 침로 (deg, 0 = 북, 시계방향) */
  heading: number;
  /** 대지속력 (m/s) */
  speed: number;
  /** 실제 타각 (deg, 좌현 음수) */
  rudder: number;
  /** 목표 타각 — 명령/조작 입력 */
  rudderCmd: number;
  /** 스로틀 (%, 후진 -25 ~ 전진 100) */
  throttle: number;
  /** 씬 ENU 좌표 (m) — x: 동, z: 남 (three.js 평면) */
  x: number;
  z: number;
}

export function createUsvState(lat: number, lon: number): UsvState {
  return { lat, lon, heading: 45, speed: 0, rudder: 0, rudderCmd: 0, throttle: 0, x: 0, z: 0 };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function clampRudder(deg: number): number {
  return clamp(deg, -MAX_RUDDER_DEG, MAX_RUDDER_DEG);
}

export function clampThrottle(pct: number): number {
  return clamp(pct, -25, 100);
}

/** dt(초)만큼 상태를 전진시킨다. 상태 객체를 제자리에서 갱신. */
export function stepUsv(s: UsvState, dt: number): void {
  // 타각은 목표값으로 서서히 이동 (조타기 속도 제한)
  const rudderDelta = clamp(s.rudderCmd - s.rudder, -RUDDER_SLEW * dt, RUDDER_SLEW * dt);
  s.rudder += rudderDelta;

  // 스로틀 → 목표 속력. 상황(가속/타력/제동)에 맞는 시간 상수로 1차 지연 수렴.
  const targetSpeed = MAX_SPEED_MS * (s.throttle / 100);
  let tau: number;
  if (Math.abs(targetSpeed) > Math.abs(s.speed) && targetSpeed * s.speed >= 0) {
    tau = ACCEL_TAU; // 같은 방향으로 더 빠르게
  } else if (targetSpeed * s.speed < -0.01) {
    tau = BRAKE_TAU; // 역추진 제동
  } else {
    tau = COAST_TAU; // 타력으로 미끄러지며 감속
  }
  s.speed += ((targetSpeed - s.speed) / tau) * dt;
  if (Math.abs(s.speed) < 0.005 && s.throttle === 0) s.speed = 0;

  // 선회율: 타각 × 속도 곡선 v/(v+3.5) — 저속에선 둔하고 속도가 붙을수록 기민해진다.
  // (풀타 기준: 2kn ≈ 4.4°/s, 10kn ≈ 11.4°/s, 20kn ≈ 14.4°/s)
  const av = Math.abs(s.speed);
  const turnRate = s.rudder * 0.55 * (av / (av + 3.5)) * Math.sign(s.speed || 1);
  s.heading = (s.heading + turnRate * dt + 360) % 360;

  // 급선회 시 속력 손실 — 코너에서 자연스럽게 감속하는 느낌
  const speedFactor = clamp(av / MAX_SPEED_MS, 0, 1);
  const turnLoss = (Math.abs(s.rudder) / MAX_RUDDER_DEG) * speedFactor * 0.12;
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
