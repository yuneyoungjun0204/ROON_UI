// ─────────────────────────────────────────────────────────────────────────
// 아군 선박 3D 렌더링
// - 활성: 녹색 (선택 시 밝은 녹색, 그물 전개 시 파란색)
// - 비활성: 빨간색 + 반투명 + X 표시
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
  });

  // 색상 결정: 비활성=빨간색, 그물전개=파란색, 선택=밝은녹색, 기본=녹색
  const hullColor = !state.alive
    ? 0x880000  // 비활성화: 어두운 빨간색
    : state.painting
    ? 0x0066ff  // 그물 전개 중: 파란색
    : selected
    ? 0x44ff44  // 선택됨: 밝은 녹색
    : 0x228822; // 기본: 녹색

  const opacity = state.alive ? 1.0 : 0.5;
  const markerColor = state.alive ? 0x00ff00 : 0xff0000;

  return (
    <group ref={groupRef}>
      {/* 아군 선박 본체 */}
      <mesh castShadow>
        <boxGeometry args={[40, 10, 90]} />
        <meshStandardMaterial
          color={hullColor}
          metalness={0.3}
          roughness={0.7}
          transparent={!state.alive}
          opacity={opacity}
        />
      </mesh>

      {/* 선수 */}
      <mesh position={[0, 0, -50]} castShadow>
        <coneGeometry args={[20, 25, 4]} />
        <meshStandardMaterial
          color={state.alive ? 0x116611 : 0x661111}
          metalness={0.3}
          roughness={0.7}
          transparent={!state.alive}
          opacity={opacity}
        />
      </mesh>

      {/* 브릿지 */}
      <mesh position={[0, 15, 15]} castShadow>
        <boxGeometry args={[25, 15, 30]} />
        <meshStandardMaterial
          color={state.alive ? 0xcccccc : 0x666666}
          transparent={!state.alive}
          opacity={opacity}
        />
      </mesh>

      {/* 높은 표시 폴 (원거리에서 보이도록) */}
      <mesh position={[0, 60, 0]}>
        <cylinderGeometry args={[3, 3, 120, 8]} />
        <meshBasicMaterial color={markerColor} transparent={!state.alive} opacity={opacity} />
      </mesh>

      {/* 상단 구체 표시 */}
      <mesh position={[0, 130, 0]}>
        <sphereGeometry args={[15]} />
        <meshBasicMaterial
          color={!state.alive ? 0xff0000 : selected ? 0x44ff44 : 0x00aa00}
          transparent={!state.alive}
          opacity={opacity}
        />
      </mesh>

      {/* 비활성화 X 표시 */}
      {!state.alive && (
        <group position={[0, 150, 0]}>
          {/* X 마크 - 두 개의 교차 막대 */}
          <mesh rotation={[0, 0, Math.PI / 4]}>
            <boxGeometry args={[5, 50, 5]} />
            <meshBasicMaterial color={0xff0000} />
          </mesh>
          <mesh rotation={[0, 0, -Math.PI / 4]}>
            <boxGeometry args={[5, 50, 5]} />
            <meshBasicMaterial color={0xff0000} />
          </mesh>
        </group>
      )}

      {/* 선택 링 (활성화된 경우만) */}
      {selected && state.alive && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.3, 0]}>
          <ringGeometry args={[60, 70, 32]} />
          <meshBasicMaterial color={0x00ff00} transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* 그물 전개 중 표시 (활성화된 경우만) */}
      {state.painting && state.alive && (
        <mesh position={[0, 150, 0]}>
          <sphereGeometry args={[20]} />
          <meshBasicMaterial color={0x00aaff} />
        </mesh>
      )}
    </group>
  );
}
