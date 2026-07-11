import { useEffect, useMemo, useState } from "react";
import { useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { config } from "../config";
import {
  localMetersToLonLat,
  lonLatToMercator,
  lonLatToTile,
  mercatorToLocalMeters,
  tileToMercatorBounds,
  type TileId,
} from "../geo/webMercator";
import { sampleElevation } from "../geo/elevation";
import { getSharedWaterMask, type SharedWaterMask } from "./waterMaskTexture";
import { WATER_LEVEL_Y } from "../sim/waves";
import { useSimStore } from "../store";

const MAP_ZOOM = 16;
const TILE_RADIUS = 3; // 7×7 타일 — 호수를 두르는 육지가 시야를 채우도록
const TERRAIN_SEGMENTS = 48; // DEM을 촘촘히 따라가 높낮이가 매끄럽게
const VERTICAL_EXAGGERATION = 1.0; // 실제 고도 비율

interface MapTile {
  id: TileId;
  url: string;
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
}

function vworldTileUrl(tile: TileId, layer: "Satellite" | "Hybrid"): string {
  const ext = layer === "Satellite" ? "jpeg" : "png";
  return `https://api.vworld.kr/req/wmts/1.0.0/${config.vworldKey}/${layer}/${tile.z}/${tile.y}/${tile.x}.${ext}`;
}

function buildTiles(): MapTile[] {
  const origin = lonLatToMercator(config.initialLon, config.initialLat);
  const centerTile = lonLatToTile(config.initialLon, config.initialLat, MAP_ZOOM);
  const tiles: MapTile[] = [];

  for (let dy = -TILE_RADIUS; dy <= TILE_RADIUS; dy += 1) {
    for (let dx = -TILE_RADIUS; dx <= TILE_RADIUS; dx += 1) {
      const id = { x: centerTile.x + dx, y: centerTile.y + dy, z: centerTile.z };
      const bounds = tileToMercatorBounds(id);
      const nw = mercatorToLocalMeters(
        { x: bounds.west, y: bounds.north },
        origin,
        config.initialLat,
      );
      const se = mercatorToLocalMeters(
        { x: bounds.east, y: bounds.south },
        origin,
        config.initialLat,
      );

      tiles.push({
        id,
        url: vworldTileUrl(id, "Satellite"),
        centerX: (nw.x + se.x) / 2,
        centerZ: (nw.z + se.z) / 2,
        width: Math.abs(se.x - nw.x),
        depth: Math.abs(se.z - nw.z),
      });
    }
  }

  return tiles;
}

function GeoTile({ tile, mask }: { tile: MapTile; mask: SharedWaterMask | null }) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const texture = useLoader(THREE.TextureLoader, tile.url, (loader) => {
    loader.setCrossOrigin("anonymous");
  });

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  // 지형은 실제 위성을 DEM 높이에 입히되, Lambert 재질로 씬 태양·하늘빛을 받아
  // DEM 법선에 따라 경사면 음영이 진다 (무조명 → 조명 통합: 배·하늘과 같은 세계).
  // 수역 처리는 지오메트리에서(정점 끌어내림) 하므로 프래그먼트 discard가 없다 —
  // 경계 근처를 살짝 어둡게 눌러 '젖은 물가' 띠만 더한다.
  const material = useMemo(() => {
    const m = new THREE.MeshLambertMaterial({
      map: texture,
      side: THREE.DoubleSide,
      fog: true,
    });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader =
        "varying vec2 vWorldXZ;\n" +
        shader.vertexShader.replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\n  vWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;",
        );
      const head = mask
        ? "varying vec2 vWorldXZ;\nuniform sampler2D uWaterMask;\nuniform float uMaskBound;\n"
        : "varying vec2 vWorldXZ;\n";
      const shoreCode = mask
        ? [
            "#include <map_fragment>",
            "  vec2 vMaskUv = (vWorldXZ + uMaskBound) / (2.0 * uMaskBound);",
            "  float maskWater = texture2D(uWaterMask, vMaskUv).r;",
            "  // 물가 젖은 띠 — 경계로 갈수록 살짝 어둡게",
            "  diffuseColor.rgb *= mix(1.0, 0.8, smoothstep(0.15, 0.6, maskWater));",
          ].join("\n")
        : "#include <map_fragment>";
      shader.fragmentShader =
        head + shader.fragmentShader.replace("#include <map_fragment>", shoreCode);
      if (mask) {
        shader.uniforms.uWaterMask = { value: mask.texture };
        shader.uniforms.uMaskBound = { value: mask.bound };
      }
    };
    return m;
  }, [texture, mask]);

  // 마스크가 도착하면 지오메트리를 다시 만든다 — 수역 정점이 물속으로 내려가도록
  // (DEM 타일은 캐시돼 있어 재생성은 수 ms 수준)
  useEffect(() => {
    let cancelled = false;
    buildTerrainGeometry(tile, mask).then((next) => {
      if (cancelled) {
        next.dispose();
        return;
      }
      setGeometry(next); // 이전 지오메트리는 아래 effect가 정리
    });
    return () => {
      cancelled = true;
    };
  }, [tile, mask]);

  useEffect(() => () => geometry?.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  if (!geometry) return null;

  return <mesh geometry={geometry} material={material} receiveShadow />;
}

