// ─────────────────────────────────────────────────────────────────────────
// 방어 시뮬레이터용 선박 3D 모델
// 기존 USV(Usv.tsx)와 동일한 쌍동선 디자인, 색상으로 아군/적군 구분
// - 아군: 파란색
// - 적군: 빨간색
// ─────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { waveHeight } from "../sim/waves";
import type { ShipState } from "../types/defense";
import { DEFENSE_CONFIG as C } from "../config/defense";

const LENGTH = 15;
const BEAM = 6.45;
const HULL_W = 1.35;
const HULL_D = 1.5;
const HULL_GAP = 2.55;
const DRAFT = 0.7;

type ShipTeam = "ally" | "enemy";

interface ShipModel {
  model: THREE.Group;
  radar: THREE.Mesh;
  dispose: () => void;
}

function buildShip(team: ShipTeam): ShipModel {
  const model = new THREE.Group();
  model.rotation.y = Math.PI;

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const track = <G extends THREE.BufferGeometry>(g: G): G => {
    geometries.push(g);
    return g;
  };

  // 팀별 색상
  const isAlly = team === "ally";
  const primaryColor = isAlly ? 0x2266cc : 0xcc2222;
  const secondaryColor = isAlly ? 0x1a4d99 : 0x991a1a;
  const accentColor = isAlly ? 0x3388ff : 0xff3333;

  const mat = (color: number, p: { roughness: number; metalness: number }) => {
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness: p.roughness,
      metalness: p.metalness,
      envMapIntensity: 0.8,
    });
    materials.push(m);
    return m;
  };

  const primaryMat = mat(primaryColor, { roughness: 0.42, metalness: 0.15 });
  const secondaryMat = mat(secondaryColor, { roughness: 0.5, metalness: 0.15 });
  const whiteMat = mat(0xf1f2ee, { roughness: 0.4, metalness: 0.08 });
  const deckMat = mat(0x3d434a, { roughness: 0.85, metalness: 0.05 });
  const darkMat = mat(0x24292e, { roughness: 0.6, metalness: 0.4 });
  const metalMat = mat(0x9aa4ab, { roughness: 0.3, metalness: 0.85 });
  const glassMat = mat(0x0d2230, { roughness: 0.06, metalness: 0.9 });
  const accentMat = mat(accentColor, { roughness: 0.65, metalness: 0.0 });

  const add = (
    geom: THREE.BufferGeometry,
    material: THREE.Material,
    x = 0,
    y = 0,
    z = 0,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(track(geom), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    model.add(mesh);
    return mesh;
  };

  // 트윈 헐
  const buildHullGeom = () => {
    const g = track(new THREE.BoxGeometry(HULL_W, HULL_D, LENGTH, 4, 3, 30));
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
    add(new THREE.BoxGeometry(HULL_W * 0.86, 0.1, LENGTH * 0.9), secondaryMat, side * HULL_GAP, HULL_Y + HULL_D / 2 + 0.05, -0.3);
    add(new THREE.BoxGeometry(0.06, 0.16, LENGTH * 0.62), darkMat, side * (HULL_GAP + HULL_W * 0.47), 0.45, -1.0);
    add(new THREE.BoxGeometry(0.6, 0.55, 1.0), darkMat, side * HULL_GAP, 0.5, -LENGTH * 0.47);
  }

  // 크로스 데크
  const DECK_Y = 1.25;
  add(new THREE.BoxGeometry(HULL_GAP * 2 + HULL_W, 0.35, LENGTH * 0.66), deckMat, 0, DECK_Y - 0.18, -0.6);
  add(new THREE.BoxGeometry(HULL_GAP * 2 + HULL_W + 0.12, 0.1, LENGTH * 0.66 + 0.12), primaryMat, 0, DECK_Y - 0.36, -0.6);
  for (const bz of [3.2, -4.2]) {
    add(new THREE.BoxGeometry(HULL_GAP * 2, 0.35, 0.7), secondaryMat, 0, 0.85, bz);
  }

  // 캐빈
  const CAB_Z = -1.0;
  add(new THREE.BoxGeometry(4.0, 1.85, 4.4), whiteMat, 0, DECK_Y + 0.95, CAB_Z);
  add(new THREE.BoxGeometry(4.15, 0.32, 4.55), primaryMat, 0, DECK_Y + 0.35, CAB_Z);
  add(new THREE.BoxGeometry(4.15, 0.12, 4.55), whiteMat, 0, DECK_Y + 1.92, CAB_Z);
  for (let i = 0; i < 3; i++) {
    add(new THREE.BoxGeometry(1.05, 0.62, 0.07), glassMat, -1.25 + i * 1.25, DECK_Y + 1.32, CAB_Z + 2.24);
  }
  for (const side of [1, -1]) {
    add(new THREE.BoxGeometry(0.07, 0.55, 2.6), glassMat, side * 2.04, DECK_Y + 1.3, CAB_Z - 0.2);
  }
  add(new THREE.BoxGeometry(0.9, 1.4, 0.07), darkMat, 0.9, DECK_Y + 0.85, CAB_Z - 2.24);

  // 지붕 장비
  const ROOF_Y = DECK_Y + 2.0;
  add(new THREE.SphereGeometry(0.3, 14, 10), whiteMat, -1.1, ROOF_Y + 0.28, CAB_Z - 0.9);

  // 센서 마스트 + 레이더
  const mastZ = CAB_Z + 1.5;
  add(new THREE.CylinderGeometry(0.07, 0.1, 1.9, 10), primaryMat, 0, ROOF_Y + 0.95, mastZ);
  add(new THREE.BoxGeometry(1.5, 0.08, 0.08), primaryMat, 0, ROOF_Y + 1.55, mastZ);
  const radar = add(new THREE.BoxGeometry(1.05, 0.1, 0.2), metalMat, 0, ROOF_Y + 1.95, mastZ);

  // 스턴 A-프레임 갠트리
  const AF_Z = -LENGTH * 0.44;
  for (const side of [1, -1]) {
    const leg = add(new THREE.CylinderGeometry(0.09, 0.12, 3.1, 10), primaryMat, side * 1.7, 2.15, AF_Z);
    leg.rotation.z = -side * 0.42;
    leg.rotation.x = 0.12;
  }
  add(new THREE.CylinderGeometry(0.09, 0.09, 1.6, 10), primaryMat, 0, 3.45, AF_Z - 0.35).rotation.z = Math.PI / 2;

  // 팀 표시등 (상단)
  const teamLight = new THREE.MeshStandardMaterial({
    color: accentColor,
    emissive: accentColor,
    emissiveIntensity: 2.5,
    roughness: 0.4,
  });
  materials.push(teamLight);
  const lightMesh = new THREE.Mesh(track(new THREE.SphereGeometry(0.2, 8, 8)), teamLight);
  lightMesh.position.set(0, ROOF_Y + 2.2, mastZ);
  model.add(lightMesh);

  // 구명튜브
  const ring = new THREE.Mesh(track(new THREE.TorusGeometry(0.32, 0.1, 8, 20)), accentMat);
  ring.position.set(-1.2, DECK_Y + 1.0, CAB_Z - 2.3);
  ring.castShadow = true;
  model.add(ring);

  const dispose = () => {
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    model.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
  };

  return { model, radar, dispose };
}

