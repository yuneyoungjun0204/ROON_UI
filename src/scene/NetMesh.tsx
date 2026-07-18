// ─────────────────────────────────────────────────────────────────────────
// 그물 3D 렌더링
// 1. 설치 완료된 그물: 두꺼운 녹색 선
// 2. 전개 중인 그물: 반투명 파란 선
// 3. 격자 오버레이: 칠해진 셀 표시
// ─────────────────────────────────────────────────────────────────────────

import { useMemo } from "react";
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

  const points = useMemo(() => [
    new THREE.Vector3(net.startX - offset, 1, net.startZ - offset),
    new THREE.Vector3(net.endX - offset, 1, net.endZ - offset),
  ], [net, offset]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    return geo;
  }, [points]);

  return (
    <line geometry={geometry}>
      <lineBasicMaterial color={0x00ff00} linewidth={3} />
    </line>
  );
}

/** 전개 중 그물 - 반투명 파란 선 */
function DeployingNet({ ally }: { ally: AllyState }) {
  const offset = C.worldSize / 2;
  const paintStart = ally.route.find((w) => w.paint && w.started);

  // 시작점이 없으면 현재 위치에서 paintDist 전으로 계산
  const startX = paintStart?.x ?? ally.x;
  const startZ = paintStart?.z ?? ally.z;

  const points = useMemo(() => [
    new THREE.Vector3(startX - offset, 0.8, startZ - offset),
    new THREE.Vector3(ally.x - offset, 0.8, ally.z - offset),
  ], [startX, startZ, ally.x, ally.z, offset]);

  const geometry = useMemo(() => {
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [points]);

  return (
    <line geometry={geometry}>
      <lineBasicMaterial color={0x00aaff} linewidth={2} transparent opacity={0.7} />
    </line>
  );
}

/** 격자 오버레이 - 칠해진 셀을 반투명 평면으로 표시 */
function GridOverlay({ netGrid }: { netGrid: boolean[][] }) {
  const cellSize = C.worldSize / C.gridSize;
  const offset = C.worldSize / 2;

  // 칠해진 셀 수집 (성능을 위해 인스턴싱 사용)
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

  // 인스턴스 행렬 계산
  const instanceData = useMemo(() => {
    const matrices = new Float32Array(filledCells.length * 16);
    const tempMatrix = new THREE.Matrix4();

    filledCells.forEach(([gx, gz], i) => {
      const x = (gx + 0.5) * cellSize - offset;
      const z = (gz + 0.5) * cellSize - offset;

      tempMatrix.makeRotationX(-Math.PI / 2);
      tempMatrix.setPosition(x, 0.2, z);
      tempMatrix.toArray(matrices, i * 16);
    });

    return matrices;
  }, [filledCells, cellSize, offset]);

  if (filledCells.length === 0) return null;

  return (
    <instancedMesh
      args={[undefined, undefined, filledCells.length]}
      frustumCulled={false}
    >
      <planeGeometry args={[cellSize * 0.9, cellSize * 0.9]} />
      <meshBasicMaterial
        color={0x00ff00}
        transparent
        opacity={0.25}
        side={THREE.DoubleSide}
      />
      <instancedBufferAttribute
        attach="instanceMatrix"
        array={instanceData}
        count={filledCells.length}
        itemSize={16}
      />
    </instancedMesh>
  );
}
