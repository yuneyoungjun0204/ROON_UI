import { useEffect } from "react";
import { Scene } from "./scene/Scene";
import { Hud } from "./ui/Hud";
import { useMqtt } from "./mqtt/useMqtt";
import { startSimLoop } from "./store";

export default function App() {
  useEffect(() => startSimLoop(), []);
  useMqtt();

  return (
    <div className="app">
      <Scene />
      <Hud />
    </div>
  );
}
