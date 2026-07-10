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

/** 시뮬레이션 루프 시작. App 마운트 시 한 번 호출. 정리 함수를 반환. */
export function startSimLoop(): () => void {
  const id = setInterval(() => {
    const { usv } = useSimStore.getState();
    const next = { ...usv };
    stepUsv(next, TICK_MS / 1000);
    useSimStore.setState({ usv: next });
  }, TICK_MS);
  return () => clearInterval(id);
}
