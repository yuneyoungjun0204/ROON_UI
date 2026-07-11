// 키보드 조작 상태 — HUD의 키 이벤트와 시뮬 루프가 공유한다.
// 눌린 키를 여기 기록해두고, 시뮬 틱에서 dt 기반으로 지령을 매끄럽게 램프한다.
// (키다운 반복에 의존하지 않으므로 프레임률·OS 반복 지연과 무관하게 일정한 조작감을 준다.)

import { clampSteer, clampThrottle, type UsvState } from "./usvSim";

export const controls = {
  left: false,
  right: false,
  throttleUp: false,
  throttleDown: false,
  /** 키보드로 조향 중인지 — 키를 떼면 조향을 자동으로 중앙 복원할지 판단하는 게이트.
   *  슬라이더/원격(MQTT) 조향에는 개입하지 않게 하려고 키 입력일 때만 켠다. */
  steering: false,
};

const STEER_RATE = 140; // %/s — 키를 누르는 동안 조향 지령 증가율 (풀조향까지 약 0.7s)
const CENTER_RATE = 200; // %/s — 키를 떼면 조향이 중앙으로 복원되는 속도
const THROTTLE_RATE = 55; // %/s — 스로틀 증감율

/** 눌린 키에 따라 steer/throttle을 dt만큼 갱신해 돌려준다. */
export function applyKeyboardControls(
  s: UsvState,
  dt: number,
): { steer: number; throttle: number } {
  let steer = s.steer;
  let throttle = s.throttle;

  const dir = (controls.right ? 1 : 0) - (controls.left ? 1 : 0);
  if (dir !== 0) {
    controls.steering = true;
    steer = clampSteer(steer + dir * STEER_RATE * dt);
  } else if (controls.steering) {
    // 조향 키를 떼면 서서히 중앙으로 (직진 복귀)
    const step = CENTER_RATE * dt;
    if (steer > step) steer -= step;
    else if (steer < -step) steer += step;
    else {
      steer = 0;
      controls.steering = false;
    }
  }

  const thr = (controls.throttleUp ? 1 : 0) - (controls.throttleDown ? 1 : 0);
  if (thr !== 0) {
    throttle = clampThrottle(throttle + thr * THROTTLE_RATE * dt);
  }

  return { steer, throttle };
}

/** 창 포커스를 잃었을 때 등, 눌림 상태를 모두 해제 (키가 눌린 채로 붙어버리는 것 방지). */
export function resetControls(): void {
  controls.left = false;
  controls.right = false;
  controls.throttleUp = false;
  controls.throttleDown = false;
}
