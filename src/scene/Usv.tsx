// USV 3D 모델 — 연구용 쌍동선(catamaran), 절차적 모델 (~15m). shipmulator 이식.
// 슬림한 트윈 헐 + 크로스 데크 + 캐빈 + 스턴 A-프레임 갠트리 + 센서 마스트.
// 색상은 안전 옐로 계열, PBR 재질이 씬 환경맵(하늘)을 반사한다.
// 매 프레임 파도 필드를 샘플링해 히브(상하)·롤·피치를 적용한다.

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { waveHeight, lakeWaveHeight, WATER_LEVEL_Y } from "../sim/waves";
import { MAX_SPEED_MS } from "../sim/usvSim";
import { useSimStore } from "../store";
import { config } from "../config";
import { fpvCamera } from "./FpvCamera";

/** 수면 높이 샘플러 — 지오맵(호수) 모드면 잔잔한 호수 너울, 아니면 바다 파도 */
const waterHeight = config.vworldKey ? lakeWaveHeight : waveHeight;
/** 수면 기준 높이 — 지오맵 모드에서만 올림 (바다 모드는 y=0) */
const WATER_LEVEL = config.vworldKey ? WATER_LEVEL_Y : 0;

const LENGTH = 15; // m — 전장
const BEAM = 6.45; // m — 전폭
const HULL_W = 1.35; // 각 헐 폭
const HULL_D = 1.5; // 헐 깊이
const HULL_GAP = 2.55; // 헐 중심 x 오프셋
const DRAFT = 0.7;

interface ShipModel {
  model: THREE.Group;
  radar: THREE.Mesh;
  dispose: () => void;
}

