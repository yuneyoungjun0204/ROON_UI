// OSM 수역 폴리곤 → 흑백 마스크 텍스처 (물=흰색, 육지·섬=검정).
// 지형(수역 잘라내기)과 물 셰이더(물가 포말·얕은 물 톤)가 같은 마스크를 공유한다.

import * as THREE from "three";
import type { WaterPolygon } from "../geo/waterArea";

const WATER_MASK_SIZE = 2048;

export interface SharedWaterMask {
  texture: THREE.CanvasTexture;
  bound: number;
  /** 월드 (x, z)의 수역 여부 — 마스크 픽셀 샘플 (1=물, 0=뭍). CPU 지형 정점용. */
  sampleWater: (x: number, z: number) => number;
}

let current: (SharedWaterMask & { keyPolygons: WaterPolygon[] }) | null = null;

function buildWaterMaskTexture(
  polygons: WaterPolygon[],
  bound: number,
): { texture: THREE.CanvasTexture; sampleWater: (x: number, z: number) => number } | null {
  const canvas = document.createElement("canvas");
  canvas.width = WATER_MASK_SIZE;
  canvas.height = WATER_MASK_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#000"; // 기본은 육지
  ctx.fillRect(0, 0, WATER_MASK_SIZE, WATER_MASK_SIZE);

  const trace = (ring: { x: number; z: number }[]) => {
    ctx.beginPath();
    ring.forEach((p, i) => {
      const px = ((p.x + bound) / (2 * bound)) * WATER_MASK_SIZE;
      const py = ((p.z + bound) / (2 * bound)) * WATER_MASK_SIZE;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
  };

  ctx.fillStyle = "#fff"; // 수역 = 흰색
  for (const poly of polygons) {
    trace(poly.outer);
    ctx.fill();
  }
  ctx.fillStyle = "#000"; // 섬(구멍) = 다시 육지
  for (const poly of polygons) {
    for (const hole of poly.holes) {
      trace(hole);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false; // 캔버스 좌상단 = uv(0,0)
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;

  // CPU 샘플러 — 지형 정점을 수역에서 끌어내릴 때 사용
  const img = ctx.getImageData(0, 0, WATER_MASK_SIZE, WATER_MASK_SIZE).data;
  const sampleWater = (x: number, z: number): number => {
    const px = Math.round(((x + bound) / (2 * bound)) * (WATER_MASK_SIZE - 1));
    const py = Math.round(((z + bound) / (2 * bound)) * (WATER_MASK_SIZE - 1));
    if (px < 0 || py < 0 || px >= WATER_MASK_SIZE || py >= WATER_MASK_SIZE) return 0;
    return img[(py * WATER_MASK_SIZE + px) * 4] / 255;
  };

  return { texture: tex, sampleWater };
}

/** 마스크를 (재)생성하거나 캐시된 것을 돌려준다. 폴리곤 배열 참조·bound가 같으면 재사용. */
export function getSharedWaterMask(
  polygons: WaterPolygon[],
  bound: number,
): SharedWaterMask | null {
  if (polygons.length === 0) return null;
  if (current && current.keyPolygons === polygons && current.bound === bound) {
    return current;
  }
  const built = buildWaterMaskTexture(polygons, bound);
  if (!built) return null;
  current?.texture.dispose();
  current = { ...built, bound, keyPolygons: polygons };
  return current;
}

/** 마지막으로 생성된 마스크 — 물 셰이더가 프레임마다 폴링해 도착 시점에 바인딩한다. */
export function getCurrentWaterMask(): SharedWaterMask | null {
  return current;
}
