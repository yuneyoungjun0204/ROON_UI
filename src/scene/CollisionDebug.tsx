// ─────────────────────────────────────────────────────────────────────────
// 충돌 박스 디버그 시각화
// - OBB (Oriented Bounding Box) 표시
// - 개발 모드에서만 활성화 (URL에 ?debug=collision 추가)
// ─────────────────────────────────────────────────────────────────────────

import { useMemo } from "react";
import * as THREE from "three";
import { useDefenseStore } from "../defenseStore";
import { DEFENSE_CONFIG as C } from "../config/defense";
import { shipToOBB, getOBBDebugData } from "../sim/collision";

/** URL에서 디버그 모드 확인 */
function isCollisionDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("debug") === "collision";
}

/** OBB 와이어프레임 박스 */
function OBBWireframe({
  x,
  z,
  heading,
  color,
  height = 1,
}: {
  x: number;
  z: number;
  heading: number;
  color: number;
  height?: number;
}) {
  const offset = C.worldSize / 2;
  const obb = shipToOBB(x, z, heading);

  const lineObj = useMemo(() => {
    const { corners } = getOBBDebugData(obb);

    // 하단 사각형 + 상단 사각형 + 수직선
    const points: THREE.Vector3[] = [];
    const yBottom = 0.1;
    const yTop = height;

    // 하단 사각형
    for (let i = 0; i < 4; i++) {
      const c1 = corners[i];
      const c2 = corners[(i + 1) % 4];
      points.push(new THREE.Vector3(c1.x - offset, yBottom, c1.z - offset));
      points.push(new THREE.Vector3(c2.x - offset, yBottom, c2.z - offset));
    }

    // 상단 사각형
    for (let i = 0; i < 4; i++) {
      const c1 = corners[i];
      const c2 = corners[(i + 1) % 4];
      points.push(new THREE.Vector3(c1.x - offset, yTop, c1.z - offset));
      points.push(new THREE.Vector3(c2.x - offset, yTop, c2.z - offset));
    }

    // 수직선
    for (const c of corners) {
      points.push(new THREE.Vector3(c.x - offset, yBottom, c.z - offset));
      points.push(new THREE.Vector3(c.x - offset, yTop, c.z - offset));
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color,
      linewidth: 2,
      transparent: true,
      opacity: 0.8,
    });
    return new THREE.LineSegments(geometry, material);
  }, [obb.centerX, obb.centerZ, obb.heading, color, height, offset]);

  return <primitive object={lineObj} />;
}

/** 원형 와이어프레임 (모선용) */
function CircleWireframe({
  x,
  z,
  radius,
  color,
  height = 1,
}: {
  x: number;
  z: number;
  radius: number;
  color: number;
  height?: number;
}) {
  const offset = C.worldSize / 2;

  const lineObj = useMemo(() => {
    const segments = 32;
    const points: THREE.Vector3[] = [];
    const yBottom = 0.1;
    const yTop = height;

    // 하단 원
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const px = x - offset + Math.cos(angle) * radius;
      const pz = z - offset + Math.sin(angle) * radius;
      points.push(new THREE.Vector3(px, yBottom, pz));
    }

    // 상단 원
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const px = x - offset + Math.cos(angle) * radius;
      const pz = z - offset + Math.sin(angle) * radius;
      points.push(new THREE.Vector3(px, yTop, pz));
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color,
      linewidth: 2,
      transparent: true,
      opacity: 0.8,
    });
    return new THREE.Line(geometry, material);
  }, [x, z, radius, color, height, offset]);

  return <primitive object={lineObj} />;
}

export function CollisionDebug() {
  const allies = useDefenseStore((s) => s.allies);
  const mothership = useDefenseStore((s) => s.mothership);

  // 디버그 모드가 아니면 렌더링 안 함
  if (!isCollisionDebugEnabled()) {
    return null;
  }

  const boxHeight = C.render.shipHeight * 2;

  return (
    <group name="collision-debug">
      {/* 아군 OBB */}
      {allies
        .filter((a) => a.alive)
        .map((ally) => (
          <OBBWireframe
            key={`obb-ally-${ally.id}`}
            x={ally.x}
            z={ally.z}
            heading={ally.heading}
            color={0x00ff00}
            height={boxHeight}
          />
        ))}

      {/* 모선 충돌 원 */}
      <CircleWireframe
        x={mothership.x}
        z={mothership.z}
        radius={mothership.radius}
        color={0xffff00}
        height={boxHeight}
      />
    </group>
  );
}
