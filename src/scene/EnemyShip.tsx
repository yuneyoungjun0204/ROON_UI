// ─────────────────────────────────────────────────────────────────────────
// 적 선박 3D 렌더링
// ─────────────────────────────────────────────────────────────────────────

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { EnemyState } from "../types/defense";
import { DEFENSE_CONFIG as C } from "../config/defense";

const CLUSTER_COLORS = [0xff4444, 0xff8800, 0xffff00, 0xff44ff];

interface EnemyShipProps {
  state: EnemyState;
}

export function EnemyShip({ state }: EnemyShipProps) {
  const groupRef = useRef<THREE.Group>(null);
  const offset = C.worldSize / 2;

  useFrame(() => {
    if (!groupRef.current) return;

    groupRef.current.position.set(
      state.x - offset,
      0.5,
      state.z - offset
    );
    groupRef.current.rotation.y = -(state.heading * Math.PI) / 180;
    groupRef.current.visible = state.alive;
  });

  if (!state.alive) return null;

  const clusterColor = CLUSTER_COLORS[state.clusterId % CLUSTER_COLORS.length];

  return (
    <group ref={groupRef}>
      {/* 적 선박 본체 - 크기 증가 (5km 거리에서 보이도록) */}
      <mesh castShadow>
        <boxGeometry args={[30, 8, 60]} />
        <meshStandardMaterial
          color={0x661111}
          metalness={0.4}
          roughness={0.6}
        />
      </mesh>

      {/* 선수 (뾰족한 부분) */}
      <mesh position={[0, 0, -35]} castShadow>
        <coneGeometry args={[15, 20, 4]} />
        <meshStandardMaterial
          color={0x881111}
          metalness={0.4}
          roughness={0.6}
        />
      </mesh>

      {/* 높은 표시 폴 (원거리에서 보이도록) */}
      <mesh position={[0, 50, 0]}>
        <cylinderGeometry args={[3, 3, 100, 8]} />
        <meshBasicMaterial color={clusterColor} />
      </mesh>

      {/* 상단 구체 표시 */}
      <mesh position={[0, 110, 0]}>
        <sphereGeometry args={[15]} />
        <meshBasicMaterial color={0xff0000} />
      </mesh>
    </group>
  );
}
