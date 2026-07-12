// 계획 항로의 3D 표시 — 수면 위 점선 경로와 웨이포인트 마커(기둥 + 구).
// 경로 재계획은 드물게 일어나므로 스토어 구독(리렌더)으로 충분하다.
// 항로 오브젝트는 전용 레이어에 두어 메인(추적) 카메라에만 보이고
// 선수 FPV 카메라(레이어 0만 봄)에는 나타나지 않는다.

import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import { useSimStore } from "../store";
import { WATER_LEVEL_Y } from "../sim/waves";
import { config } from "../config";

/** 항로 표시 전용 레이어 — FPV 카메라에서 숨기기 위해 기본(0)과 분리 */
export const ROUTE_LAYER = 1;

const ROUTE_Y = (config.vworldKey ? WATER_LEVEL_Y : 0) + 0.4;
const ROUTE_COLOR = "#ffbe5c";
const REACHED_COLOR = "#8c9ba8";

export function RouteLine() {
  const groupRef = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  const route = useSimStore((s) => s.route);
  const waypoints = useSimStore((s) => s.waypoints);
  const reachedCount = useSimStore((s) => s.reachedCount);

  // 메인 카메라가 항로 레이어를 보도록 켠다 (FPV 카메라는 레이어 0만 유지)
  useEffect(() => {
    camera.layers.enable(ROUTE_LAYER);
  }, [camera]);

  // 레이어는 상속되지 않으므로 자식이 바뀔 때마다 전체를 항로 레이어로 옮긴다
  useEffect(() => {
    groupRef.current?.traverse((o) => o.layers.set(ROUTE_LAYER));
  }, [route, waypoints]);

  return (
    <group ref={groupRef}>
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