interface DefenseShipProps {
  state: ShipState;
  team: ShipTeam;
  selected?: boolean;
}

export function DefenseShip({ state, team, selected = false }: DefenseShipProps) {
  const groupRef = useRef<THREE.Group>(null);
  const smooth = useRef({ y: 0, pitch: 0, roll: 0 });
  const ship = useMemo(() => buildShip(team), [team]);
  const offset = C.worldSize / 2;

  useEffect(() => () => ship.dispose(), [ship]);

  useFrame(({ clock }, dt) => {
    const g = groupRef.current;
    if (!g || !state.alive) {
      if (g) g.visible = false;
      return;
    }
    g.visible = true;

    const t = clock.elapsedTime;
    const yaw = (-state.heading * Math.PI) / 180;
    const fwd = { x: Math.sin((state.heading * Math.PI) / 180), z: -Math.cos((state.heading * Math.PI) / 180) };
    const stb = { x: -fwd.z, z: fwd.x };

    // 씬 좌표로 변환
    const sceneX = state.x - offset;
    const sceneZ = state.z - offset;

    // 파도 높이
    const hL = LENGTH / 2;
    const hB = BEAM / 2;
    const hCenter = waveHeight(sceneX, sceneZ, t);
    const hBow = waveHeight(sceneX + fwd.x * hL, sceneZ + fwd.z * hL, t);
    const hStern = waveHeight(sceneX - fwd.x * hL, sceneZ - fwd.z * hL, t);
    const hStb = waveHeight(sceneX + stb.x * hB, sceneZ + stb.z * hB, t);
    const hPort = waveHeight(sceneX - stb.x * hB, sceneZ - stb.z * hB, t);

    const speedRatio = Math.min(Math.abs(state.speed) / 6, 1);
    const targetPitch = Math.atan2(hBow - hStern, LENGTH) * 0.6 + speedRatio * 0.045;
    const targetRoll = Math.atan2(hStb - hPort, BEAM) * 0.6 - ((state.yawRate * Math.PI) / 180) * 0.28 * speedRatio;

    const k = Math.min(1, dt * 2.5);
    const s = smooth.current;
    s.y += (hCenter - s.y) * k;
    s.pitch += (targetPitch - s.pitch) * k;
    s.roll += (targetRoll - s.roll) * k;

    g.position.set(sceneX, s.y, sceneZ);
    g.rotation.set(0, 0, 0);
    g.rotation.order = "YXZ";
    g.rotation.y = yaw;
    g.rotation.x = s.pitch;
    g.rotation.z = s.roll;

    ship.radar.rotation.y += dt * 2.0;
  });

  if (!state.alive) return null;

  return (
    <group ref={groupRef}>
      <primitive object={ship.model} />
      {/* 선택 링 */}
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.5, 0]}>
          <ringGeometry args={[10, 12, 32]} />
          <meshBasicMaterial color={0x00ff00} transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}
