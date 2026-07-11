// 계획 항로의 3D 표시 — 수면 위 점선 경로와 웨이포인트 마커(기둥 + 구).
// 경로 재계획은 드물게 일어나므로 스토어 구독(리렌더)으로 충분하다.

import { Line } from "@react-three/drei";
import { useSimStore } from "../store";
import { WATER_LEVEL_Y } from "../sim/waves";
import { config } from "../config";

const ROUTE_Y = (config.vworldKey ? WATER_LEVEL_Y : 0) + 0.4;
const ROUTE_COLOR = "#ffbe5c";
const REACHED_COLOR = "#8c9ba8";

export function RouteLine() {
  const route = useSimStore((s) => s.route);
  const waypoints = useSimStore((s) => s.waypoints);
  const reachedCount = useSimStore((s) => s.reachedCount);

  return (
    <group>
      {route && route.points.length >= 2 && (
        <Line
          points={route.points.map((p) => [p.x, ROUTE_Y, p.z] as [number, number, number])}
          color={ROUTE_COLOR}
          lineWidth={2}
          dashed
          dashSize={3.5}
          gapSize={2.5}
          transparent
          opacity={0.85}
        />
      )}
      {waypoints.map((p, i) => {
        const reached = i < reachedCount;
        const color = reached ? REACHED_COLOR : ROUTE_COLOR;
        return (
          <group key={`${p.x.toFixed(1)}:${p.z.toFixed(1)}`} position={[p.x, ROUTE_Y, p.z]}>
            <mesh position={[0, 1.6, 0]}>
              <cylinderGeometry args={[0.09, 0.09, 3.2, 8]} />
              <meshStandardMaterial color={color} />
            </mesh>
            <mesh position={[0, 3.5, 0]}>
              <sphereGeometry args={[0.55, 16, 12]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={reached ? 0.15 : 0.7}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
