// 전역 상태 — 시뮬레이션 상태와 MQTT 연결 상태.
// 시뮬레이션 틱(20Hz)은 여기서 setInterval로 돌리고,
// 3D 씬은 리렌더 없이 getState()로 매 프레임 읽는다.

import { create } from "zustand";
import { config } from "./config";
import {
  createUsvState,
  stepUsv,
  clampRudder,
  clampThrottle,
  type UsvState,
} from "./sim/usvSim";

export type MqttStatus = "disconnected" | "connecting" | "connected";

interface SimStore {
  usv: UsvState;
  mqttStatus: MqttStatus;
  /** 마지막으로 수신한 원격 명령 설명 (HUD 표시용) */
  lastCommand: string | null;
  setRudderCmd: (deg: number) => void;
  setThrottle: (pct: number) => void;
  setMqttStatus: (s: MqttStatus) => void;
  setLastCommand: (text: string) => void;
}

export const useSimStore = create<SimStore>((set) => ({
  usv: createUsvState(config.initialLat, config.initialLon),
  mqttStatus: "disconnected",
  lastCommand: null,
  setRudderCmd: (deg) =>
    set((st) => ({ usv: { ...st.usv, rudderCmd: clampRudder(deg) } })),
  setThrottle: (pct) =>
    set((st) => ({ usv: { ...st.usv, throttle: clampThrottle(pct) } })),
  setMqttStatus: (mqttStatus) => set({ mqttStatus }),
  setLastCommand: (lastCommand) => set({ lastCommand }),
}));

const TICK_MS = 50;

/** 미니맵용 항적 — 씬 ENU 좌표 [x, z] 쌍의 평면 배열. 리렌더 없이 캔버스가 직접 읽는다. */
export const trail: number[] = [];
const TRAIL_MIN_DIST = 2.5; // m — 이 이상 움직였을 때만 점 추가
const TRAIL_MAX_POINTS = 3000;

/** 시뮬레이션 루프 시작. App 마운트 시 한 번 호출. 정리 함수를 반환.
 * dt는 실제 경과 시간으로 계산한다 — 타이머가 밀려도 시뮬레이션 시간이 느려지지 않게. */
export function startSimLoop(): () => void {
  let last = performance.now();
  const id = setInterval(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.5); // 탭 복귀 등 큰 공백은 잘라냄
    last = now;
    const { usv } = useSimStore.getState();
    const next = { ...usv };
    stepUsv(next, dt);
    useSimStore.setState({ usv: next });

    const n = trail.length;
    const moved =
      n === 0 || Math.hypot(next.x - trail[n - 2], next.z - trail[n - 1]) >= TRAIL_MIN_DIST;
    if (moved) {
      trail.push(next.x, next.z);
      if (trail.length > TRAIL_MAX_POINTS * 2) trail.splice(0, 2);
    }
  }, TICK_MS);
  return () => clearInterval(id);
}