function buildShip(): ShipModel {
  // 모델 좌표: 선수 +Z (shipmulator 원본) — 바깥에서 Y축 180° 회전해 선수를 -z로 맞춘다
  const model = new THREE.Group();
  model.rotation.y = Math.PI;

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const track = <G extends THREE.BufferGeometry>(g: G): G => {
    geometries.push(g);
    return g;
  };

  // ---- 재질: 안전 옐로 + 화이트 캐빈 + 다크 데크 ----
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
  const yellowMat = mat(0xe9b83b, { roughness: 0.42, metalness: 0.15 });
  const yellowDk = mat(0xc99a26, { roughness: 0.5, metalness: 0.15 });
  const whiteMat = mat(0xf1f2ee, { roughness: 0.4, metalness: 0.08 });
  const deckMat = mat(0x3d434a, { roughness: 0.85, metalness: 0.05 });
  const darkMat = mat(0x24292e, { roughness: 0.6, metalness: 0.4 });
  const metalMat = mat(0x9aa4ab, { roughness: 0.3, metalness: 0.85 });
  const glassMat = mat(0x0d2230, { roughness: 0.06, metalness: 0.9 });
  const orangeMat = mat(0xe8641e, { roughness: 0.65, metalness: 0.0 });

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

  // ===== 트윈 헐: 슬림 폰툰, 선수 테이퍼 + 선저 스윕 =====
  const buildHullGeom = () => {
    const g = track(new THREE.BoxGeometry(HULL_W, HULL_D, LENGTH, 4, 3, 30));
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      const z = pos.getZ(i);
      const t = z / (LENGTH / 2); // -1(선미) ~ +1(선수)
      const yn = (y + HULL_D / 2) / HULL_D;

      let wf = 1.0;
      if (t > 0.25) {
        const u = (t - 0.25) / 0.75;
        wf *= Math.cos(u * Math.PI * 0.5) * 0.95 + 0.05; // 선수 테이퍼
      }
      if (t < -0.8) wf *= 1.0 - 0.15 * ((-t - 0.8) / 0.2); // 선미 좁힘
      wf *= 0.88 + 0.12 * yn; // 상부 플레어
      x *= wf;

      if (y < 0 && t > 0.35) {
        const u = (t - 0.35) / 0.65;
        y += -y * Math.pow(u, 1.5) * 0.75; // 선저 스윕
      }
      pos.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    return g;
  };

  const HULL_Y = HULL_D / 2 - DRAFT; // 수면 기준 헐 중심
  for (const side of [1, -1]) {
    const hull = new THREE.Mesh(buildHullGeom(), yellowMat);
    hull.position.set(side * HULL_GAP, HULL_Y, 0);
    hull.castShadow = true;
    hull.receiveShadow = true;
    model.add(hull);
    add(new THREE.BoxGeometry(HULL_W * 0.86, 0.1, LENGTH * 0.9), yellowDk, side * HULL_GAP, HULL_Y + HULL_D / 2 + 0.05, -0.3);
    add(new THREE.BoxGeometry(0.06, 0.16, LENGTH * 0.62), darkMat, side * (HULL_GAP + HULL_W * 0.47), 0.45, -1.0);
    add(new THREE.BoxGeometry(0.6, 0.55, 1.0), darkMat, side * HULL_GAP, 0.5, -LENGTH * 0.47);
  }

  // ===== 크로스 데크 =====
  const DECK_Y = 1.25;
  add(new THREE.BoxGeometry(HULL_GAP * 2 + HULL_W, 0.35, LENGTH * 0.66), deckMat, 0, DECK_Y - 0.18, -0.6);
  add(new THREE.BoxGeometry(HULL_GAP * 2 + HULL_W + 0.12, 0.1, LENGTH * 0.66 + 0.12), yellowMat, 0, DECK_Y - 0.36, -0.6);
  for (const bz of [3.2, -4.2]) {
    add(new THREE.BoxGeometry(HULL_GAP * 2, 0.35, 0.7), yellowDk, 0, 0.85, bz);
  }

  // ===== 캐빈 =====
  const CAB_Z = -1.0;
  add(new THREE.BoxGeometry(4.0, 1.85, 4.4), whiteMat, 0, DECK_Y + 0.95, CAB_Z);
  add(new THREE.BoxGeometry(4.15, 0.32, 4.55), yellowMat, 0, DECK_Y + 0.35, CAB_Z);
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
  for (const gx of [0.2, 0.8]) {
    add(new THREE.CylinderGeometry(0.09, 0.11, 0.42, 10), whiteMat, gx, ROOF_Y + 0.2, CAB_Z - 1.4);
  }
  add(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 6), metalMat, 1.6, ROOF_Y + 0.8, CAB_Z - 0.6);
  add(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 6), metalMat, -1.7, ROOF_Y + 0.6, CAB_Z + 0.6);

  // ===== 센서 마스트 + 회전 레이더 =====
  const mastZ = CAB_Z + 1.5;
  add(new THREE.CylinderGeometry(0.07, 0.1, 1.9, 10), yellowMat, 0, ROOF_Y + 0.95, mastZ);
  add(new THREE.BoxGeometry(1.5, 0.08, 0.08), yellowMat, 0, ROOF_Y + 1.55, mastZ);
  const radar = add(new THREE.BoxGeometry(1.05, 0.1, 0.2), metalMat, 0, ROOF_Y + 1.95, mastZ);

  // ===== 스턴 A-프레임 갠트리 =====
  const AF_Z = -LENGTH * 0.44;
  for (const side of [1, -1]) {
    const leg = add(new THREE.CylinderGeometry(0.09, 0.12, 3.1, 10), yellowMat, side * 1.7, 2.15, AF_Z);
    leg.rotation.z = -side * 0.42;
    leg.rotation.x = 0.12;
  }
  add(new THREE.CylinderGeometry(0.09, 0.09, 1.6, 10), yellowMat, 0, 3.45, AF_Z - 0.35).rotation.z = Math.PI / 2;
  add(new THREE.CylinderGeometry(0.015, 0.015, 1.1, 4), darkMat, 0, 2.85, AF_Z - 0.35);
  add(new THREE.BoxGeometry(0.22, 0.3, 0.22), darkMat, 0, 2.2, AF_Z - 0.35);

  // 데크 윈치/센서 포드
  add(new THREE.CylinderGeometry(0.22, 0.22, 0.9, 12), darkMat, 0, 0.75, 3.6).rotation.x = Math.PI / 2;

  // ===== 데크 난간 =====
  {
    const postGeom = track(new THREE.CylinderGeometry(0.025, 0.025, 0.85, 6));
    const posts = new THREE.InstancedMesh(postGeom, metalMat, 14);
    posts.castShadow = true;
    const dummy = new THREE.Object3D();
    const px = HULL_GAP + HULL_W * 0.28;
    let idx = 0;
    for (const side of [1, -1]) {
      for (let i = 0; i < 5; i++) {
        dummy.position.set(side * px, DECK_Y + 0.42, 3.3 - i * 1.9);
        dummy.updateMatrix();
        posts.setMatrixAt(idx++, dummy.matrix);
      }
    }
    for (let i = 0; i < 4; i++) {
      dummy.position.set(-px + ((px * 2) / 3) * i, DECK_Y + 0.42, 4.2);
      dummy.updateMatrix();
      posts.setMatrixAt(idx++, dummy.matrix);
    }
    posts.instanceMatrix.needsUpdate = true;
    model.add(posts);
    for (const side of [1, -1]) {
      add(new THREE.BoxGeometry(0.04, 0.04, 8.0), metalMat, side * px, DECK_Y + 0.85, 0.4);
    }
    add(new THREE.BoxGeometry(px * 2, 0.04, 0.04), metalMat, 0, DECK_Y + 0.85, 4.2);
  }

  // 항해등: 좌현 적 / 우현 녹 (모델 +x = 좌현) + 마스트헤드/선미 백색등
  const navLight = (color: number, x: number, y: number, z: number) => {
    const m = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 2.5,
      roughness: 0.4,
    });
    materials.push(m);
    const mesh = new THREE.Mesh(track(new THREE.SphereGeometry(0.09, 8, 8)), m);
    mesh.position.set(x, y, z);
    model.add(mesh);
  };
  navLight(0xff2222, 2.1, DECK_Y + 1.75, CAB_Z + 1.6);
  navLight(0x22ff44, -2.1, DECK_Y + 1.75, CAB_Z + 1.6);
  navLight(0xffffff, 0, ROOF_Y + 2.05, mastZ);
  navLight(0xffffff, 0, 3.6, AF_Z - 0.35);

  // 구명튜브
  const ring = new THREE.Mesh(track(new THREE.TorusGeometry(0.32, 0.1, 8, 20)), orangeMat);
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

