// ─────────────────────────────────────────────────────────────────────────
// 상세 선박 3D 모델 (Defense 모드용)
// - USV 시뮬레이터의 쌍동선(catamaran) 디자인 기반
// - 팀 색상 (아군=파랑, 적군=빨강, 모선=흰색) 적용
// - 스케일 조정 가능
// ─────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DEFENSE_CONFIG as C } from "../config/defense";

// 기준 선박 크기 (스케일 1.0 기준)
const BASE_LENGTH = 15;
const BASE_BEAM = 6.45;
const BASE_HULL_W = 1.35;
const BASE_HULL_D = 1.5;
const BASE_HULL_GAP = 2.55;
const BASE_DRAFT = 0.7;

// 팀별 색상 팔레트
const COLOR_PALETTES = {
  ally: {
    primary: 0x2266ff,      // 파란색 헐
    primaryDark: 0x1155cc,  // 어두운 파란색
    accent: 0x00aaff,       // 강조 (마커 등)
    cabin: 0xe8f0ff,        // 밝은 파란 캐빈
    deck: 0x3a4a5a,         // 데크
  },
  enemy: {
    primary: 0xff3333,      // 빨간색 헐
    primaryDark: 0xcc2222,  // 어두운 빨간색
    accent: 0xff6644,       // 강조 (마커 등)
    cabin: 0xffe8e8,        // 밝은 빨간 캐빈
    deck: 0x4a3a3a,         // 데크
  },
  mother: {
    primary: 0xf8f8f8,      // 흰색 헐
    primaryDark: 0xcccccc,  // 회색
    accent: 0xffffff,       // 강조
    cabin: 0xffffff,        // 흰색 캐빈
    deck: 0x3d434a,         // 데크
  },
  dead: {
    primary: 0x444444,      // 어두운 회색
    primaryDark: 0x333333,
    accent: 0x666666,
    cabin: 0x555555,
    deck: 0x333333,
  },
};

interface ShipModel {
  model: THREE.Group;
  radar: THREE.Mesh;
  dispose: () => void;
}

