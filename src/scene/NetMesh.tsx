// ─────────────────────────────────────────────────────────────────────────
// 그물 3D 렌더링
// 1. 설치 완료된 그물: 두꺼운 녹색 선
// 2. 전개 중인 그물: 반투명 파란 선
// 3. 격자 오버레이: 칠해진 셀 표시
// ─────────────────────────────────────────────────────────────────────────

import { useMemo, useEffect, useRef } from "react";
import * as THREE from "three";
import { useDefenseStore } from "../defenseStore";
import { DEFENSE_CONFIG as C } from "../config/defense";
import type { NetSegment, AllyState } from "../types/defense";

export function NetMesh() {
  const nets = useDefenseStore((s) => s.nets);
  const netGrid = useDefenseStore((s) => s.netGrid);
  const allies = useDefenseStore((s) => s.allies);

  return (
    <group name="nets">
      {/* 설치 완료된 그물 세그먼트 */}
      {nets.filter((n) => n.installed).map((net, i) => (
        <InstalledNet key={`net-${i}`} net={net} />
      ))}

      {/* 전개 중인 그물 (아군별) */}
      {allies.filter((a) => a.painting && a.alive).map((ally) => (
        <DeployingNet key={`deploy-${ally.id}`} ally={ally} />
      ))}

      {/* 격자 오버레이 */}
      <GridOverlay netGrid={netGrid} />
    </group>
  );
}

/** 설치 완료 그물 - 두꺼운 녹색 선 */
function InstalledNet({ net }: { net: NetSegment }) {
  const offset = C.worldSize / 2;

  const lineObj = useMemo(() => {
    const points = [
      new THREE.Vector3(net.startX - offset, 1, net.startZ - offset),
      new THREE.Vector3(net.endX - offset, 1, net.endZ - offset),
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 3 });
    return new THREE.Line(geometry, material);
  }, [net, offset]);

  return <primitive object={lineObj} />;
}

/** 전개 중 그물 - 반투명 파란 선 */
function DeployingNet({ ally }: { ally: AllyState }) {
  const offset = C.worldSize / 2;
  const paintStart = ally.route.find((w) => w.paint && w.started);

  // 시작점이 없으면 현재 위치에서 paintDist 전으로 계산
  const startX = paintStart?.x ?? ally.x;
  const startZ = paintStart?.z ?? ally.z;

  const lineObj = useMemo(() => {
    const points = [
      new THREE.Vector3(startX - offset, 0.8, startZ - offset),
      new THREE.Vector3(ally.x - offset, 0.8, ally.z - offset),
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0x00aaff,
      linewidth: 2,
      transparent: true,
      opacity: 0.7,
    });
    return new THREE.Line(geometry, material);
  }, [startX, startZ, ally.x, ally.z, offset]);

  return <primitive object={lineObj} />;
}

/** 격자 오버레이 - 칠해진 셀을 반투명 평면으로 표시 */
function GridOverlay({ netGrid }: { netGrid: boolean[][] }) {
  const cellSize = C.worldSize / C.gridSize;
  const offset = C.worldSize / 2;
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // 칠해진 셀 수집
  const filledCells = useMemo(() => {
    const cells: [number, number][] = [];
    for (let gz = 0; gz < C.gridSize; gz++) {
      for (let gx = 0; gx < C.gridSize; gx++) {
        if (netGrid[gz]?.[gx]) {
          cells.push([gx, gz]);
        }
      }
    }
    return cells;
  }, [netGrid]);

  // 인스턴스 행렬 업데이트
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    // ★ 리셋 시 그물 제거 (filledCells가 비어있으면 count=0)
    if (filledCells.length === 0) {
      mesh.count = 0;
      mesh.instanceMatrix.needsUpdate = true;
      return;
    }

    const tempMatrix = new THREE.Matrix4();
    const rotation = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

    filledCells.forEach(([gx, gz], i) => {
      const x = (gx + 0.5) * cellSize - offset;
      const z = (gz + 0.5) * cellSize - offset;

      tempMatrix.copy(rotation);
      tempMatrix.setPosition(x, 0.2, z);
      mesh.setMatrixAt(i, tempMatrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = filledCells.length;
  }, [filledCells, cellSize, offset]);

  // 최대 셀 수 (격자 전체)
  const maxCells = C.gridSize * C.gridSize;

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, maxCells]}
      frustumCulled={false}
    >
      <planeGeometry args={[cellSize * 0.9, cellSize * 0.9]} />
      <meshBasicMaterial
        color={0x00ff00}
        transparent
        opacity={0.4}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  );
}
