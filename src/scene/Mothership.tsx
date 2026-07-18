// ─────────────────────────────────────────────────────────────────────────
// 모선 3D 렌더링
// ─────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import type { MothershipState } from "../types/defense";
import { DEFENSE_CONFIG as C } from "../config/defense";

interface MothershipProps {
  state: MothershipState;
}

export function Mothership({ state }: MothershipProps) {
  const offset = C.worldSize / 2;
  const x = state.x - offset;
  const z = state.z - offset;

  return (
    <group position={[x, 0, z]}>
      {/* 모선 본체 (항공모함 스타일) */}
      <mesh castShadow receiveShadow position={[0, 4, 0]}>
        <boxGeometry args={[60, 8, 250]} />
        <meshStandardMaterial
          color={0x445566}
          metalness={0.6}
          roughness={0.4}
        />
      </mesh>

      {/* 갑판 */}
      <mesh position={[0, 8.5, 0]} receiveShadow>
        <boxGeometry args={[55, 1, 240]} />
        <meshStandardMaterial color={0x334455} />
      </mesh>

      {/* 함교 */}
      <mesh position={[20, 16, 50]} castShadow>
        <boxGeometry args={[15, 15, 40]} />
        <meshStandardMaterial color={0x556677} />
      </mesh>

      {/* 레이더 돔 */}
      <mesh position={[20, 26, 50]}>
        <sphereGeometry args={[5]} />
        <meshStandardMaterial color={0xffffff} />
      </mesh>

      {/* 선수 */}
      <mesh position={[0, 2, -130]} castShadow>
        <coneGeometry args={[30, 15, 4]} />
        <meshStandardMaterial color={0x445566} />
      </mesh>

      {/* Breach 반경 표시 (반투명 원) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.5, 0]}>
        <ringGeometry args={[state.radius - 10, state.radius, 64]} />
        <meshBasicMaterial
          color={0xff0000}
          transparent
          opacity={0.3}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Breach 반경 내부 (더 연한 표시) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.3, 0]}>
        <circleGeometry args={[state.radius, 64]} />
        <meshBasicMaterial
          color={0xff0000}
          transparent
          opacity={0.1}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 안전 구역 외곽선 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.6, 0]}>
        <ringGeometry args={[state.radius, state.radius + 3, 64]} />
        <meshBasicMaterial
          color={0xffff00}
          transparent
          opacity={0.5}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