function buildDetailedShip(
  team: "ally" | "enemy" | "mother" | "dead",
  scale: number = 1.0
): ShipModel {
  const colors = COLOR_PALETTES[team];
  const s = scale;

  // 스케일 적용된 치수
  const LENGTH = BASE_LENGTH * s;
  const HULL_W = BASE_HULL_W * s;
  const HULL_D = BASE_HULL_D * s;
  const HULL_GAP = BASE_HULL_GAP * s;
  const DRAFT = BASE_DRAFT * s;

  const model = new THREE.Group();
  model.rotation.y = Math.PI; // 선수를 -Z로

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const track = <G extends THREE.BufferGeometry>(g: G): G => {
    geometries.push(g);
    return g;
  };

  // 재질 생성
  const mat = (color: number, opts: { roughness: number; metalness: number }) => {
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness,
      metalness: opts.metalness,
      envMapIntensity: 0.8,
    });
    materials.push(m);
    return m;
  };

  const primaryMat = mat(colors.primary, { roughness: 0.42, metalness: 0.15 });
  const primaryDkMat = mat(colors.primaryDark, { roughness: 0.5, metalness: 0.15 });
  const cabinMat = mat(colors.cabin, { roughness: 0.4, metalness: 0.08 });
  const deckMat = mat(colors.deck, { roughness: 0.85, metalness: 0.05 });
  const darkMat = mat(0x24292e, { roughness: 0.6, metalness: 0.4 });
  const metalMat = mat(0x9aa4ab, { roughness: 0.3, metalness: 0.85 });
  const glassMat = mat(0x0d2230, { roughness: 0.06, metalness: 0.9 });

  const add = (
    geom: THREE.BufferGeometry,
    material: THREE.Material,
    x = 0,
    y = 0,
    z = 0
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(track(geom), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    model.add(mesh);
    return mesh;
  };

  // ===== 트윈 헐: 슬림 폰툰, 선수 테이퍼 + 선저 스윕 =====
  const buildHullGeom = () => {
    const g = track(new THREE.BoxGeometry(HULL_W, HULL_D, LENGTH, 4, 3, 20));
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      const z = pos.getZ(i);
      const t = z / (LENGTH / 2);
      const yn = (y + HULL_D / 2) / HULL_D;

      let wf = 1.0;
      if (t > 0.25) {
        const u = (t - 0.25) / 0.75;
        wf *= Math.cos(u * Math.PI * 0.5) * 0.95 + 0.05;
      }
      if (t < -0.8) wf *= 1.0 - 0.15 * ((-t - 0.8) / 0.2);
      wf *= 0.88 + 0.12 * yn;
      x *= wf;

      if (y < 0 && t > 0.35) {
        const u = (t - 0.35) / 0.65;
        y += -y * Math.pow(u, 1.5) * 0.75;
      }
      pos.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    return g;
  };

  const HULL_Y = HULL_D / 2 - DRAFT;
  for (const side of [1, -1]) {
    const hull = new THREE.Mesh(buildHullGeom(), primaryMat);
    hull.position.set(side * HULL_GAP, HULL_Y, 0);
    hull.castShadow = true;
    hull.receiveShadow = true;
    model.add(hull);
    add(new THREE.BoxGeometry(HULL_W * 0.86, 0.1 * s, LENGTH * 0.9), primaryDkMat, side * HULL_GAP, HULL_Y + HULL_D / 2 + 0.05 * s, -0.3 * s);
    add(new THREE.BoxGeometry(0.06 * s, 0.16 * s, LENGTH * 0.62), darkMat, side * (HULL_GAP + HULL_W * 0.47), 0.45 * s, -1.0 * s);
    add(new THREE.BoxGeometry(0.6 * s, 0.55 * s, 1.0 * s), darkMat, side * HULL_GAP, 0.5 * s, -LENGTH * 0.47);
  }

  // ===== 크로스 데크 =====
  const DECK_Y = 1.25 * s;
  add(new THREE.BoxGeometry(HULL_GAP * 2 + HULL_W, 0.35 * s, LENGTH * 0.66), deckMat, 0, DECK_Y - 0.18 * s, -0.6 * s);
  add(new THREE.BoxGeometry(HULL_GAP * 2 + HULL_W + 0.12 * s, 0.1 * s, LENGTH * 0.66 + 0.12 * s), primaryMat, 0, DECK_Y - 0.36 * s, -0.6 * s);
  for (const bz of [3.2, -4.2]) {
    add(new THREE.BoxGeometry(HULL_GAP * 2, 0.35 * s, 0.7 * s), primaryDkMat, 0, 0.85 * s, bz * s);
  }

  // ===== 캐빈 =====
  const CAB_Z = -1.0 * s;
  add(new THREE.BoxGeometry(4.0 * s, 1.85 * s, 4.4 * s), cabinMat, 0, DECK_Y + 0.95 * s, CAB_Z);
  add(new THREE.BoxGeometry(4.15 * s, 0.32 * s, 4.55 * s), primaryMat, 0, DECK_Y + 0.35 * s, CAB_Z);
  add(new THREE.BoxGeometry(4.15 * s, 0.12 * s, 4.55 * s), cabinMat, 0, DECK_Y + 1.92 * s, CAB_Z);
  // 창문
  for (let i = 0; i < 3; i++) {
    add(new THREE.BoxGeometry(1.05 * s, 0.62 * s, 0.07 * s), glassMat, (-1.25 + i * 1.25) * s, DECK_Y + 1.32 * s, CAB_Z + 2.24 * s);
  }
  for (const side of [1, -1]) {
    add(new THREE.BoxGeometry(0.07 * s, 0.55 * s, 2.6 * s), glassMat, side * 2.04 * s, DECK_Y + 1.3 * s, CAB_Z - 0.2 * s);
  }
  add(new THREE.BoxGeometry(0.9 * s, 1.4 * s, 0.07 * s), darkMat, 0.9 * s, DECK_Y + 0.85 * s, CAB_Z - 2.24 * s);

  // 지붕 장비
  const ROOF_Y = DECK_Y + 2.0 * s;
  add(new THREE.SphereGeometry(0.3 * s, 14, 10), cabinMat, -1.1 * s, ROOF_Y + 0.28 * s, CAB_Z - 0.9 * s);
  for (const gx of [0.2, 0.8]) {
    add(new THREE.CylinderGeometry(0.09 * s, 0.11 * s, 0.42 * s, 10), cabinMat, gx * s, ROOF_Y + 0.2 * s, CAB_Z - 1.4 * s);
  }
  add(new THREE.CylinderGeometry(0.02 * s, 0.02 * s, 1.6 * s, 6), metalMat, 1.6 * s, ROOF_Y + 0.8 * s, CAB_Z - 0.6 * s);
  add(new THREE.CylinderGeometry(0.02 * s, 0.02 * s, 1.2 * s, 6), metalMat, -1.7 * s, ROOF_Y + 0.6 * s, CAB_Z + 0.6 * s);

  // ===== 센서 마스트 + 회전 레이더 =====
  const mastZ = CAB_Z + 1.5 * s;
  add(new THREE.CylinderGeometry(0.07 * s, 0.1 * s, 1.9 * s, 10), primaryMat, 0, ROOF_Y + 0.95 * s, mastZ);
  add(new THREE.BoxGeometry(1.5 * s, 0.08 * s, 0.08 * s), primaryMat, 0, ROOF_Y + 1.55 * s, mastZ);
  const radar = add(new THREE.BoxGeometry(1.05 * s, 0.1 * s, 0.2 * s), metalMat, 0, ROOF_Y + 1.95 * s, mastZ);

  // ===== 스턴 A-프레임 갠트리 =====
  const AF_Z = -LENGTH * 0.44;
  for (const side of [1, -1]) {
    const leg = add(new THREE.CylinderGeometry(0.09 * s, 0.12 * s, 3.1 * s, 10), primaryMat, side * 1.7 * s, 2.15 * s, AF_Z);
    leg.rotation.z = -side * 0.42;
    leg.rotation.x = 0.12;
  }
  add(new THREE.CylinderGeometry(0.09 * s, 0.09 * s, 1.6 * s, 10), primaryMat, 0, 3.45 * s, AF_Z - 0.35 * s).rotation.z = Math.PI / 2;
  add(new THREE.CylinderGeometry(0.015 * s, 0.015 * s, 1.1 * s, 4), darkMat, 0, 2.85 * s, AF_Z - 0.35 * s);
  add(new THREE.BoxGeometry(0.22 * s, 0.3 * s, 0.22 * s), darkMat, 0, 2.2 * s, AF_Z - 0.35 * s);

  // 데크 윈치
  add(new THREE.CylinderGeometry(0.22 * s, 0.22 * s, 0.9 * s, 12), darkMat, 0, 0.75 * s, 3.6 * s).rotation.x = Math.PI / 2;

  // ===== 데크 난간 (간소화) =====
  const px = HULL_GAP + HULL_W * 0.28;
  for (const side of [1, -1]) {
    add(new THREE.BoxGeometry(0.04 * s, 0.04 * s, 8.0 * s), metalMat, side * px, DECK_Y + 0.85 * s, 0.4 * s);
  }
  add(new THREE.BoxGeometry(px * 2, 0.04 * s, 0.04 * s), metalMat, 0, DECK_Y + 0.85 * s, 4.2 * s);

  // 항해등
  const navLight = (color: number, x: number, y: number, z: number) => {
    const m = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 2.5,
      roughness: 0.4,
    });
    materials.push(m);
    const mesh = new THREE.Mesh(track(new THREE.SphereGeometry(0.09 * s, 8, 8)), m);
    mesh.position.set(x, y, z);
    model.add(mesh);
  };
  navLight(0xff2222, 2.1 * s, DECK_Y + 1.75 * s, CAB_Z + 1.6 * s);  // 좌현 적
  navLight(0x22ff44, -2.1 * s, DECK_Y + 1.75 * s, CAB_Z + 1.6 * s); // 우현 녹
  navLight(0xffffff, 0, ROOF_Y + 2.05 * s, mastZ);                   // 마스트헤드
  navLight(0xffffff, 0, 3.6 * s, AF_Z - 0.35 * s);                  // 선미등

  const dispose = () => {
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    model.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
  };

  return { model, radar, dispose };
}

