// ─────────────────────────────────────────────────────────────────────────
// 브릿지/시각화 모드 앱
// - 외부에서 적군/아군 데이터를 MQTT로 수신
// - 시뮬레이션 없이 시각화만 담당
// - 중간 브릿지 역할 (데이터 전달)
// ─────────────────────────────────────────────────────────────────────────

import { useEffect } from "react";
import { DefenseScene } from "./scene/DefenseScene";
import { DefenseHud } from "./ui/DefenseHud";
import { useBridgeMqtt } from "./mqtt/useBridgeMqtt";
import { useDefenseStore } from "./defenseStore";

export function BridgeApp() {
  // 브릿지 모드 설정
  useEffect(() => {
    useDefenseStore.getState().setBridgeMode(true);
    console.log("[BridgeApp] 브릿지 모드 활성화 - 외부 데이터 수신 대기");
    return () => {
      useDefenseStore.getState().setBridgeMode(false);
    };
  }, []);

  // MQTT 연동 (외부 데이터 구독)
  useBridgeMqtt();

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
      <DefenseScene />
      <DefenseHud />
      {/* 브릿지 모드 표시 */}
      <div style={{
        position: "fixed",
        top: 10,
        left: "50%",
        transform: "translateX(-50%)",
        background: "rgba(0, 150, 255, 0.8)",
        color: "white",
        padding: "8px 16px",
        borderRadius: 4,
        fontSize: 14,
        fontWeight: "bold",
        zIndex: 9999,
      }}>
        🔗 BRIDGE MODE - 외부 데이터 수신 중
      </div>
    </div>
  );
}
