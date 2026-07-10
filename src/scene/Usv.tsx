// USV(무인수상정) 3D 모델 — 외부 에셋 없이 프리미티브로 조립한 로우폴리 쌍동선(카타마란).
// 좁고 긴 데미헐 두 개를 좌우에 두고 크로스덱으로 잇는다.
// 매 프레임 파도 필드를 샘플링해 히브(상하)·롤·피치를 적용한다.

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { waveHeight } from "../sim/waves";
import { MAX_SPEED_MS } from "../sim/usvSim";
import { useSimStore } from "../store";

const LENGTH = 14; // m — 전장
const BEAM = 6.4; // m — 전폭(양현 데미헐 바깥 간격)
const HULL_BEAM = 1.7; // m — 데미헐 하나의 폭
const HULL_SEP = BEAM / 2 - HULL_BEAM / 2; // 중심선에서 각 데미헐 중심까지

/** 데미헐(단일 선체) 상면 윤곽(뾰족한 선수) → 아래로 압출 */
function demihullGeometry(): THREE.ExtrudeGeometry {
  const half = HULL_BEAM / 2;
  const stern = LENGTH / 2;
  const bow = -LENGTH / 2;
  const shape = new THREE.Shape();
  shape.moveTo(stern, -half);
  shape.lineTo(bow + 3.4, -half);
  shape.quadraticCurveTo(bow + 0.8, -half * 0.5, bow, 0);
  shape.quadraticCurveTo(bow + 0.8, half * 0.5, bow + 3.4, half);
  shape.lineTo(stern, half);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 1.3,
    bevelEnabled: true,
    bevelThickness: 0.28,
    bevelSize: 0.2,
    bevelSegments: 2,
  });
  // XY 평면 압출 → 눕혀서 XZ 평면(선수 = -z)으로
  geo.rotateX(Math.PI / 2);
  geo.rotateY(-Math.PI / 2);
  geo.translate(0, 1.3, 0);
  return geo;
}

export function Usv() {
  const groupRef = useRef<THREE.Group>(null);
  const smooth = useRef({ y: 0, pitch: 0, roll: 0 });
  const hullGeo = useMemo(demihullGeometry, []);

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

    // 파도 자세 + 속도 트림(선수 들림) + 선회 횡경사(뱅킹)
    // 쌍동선은 폭이 넓어 롤이 적게 나므로 계수를 낮춘다.
    const speedRatio = Math.min(Math.abs(usv.speed) / MAX_SPEED_MS, 1);
    const targetPitch = Math.atan2(hBow - hStern, LENGTH) + speedRatio * 0.05;
    const targetRoll =
      Math.atan2(hStb - hPort, BEAM) * 0.6 - ((usv.rudder * Math.PI) / 180) * 0.08 * speedRatio;

    // 부드럽게 수렴 (관성 흉내)
    const k = Math.min(1, dt * 2.5);
    const s = smooth.current;
    s.y += (hCenter - s.y) * k;
    s.pitch += (targetPitch - s.pitch) * k;
    s.roll += (targetRoll - s.roll) * k;

    g.position.set(usv.x, s.y - 0.4, usv.z); // 흘수만큼 가라앉힘
    g.rotation.set(0, 0, 0);
    g.rotation.order = "YXZ";
    g.rotation.y = yaw;
    g.rotation.x = s.pitch;
    g.rotation.z = s.roll;
  });

  return (
    <group ref={groupRef}>
      {/* 데미헐 — 좌·우 두 선체 */}
      {[-HULL_SEP, HULL_SEP].map((dx) => (
        <mesh key={dx} geometry={hullGeo} position={[dx, 0, 0]} castShadow>
          <meshStandardMaterial color="#3a4f63" metalness={0.25} roughness={0.55} />
        </mesh>
      ))}

      {/* 크로스덱(브릿징 데크) — 두 선체를 잇는 넓은 상판 */}
      <mesh position={[0, 1.55, 0.3]} castShadow>
        <boxGeometry args={[BEAM + 0.3, 0.28, LENGTH - 3.4]} />
        <meshStandardMaterial color="#8a949c" roughness={0.85} />
      </mesh>
      {/* 크로스덱 하부 터널 아치(가벼운 인상) */}
      <mesh position={[0, 1.4, 0.3]}>
        <boxGeometry args={[BEAM - HULL_BEAM, 0.18, LENGTH - 5]} />
        <meshStandardMaterial color="#2f3d49" roughness={0.7} />
      </mesh>

      {/* 장비 베이(캐빈) */}
      <mesh position={[0, 2.25, 0.9]} castShadow>
        <boxGeometry args={[3.2, 1.2, 5.0]} />
        <meshStandardMaterial color="#dfe5e8" metalness={0.15} roughness={0.4} />
      </mesh>
      {/* 전방 센서 창 */}
      <mesh position={[0, 2.45, -1.6]}>
        <boxGeometry args={[2.9, 0.55, 0.06]} />
        <meshStandardMaterial color="#101820" metalness={0.6} roughness={0.15} />
      </mesh>

      {/* 센서 마스트 */}
      <mesh position={[0, 3.4, 1.9]} castShadow>
        <cylinderGeometry args={[0.09, 0.15, 1.9, 8]} />
        <meshStandardMaterial color="#4a555e" roughness={0.6} />
      </mesh>
      {/* 레이더 돔 */}
      <mesh position={[0, 4.45, 1.9]} castShadow>
        <sphereGeometry args={[0.44, 20, 14]} />
        <meshStandardMaterial color="#f2f4f5" roughness={0.35} />
      </mesh>
      {/* 통신 안테나 */}
      <mesh position={[0.8, 3.35, 3.0]}>
        <cylinderGeometry args={[0.03, 0.03, 1.6, 6]} />
        <meshStandardMaterial color="#2b333a" />
      </mesh>
      <mesh position={[-0.8, 3.15, 3.0]}>
        <cylinderGeometry args={[0.03, 0.03, 1.2, 6]} />
        <meshStandardMaterial color="#2b333a" />
      </mesh>

      {/* 항해등: 좌현 홍등 / 우현 녹등 (각 데미헐 선수) */}
      <mesh position={[-HULL_SEP, 1.6, -LENGTH / 2 + 0.4]}>
        <sphereGeometry args={[0.11, 10, 8]} />
        <meshStandardMaterial color="#ff3b30" emissive="#ff3b30" emissiveIntensity={1.6} />
      </mesh>
      <mesh position={[HULL_SEP, 1.6, -LENGTH / 2 + 0.4]}>
        <sphereGeometry args={[0.11, 10, 8]} />
        <meshStandardMaterial color="#30d158" emissive="#30d158" emissiveIntensity={1.6} />
      </mesh>
    </group>
  );
}