export function Usv() {
  const groupRef = useRef<THREE.Group>(null);
  const smooth = useRef({ y: 0, pitch: 0, roll: 0 });
  const ship = useMemo(buildShip, []);
  useEffect(() => () => ship.dispose(), [ship]);

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
    const hCenter = waterHeight(usv.x, usv.z, t);
    const hBow = waterHeight(usv.x + fwd.x * hL, usv.z + fwd.z * hL, t);
    const hStern = waterHeight(usv.x - fwd.x * hL, usv.z - fwd.z * hL, t);
    const hStb = waterHeight(usv.x + stb.x * hB, usv.z + stb.z * hB, t);
    const hPort = waterHeight(usv.x - stb.x * hB, usv.z - stb.z * hB, t);

    // 파도 자세 + 속도 트림(선수 들림) + 선회 횡경사(뱅킹)
    const speedRatio = Math.min(Math.abs(usv.speed) / MAX_SPEED_MS, 1);
    const targetPitch = Math.atan2(hBow - hStern, LENGTH) * 0.6 + speedRatio * 0.045;
    // 선회 횡경사(뱅킹): 요 레이트에 비례 — 차동 추진이라 타각 대신 회두율로 계산
    const targetRoll =
      Math.atan2(hStb - hPort, BEAM) * 0.6 - ((usv.yawRate * Math.PI) / 180) * 0.28 * speedRatio;

    // 부드럽게 수렴 (관성 흉내)
    const k = Math.min(1, dt * 2.5);
    const s = smooth.current;
    s.y += (hCenter - s.y) * k;
    s.pitch += (targetPitch - s.pitch) * k;
    s.roll += (targetRoll - s.roll) * k;

    g.position.set(usv.x, WATER_LEVEL + s.y, usv.z);
    g.rotation.set(0, 0, 0);
    g.rotation.order = "YXZ";
    g.rotation.y = yaw;
    g.rotation.x = s.pitch;
    g.rotation.z = s.roll;

    // 레이더 회전
    ship.radar.rotation.y += dt * 2.0;
  });

  return (
    <group ref={groupRef}>
      <primitive object={ship.model} />
      {/* 선수 카메라 — 배의 자세(침로·히브·롤·피치)를 그대로 물려받는다 */}
      <primitive object={fpvCamera} />
    </group>
  );
}
