// ─────────────────────────────────────────────────────────────────────────
// 아군 선박 3D 렌더링
// ─────────────────────────────────────────────────────────────────────────

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { AllyState } from "../types/defense";
import { DEFENSE_CONFIG as C } from "../config/defense";

interface AllyShipProps {
  state: AllyState;
  selected?: boolean;
}

export function AllyShip({ state, selected = false }: AllyShipProps) {
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

  // 그물 전개 중이면 파란색, 선택되면 밝은 녹색
  const hullColor = state.painting ? 0x0066ff : selected ? 0x44ff44 : 0x228822;

  return (
    <group ref={groupRef}>
      {/* 아군 선박 본체 - 크기 증가 */}
      <mesh castShadow>
        <boxGeometry args={[40, 10, 90]} />
        <meshStandardMaterial
          color={hullColor}
          metalness={0.3}
          roughness={0.7}
        />
      </mesh>

      {/* 선수 */}
      <mesh position={[0, 0, -50]} castShadow>
        <coneGeometry args={[20, 25, 4]} />
        <meshStandardMaterial
          color={0x116611}
          metalness={0.3}
          roughness={0.7}
        />
      </mesh>

      {/* 브릿지 */}
      <mesh position={[0, 15, 15]} castShadow>
        <boxGeometry args={[25, 15, 30]} />
        <meshStandardMaterial color={0xcccccc} />
      </mesh>

      {/* 높은 표시 폴 (원거리에서 보이도록) */}
      <mesh position={[0, 60, 0]}>
        <cylinderGeometry args={[3, 3, 120, 8]} />
        <meshBasicMaterial color={0x00ff00} />
      </mesh>

      {/* 상단 구체 표시 */}
      <mesh position={[0, 130, 0]}>
        <sphereGeometry args={[15]} />
        <meshBasicMaterial color={selected ? 0x44ff44 : 0x00aa00} />
      </mesh>

      {/* 선택 링 */}
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.3, 0]}>
          <ringGeometry args={[60, 70, 32]} />
          <meshBasicMaterial color={0x00ff00} transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* 그물 전개 중 표시 */}
      {state.painting && (
        <mesh position={[0, 150, 0]}>
          <sphereGeometry args={[20]} />
          <meshBasicMaterial color={0x00aaff} />
        </mesh>
      )}
    </group>
  );
}
