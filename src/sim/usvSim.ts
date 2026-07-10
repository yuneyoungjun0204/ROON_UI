// USV(무인수상정) 운동학 시뮬레이션 — 타각/스로틀 입력을 받아 침로·속도·위경도를 적분한다.

export const MAX_SPEED_KN = 30; // 최대 속력 (knots) — 고속 USV급
export const MAX_RUDDER_DEG = 35;
const KN_TO_MS = 0.514444;
export const MAX_SPEED_MS = MAX_SPEED_KN * KN_TO_MS;
const ACCEL_TAU = 6; // 가감속 시간 상수 (s)
const RUDDER_SLEW = 12; // 타각 변화 속도 (deg/s)
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

  // 스로틀 → 목표 속력으로 1차 지연 수렴
  const targetSpeed = MAX_SPEED_MS * (s.throttle / 100);
  s.speed += ((targetSpeed - s.speed) / ACCEL_TAU) * dt;

  // 선회율: 타각과 속력에 비례 (풀타·풀스피드에서 약 2.6 deg/s)
  const speedFactor = clamp(Math.abs(s.speed) / MAX_SPEED_MS, 0, 1);
  const turnRate = s.rudder * 0.12 * speedFactor * Math.sign(s.speed || 1);
  s.heading = (s.heading + turnRate * dt + 360) % 360;

  // 위치 적분 (위경도 + 씬 ENU 동시)
  const rad = (s.heading * Math.PI) / 180;
  const vNorth = s.speed * Math.cos(rad);
  const vEast = s.speed * Math.sin(rad);
  s.lat += (vNorth * dt) / METERS_PER_DEG_LAT;
  s.lon += (vEast * dt) / (METERS_PER_DEG_LAT * Math.cos((s.lat * Math.PI) / 180));
  s.x += vEast * dt;
  s.z -= vNorth * dt; // three.js: 북쪽 = -z
}