interface DetailedShipProps {
  x: number;
  z: number;
  heading: number;
  team: "ally" | "enemy" | "mother";
  alive?: boolean;
  selected?: boolean;
  scale?: number;
}

export function DetailedShip({
  x,
  z,
  heading,
  team,
  alive = true,
  selected = false,
  scale = 1.0,
}: DetailedShipProps) {
  const groupRef = useRef<THREE.Group>(null);
  const offset = C.worldSize / 2;

  // 스케일을 Defense 모드 설정에 맞춤
  const actualScale = scale * (C.render.shipLength / BASE_LENGTH);

  const shipType = alive ? team : "dead";
  const ship = useMemo(() => buildDetailedShip(shipType, actualScale), [shipType, actualScale]);
  useEffect(() => () => ship.dispose(), [ship]);

  useFrame((_, dt) => {
    const g = groupRef.current;
    if (!g) return;

    g.position.set(x - offset, 0, z - offset);
    g.rotation.y = -(heading * Math.PI) / 180;

    // 레이더 회전 (살아있을 때만)
    if (alive) {
      ship.radar.rotation.y += dt * 2.0;
    }
  });

  // 선택 링 크기
  const ringSize = C.render.shipLength * 0.8;

  return (
    <group ref={groupRef}>
      <primitive object={ship.model} />

      {/* 비활성화 X 표시 */}
      {!alive && (
        <group position={[0, actualScale * 5, 0]}>
          <mesh rotation={[0, 0, Math.PI / 4]}>
            <boxGeometry args={[actualScale * 0.3, actualScale * 4, actualScale * 0.3]} />
            <meshBasicMaterial color={0xff0000} />
          </mesh>
          <mesh rotation={[0, 0, -Math.PI / 4]}>
            <boxGeometry args={[actualScale * 0.3, actualScale * 4, actualScale * 0.3]} />
            <meshBasicMaterial color={0xff0000} />
          </mesh>
        </group>
      )}

      {/* 선택 링 */}
      {selected && alive && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
          <ringGeometry args={[ringSize, ringSize * 1.15, 32]} />
          <meshBasicMaterial color={0x00ff00} transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* 팀 표시 상단 구체 */}
      <mesh position={[0, actualScale * 6, 0]}>
        <sphereGeometry args={[actualScale * 0.8]} />
        <meshBasicMaterial
          color={alive ? (team === "ally" ? 0x00aaff : team === "enemy" ? 0xff4444 : 0xffffff) : 0x666666}
          transparent={!alive}
          opacity={alive ? 1 : 0.5}
        />
      </mesh>
    </group>
  );
}
