// ─────────────────────────────────────────────────────────────────────────
// 방어 시뮬레이터 앱
// - 3D 씬 + HUD 통합
// - MQTT 연동 (ROS2 브릿지)
// - 시뮬레이션 루프
// ─────────────────────────────────────────────────────────────────────────

import { useEffect } from "react";
import { DefenseScene } from "./scene/DefenseScene";
import { DefenseHud } from "./ui/DefenseHud";
import { useDefenseMqtt } from "./mqtt/useDefenseMqtt";
import { startDefenseLoop } from "./defenseStore";

export function DefenseApp() {
  // MQTT 연동 (ROS2 브릿지와 통신)
  useDefenseMqtt();

  // 시뮬레이션 루프 시작
  useEffect(() => {
    const cleanup = startDefenseLoop();
    return cleanup;
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
      <DefenseScene />
      <DefenseHud />
    </div>
  );
}