async function buildTerrainGeometry(
  tile: MapTile,
  mask: SharedWaterMask | null,
): Promise<THREE.BufferGeometry> {
  const segments = TERRAIN_SEGMENTS;
  const vertexCount = (segments + 1) * (segments + 1);
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices: number[] = [];
  const baseElevation =
    (await sampleElevation(config.initialLon, config.initialLat)) ?? 0;
  const samples: Promise<number | null>[] = [];

  for (let row = 0; row <= segments; row += 1) {
    const v = row / segments;
    for (let col = 0; col <= segments; col += 1) {
      const u = col / segments;
      const i = row * (segments + 1) + col;
      const x = tile.centerX + (u - 0.5) * tile.width;
      const z = tile.centerZ + (v - 0.5) * tile.depth;
      const { lon, lat } = localMetersToLonLat(
        x,
        z,
        config.initialLon,
        config.initialLat,
      );
      samples[i] = sampleElevation(lon, lat);
      positions[i * 3] = x;
      positions[i * 3 + 2] = z;
      uvs[i * 2] = u;
      uvs[i * 2 + 1] = 1 - v;
    }
  }

  // 수역 비율 — 마스크를 주변 반경까지 블러 샘플링 (0=뭍 … 1=물).
  // 이 값으로 비탈을 "서서히" 내리면 절벽 스미어(텍스처 세로 늘어짐)와
  // 경계 외톨이 스파이크가 사라진다.
  const waterFrac = (x: number, z: number): number => {
    if (!mask) return 0;
    const R1 = 7;
    const R2 = 15;
    let s = mask.sampleWater(x, z) * 2;
    s += mask.sampleWater(x + R1, z) + mask.sampleWater(x - R1, z);
    s += mask.sampleWater(x, z + R1) + mask.sampleWater(x, z - R1);
    s += mask.sampleWater(x + R2, z) + mask.sampleWater(x - R2, z);
    s += mask.sampleWater(x, z + R2) + mask.sampleWater(x, z - R2);
    return s / 10;
  };
  const smoothstep = (a: number, b: number, v: number): number => {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  const elevations = await Promise.all(samples);
  for (let i = 0; i < vertexCount; i += 1) {
    const elevation = elevations[i] ?? baseElevation;
    let y = (elevation - baseElevation) * VERTICAL_EXAGGERATION;
    // 실제 수역(OSM) 정점은 수면 아래로 — 블러된 수역 비율만큼 점진적으로 끌어내려
    // 둑 → 물속 경사가 ~30m에 걸쳐 완만하게 이어진다.
    if (mask) {
      const w = smoothstep(0.15, 0.85, waterFrac(positions[i * 3], positions[i * 3 + 2]));
      if (w > 0) {
        const sunk = Math.min(y, WATER_LEVEL_Y - 3);
        y += (sunk - y) * w;
      }
    }
    positions[i * 3 + 1] = y;
  }

  for (let row = 0; row < segments; row += 1) {
    for (let col = 0; col < segments; col += 1) {
      const a = row * (segments + 1) + col;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function GeoMapSurface() {
  const tiles = useMemo(() => (config.vworldKey ? buildTiles() : []), []);
  const waterPolygons = useSimStore((s) => s.waterPolygons);

  // 마스크가 지형 전체를 덮도록, 타일 범위에서 최대 반경(±bound)을 구한다.
  const maskBound = useMemo(() => {
    let b = 0;
    for (const t of tiles) {
      b = Math.max(b, Math.abs(t.centerX) + t.width / 2, Math.abs(t.centerZ) + t.depth / 2);
    }
    return Math.ceil(b) || 2000;
  }, [tiles]);

  // 공유 모듈이 생성·캐시 — 물 셰이더(물가 포말)도 같은 마스크를 쓴다
  const mask = useMemo(
    () => getSharedWaterMask(waterPolygons, maskBound),
    [waterPolygons, maskBound],
  );

  if (!config.vworldKey) return null;

  return (
    <group name="daecheong-vworld-map">
      {tiles.map((tile) => (
        <GeoTile key={`${tile.id.z}-${tile.id.x}-${tile.id.y}`} tile={tile} mask={mask} />
      ))}
    </group>
  );
}
