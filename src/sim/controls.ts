// 키보드 조작 상태 — HUD의 키 이벤트와 시뮬 루프가 공유한다.
// 눌린 키를 여기 기록해두고, 시뮬 틱에서 dt 기반으로 지령을 매끄럽게 램프한다.
// (키다운 반복에 의존하지 않으므로 프레임률·OS 반복 지연과 무관하게 일정한 조작감을 준다.)

import { clampRudder, clampThrottle, type UsvState } from "./usvSim";

export const controls = {
  left: false,
  right: false,
  throttleUp: false,
  throttleDown: false,
  /** 키보드로 조타 중인지 — 키를 떼면 타를 자동으로 중앙 복원할지 판단하는 게이트.
   *  슬라이더/원격(MQTT) 조타에는 개입하지 않게 하려고 키 입력일 때만 켠다. */
  steering: false,
};

const STEER_RATE = 48; // deg/s — 키를 누르는 동안 타각 지령 증가율 (풀타까지 약 0.7s)
const CENTER_RATE = 65; // deg/s — 키를 떼면 타가 중앙으로 복원되는 속도
const THROTTLE_RATE = 45; // %/s — 스로틀 증감율

/** 눌린 키에 따라 rudderCmd/throttle을 dt만큼 갱신해 돌려준다. */
export function applyKeyboardControls(
  s: UsvState,
  dt: number,
): { rudderCmd: number; throttle: number } {
  let rudderCmd = s.rudderCmd;
  let throttle = s.throttle;

  const steer = (controls.right ? 1 : 0) - (controls.left ? 1 : 0);
  if (steer !== 0) {
    controls.steering = true;
    rudderCmd = clampRudder(rudderCmd + steer * STEER_RATE * dt);
  } else if (controls.steering) {
    // 조타 키를 떼면 타를 서서히 중앙으로 (직진 복귀)
    const step = CENTER_RATE * dt;
    if (rudderCmd > step) rudderCmd -= step;
    else if (rudderCmd < -step) rudderCmd += step;
    else {
      rudderCmd = 0;
      controls.steering = false;
    }
  }

  const thr = (controls.throttleUp ? 1 : 0) - (controls.throttleDown ? 1 : 0);
  if (thr !== 0) {
    throttle = clampThrottle(throttle + thr * THROTTLE_RATE * dt);
  }

  return { rudderCmd, throttle };
}

/** 창 포커스를 잃었을 때 등, 눌림 상태를 모두 해제 (키가 눌린 채로 붙어버리는 것 방지). */
export function resetControls(): void {
  controls.left = false;
  controls.right = false;
  controls.throttleUp = false;
  controls.throttleDown = false;
}
