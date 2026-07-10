// USV(무인수상정) 3D 모델 — 외부 에셋 없이 프리미티브로 조립한 로우폴리 선체.
// 매 프레임 파도 필드를 샘플링해 히브(상하)·롤·피치를 적용한다.

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { waveHeight } from "../sim/waves";
import { useSimStore } from "../store";

const LENGTH = 9; // m
const BEAM = 3;

/** 선체 상면 윤곽(뾰족한 선수) → 아래로 압출 */
function hullGeometry(): THREE.ExtrudeGeometry {
  const half = BEAM / 2;
  const stern = LENGTH / 2;
  const bow = -LENGTH / 2;
  const shape = new THREE.Shape();
  shape.moveTo(stern, -half);
  shape.lineTo(bow + 2.6, -half);
  shape.quadraticCurveTo(bow + 0.6, -half * 0.55, bow, 0);
  shape.quadraticCurveTo(bow + 0.6, half * 0.55, bow + 2.6, half);
  shape.lineTo(stern, half);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 1.1,
    bevelEnabled: true,
    bevelThickness: 0.25,
    bevelSize: 0.18,
    bevelSegments: 2,
  });
  // XY 평면 압출 → 눕혀서 XZ 평면(선수 = -z)으로
  geo.rotateX(Math.PI / 2);
  geo.rotateY(-Math.PI / 2);
  geo.translate(0, 1.1, 0);
  return geo;
}

export function Usv() {
  const groupRef = useRef<THREE.Group>(null);
  const smooth = useRef({ y: 0, pitch: 0, roll: 0 });
  const hullGeo = useMemo(hullGeometry, []);

  useFrame(({ clock }, dt) => {
    const g = groupRef.current;
    if (!g) return;
    const { usv } = useSimStore.getState();
    const t = clock.elapsedTime;
    const yaw = (-usv.heading * Math.PI) / 180;
    const fwd = { x: Math.sin((usv.heading * Math.PI) / 180), z: -Math.cos((usv.heading * Math.PI) / 180) };
    const stb = { x: -fwd.z, z: fwd.x }; // 우현 방향

    // 선수/선미/좌현/우현의 해수면 높이로 자세 계산
    const hL = LENGTH / 2;
    const hB = BEAM / 2;
    const hCenter = waveHeight(usv.x, usv.z, t);
    const hBow = waveHeight(usv.x + fwd.x * hL, usv.z + fwd.z * hL, t);
    const hStern = waveHeight(usv.x - fwd.x * hL, usv.z - fwd.z * hL, t);
    const hStb = waveHeight(usv.x + stb.x * hB, usv.z + stb.z * hB, t);
    const hPort = waveHeight(usv.x - stb.x * hB, usv.z - stb.z * hB, t);

    const targetPitch = Math.atan2(hBow - hStern, LENGTH);
    const targetRoll = Math.atan2(hStb - hPort, BEAM);

    // 부드럽게 수렴 (관성 흉내)
    const k = Math.min(1, dt * 2.5);
    const s = smooth.current;
    s.y += (hCenter - s.y) * k;
    s.pitch += (targetPitch - s.pitch) * k;
    s.roll += (targetRoll - s.roll) * k;

    g.position.set(usv.x, s.y - 0.35, usv.z); // 흘수만큼 가라앉힘
    g.rotation.set(0, 0, 0);
    g.rotation.order = "YXZ";
    g.rotation.y = yaw;
    g.rotation.x = s.pitch;
    g.rotation.z = s.roll;
  });

  return (
    <group ref={groupRef}>
      {/* 선체 */}
      <mesh geometry={hullGeo} castShadow>
        <meshStandardMaterial color="#3a4f63" metalness={0.25} roughness={0.55} />
      </mesh>
      {/* 갑판 */}
      <mesh position={[0, 1.16, 0.4]}>
        <boxGeometry args={[BEAM - 0.7, 0.12, LENGTH - 2.6]} />
        <meshStandardMaterial color="#8a949c" roughness={0.85} />
      </mesh>
      {/* 장비 베이(캐빈) */}
      <mesh position={[0, 1.65, 0.9]} castShadow>
        <boxGeometry args={[1.9, 0.9, 3.4]} />
        <meshStandardMaterial color="#dfe5e8" metalness={0.15} roughness={0.4} />
      </mesh>
      {/* 전방 센서 창 */}
      <mesh position={[0, 1.72, -0.82]}>
        <boxGeometry args={[1.7, 0.42, 0.06]} />
        <meshStandardMaterial color="#101820" metalness={0.6} roughness={0.15} />
      </mesh>
      {/* 센서 마스트 */}
      <mesh position={[0, 2.5, 1.6]} castShadow>
        <cylinderGeometry args={[0.07, 0.12, 1.5, 8]} />
        <meshStandardMaterial color="#4a555e" roughness={0.6} />
      </mesh>
      {/* 레이더 돔 */}
      <mesh position={[0, 3.3, 1.6]} castShadow>
        <sphereGeometry args={[0.34, 20, 14]} />
        <meshStandardMaterial color="#f2f4f5" roughness={0.35} />
      </mesh>
      {/* 통신 안테나 */}
      <mesh position={[0.55, 2.45, 2.4]}>
        <cylinderGeometry args={[0.025, 0.025, 1.2, 6]} />
        <meshStandardMaterial color="#2b333a" />
      </mesh>
      <mesh position={[-0.55, 2.3, 2.4]}>
        <cylinderGeometry args={[0.025, 0.025, 0.9, 6]} />
        <meshStandardMaterial color="#2b333a" />
      </mesh>
      {/* 항해등: 좌현 홍등 / 우현 녹등 */}
      <mesh position={[-0.95, 1.45, -2.2]}>
        <sphereGeometry args={[0.09, 10, 8]} />
        <meshStandardMaterial color="#ff3b30" emissive="#ff3b30" emissiveIntensity={1.6} />
      </mesh>
      <mesh position={[0.95, 1.45, -2.2]}>
        <sphereGeometry args={[0.09, 10, 8]} />
        <meshStandardMaterial color="#30d158" emissive="#30d158" emissiveIntensity={1.6} />
      </mesh>
    </group>
  );
}
