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

  // 모선은 일반 선박의 3배 크기
  const shipScale = 3;
  const { shipLength, shipWidth, shipHeight } = C.render;
  const mLen = shipLength * shipScale;
  const mWid = shipWidth * shipScale * 0.8;
  const mHgt = shipHeight * shipScale;

  return (
    <group position={[x, 0, z]}>
      {/* 모선 본체 (항공모함 스타일) */}
      <mesh castShadow receiveShadow position={[0, mHgt / 2, 0]}>
        <boxGeometry args={[mWid, mHgt, mLen]} />
        <meshStandardMaterial
          color={0x445566}
          metalness={0.6}
          roughness={0.4}
        />
      </mesh>

      {/* 갑판 */}
      <mesh position={[0, mHgt * 1.05, 0]} receiveShadow>
        <boxGeometry args={[mWid * 0.9, mHgt * 0.1, mLen * 0.96]} />
        <meshStandardMaterial color={0x334455} />
      </mesh>

      {/* 함교 */}
      <mesh position={[mWid * 0.33, mHgt * 2, mLen * 0.2]} castShadow>
        <boxGeometry args={[mWid * 0.25, mHgt * 1.5, mLen * 0.16]} />
        <meshStandardMaterial color={0x556677} />
      </mesh>

      {/* 레이더 돔 */}
      <mesh position={[mWid * 0.33, mHgt * 3.2, mLen * 0.2]}>
        <sphereGeometry args={[mHgt * 0.5]} />
        <meshStandardMaterial color={0xffffff} />
      </mesh>

      {/* 선수 */}
      <mesh position={[0, mHgt * 0.25, -mLen * 0.52]} castShadow>
        <coneGeometry args={[mWid / 2, mLen * 0.06, 4]} />
        <meshStandardMaterial color={0x445566} />
      </mesh>

      {/* Breach 반경 표시 (반투명 원) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, mHgt * 0.05, 0]}>
        <ringGeometry args={[state.radius * 0.95, state.radius, 64]} />
        <meshBasicMaterial
          color={0xff0000}
          transparent
          opacity={0.3}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Breach 반경 내부 (더 연한 표시) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, mHgt * 0.03, 0]}>
        <circleGeometry args={[state.radius, 64]} />
        <meshBasicMaterial
          color={0xff0000}
          transparent
          opacity={0.1}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 안전 구역 외곽선 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, mHgt * 0.06, 0]}>
        <ringGeometry args={[state.radius, state.radius * 1.02, 64]} />
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
