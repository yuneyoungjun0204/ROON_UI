import { useEffect } from "react";
import { Scene } from "./scene/Scene";
import { Hud } from "./ui/Hud";
import { useMqtt } from "./mqtt/useMqtt";
import { useHttpTelemetry } from "./http/useHttpTelemetry";
import { startSimLoop } from "./store";

export default function App() {
  useEffect(() => startSimLoop(), []);
  useMqtt(); // 텔레메트리(transport=mqtt) + 명령 수신
  useHttpTelemetry(); // 텔레메트리(transport=http) — 업링크 전용

  return (
    <div className="app">
      <Scene />
      <div className="vignette" />
      <Hud />
    </div>
  );
}
