import type { LocalPoint } from "./webMercator";

export interface WaterPolygon {
  outer: LocalPoint[];
  holes: LocalPoint[][];
}

function pointInRing(x: number, z: number, ring: LocalPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    const crosses = a.z > z !== b.z > z;
    if (!crosses) continue;
    const hitX = ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x;
    if (x < hitX) inside = !inside;
  }
  return inside;
}

export function isPointInWater(x: number, z: number, polygons: WaterPolygon[]): boolean {
  for (const polygon of polygons) {
    if (!pointInRing(x, z, polygon.outer)) continue;
    if (polygon.holes.some((hole) => pointInRing(x, z, hole))) continue;
    return true;
  }
  return false;
}
