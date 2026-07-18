// ─────────────────────────────────────────────────────────────────────────
// 방어 시뮬레이터 앱
// - 3D 씬 + HUD 통합
// ─────────────────────────────────────────────────────────────────────────

import { DefenseScene } from "./scene/DefenseScene";
import { DefenseHud } from "./ui/DefenseHud";

export function DefenseApp() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
      <DefenseScene />
      <DefenseHud />
    </div>
  );
}
