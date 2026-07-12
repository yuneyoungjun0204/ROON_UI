import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { config } from "../config";
import { buildGerstnerGLSL, WATER_LEVEL_Y } from "../sim/waves";
import { createSkyColorUniforms, skyGradientGlsl } from "./skyGlsl";
import { getCurrentWaterMask } from "./waterMaskTexture";
import { lonLatToLocalMeters } from "../geo/webMercator";
import type { WaterPolygon } from "../geo/waterArea";
import { useSimStore } from "../store";

const WATER_Y = WATER_LEVEL_Y; // 수면 기준 높이 — 물가 턱을 덮도록 올림
const WATER_SIZE = 7200;
const WATER_SEGMENTS = 160; // 잔잔한 챱(진폭 ~0.14m)이라 성긴 격자로 충분 — 정점 5배 절감
const TRAIL_N = 64; // 항적 포말 포인트 수 — 두 헐 × 촘촘한 간격을 담을 만큼
const WAKE_SPACING_M = 2.0; // 항적 방출 간격 (이동 거리 기준 — 속도와 무관하게 고른 띠)
const WAKE_STERN_AFT_M = 7.2; // 선미 방출점 (선체 중심 기준 후방)
const WAKE_HULL_OFFSET_M = 2.55; // 좌/우 헐 중심 측방 오프셋 (쌍동선 데미헐 간격)
const MIN_WATER_AREA_M2 = 2_500;
const CACHE_KEY = "daecheong-water-mask-overpass-v1";
const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
];
const DAECHUNG_BBOX = {
  south: 36.39,
  west: 127.36,
  north: 36.57,
  east: 127.61,
};

// shipmulator 이식: 정점 Gerstner 파도 2개(앨리어싱 없음),
// 프래그먼트 FBM 잔물결 법선 + Fresnel 하늘반사 + 태양 글린트 + crest/항적 포말.
const makeVertexShader = () => /* glsl */ `
uniform float uTime;
varying vec3 vWorldPos;
varying vec3 vWaveNormal;
varying float vWaveHeight;
#include <fog_pars_vertex>

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 p = wp.xyz;
  vec3 disp = vec3(0.0);
  vec3 nrm = vec3(0.0, 1.0, 0.0);
  ${buildGerstnerGLSL()}

  vec3 displaced = p + disp;
  vWorldPos = displaced;
  vWaveNormal = normalize(nrm);
  vWaveHeight = disp.y;

  vec4 mvPosition = viewMatrix * vec4(displaced, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const makeFragmentShader = () => /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uDeep;
uniform vec3 uScatter;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uMidSky;
uniform vec3 uHorizonSky;
uniform vec4 uTrail[${TRAIL_N}];
uniform sampler2D uShoreMask;
uniform float uMaskBound;
uniform float uHasMask;
varying vec3 vWorldPos;
varying vec3 vWaveNormal;
varying float vWaveHeight;
#include <fog_pars_fragment>

${skyGradientGlsl}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y);
}
float fbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * noise(p); p *= 2.17; a *= 0.5; }
  return s;
}

void main() {
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 n = normalize(vWaveNormal);

  // 잔물결: 노이즈 기반 법선 (규칙적 사인 대신 → 격자 무늬 없음)
  // 큰 스케일 + 작은 스케일 두 겹. 교란을 약하게 유지하고 원경은 감쇠 —
  // 과하면 스페큘러가 얼룩덜룩한 흰 덩어리로 번진다.
  float camDist = length(cameraPosition - vWorldPos);
  float detail = 1.0 - smoothstep(80.0, 1600.0, camDist);
  vec2 np1 = vWorldPos.xz * 0.045 + vec2(uTime * 0.020, uTime * 0.014);
  vec2 np2 = vWorldPos.xz * 0.14 + vec2(-uTime * 0.016, uTime * 0.024);
  float e = 0.09;
  float h1 = fbm(np1);
  vec2 g1 = vec2(fbm(np1 + vec2(e, 0.0)) - h1, fbm(np1 + vec2(0.0, e)) - h1);
  float h2 = fbm(np2);
  vec2 g2 = vec2(fbm(np2 + vec2(e, 0.0)) - h2, fbm(np2 + vec2(0.0, e)) - h2);
  vec2 grad = (g1 * 0.5 + g2 * 0.3) * (0.35 + 0.65 * detail);
  n = normalize(n + vec3(grad.x, 0.0, grad.y));

  // 물 색: 파랑 베이스 + 마루에서 살짝 밝은 산란색 (은은하게)
  float crest = clamp(vWaveHeight * 0.8 + 0.45, 0.0, 1.0);
  float sunSide = 0.7 + 0.3 * max(dot(n, uSunDir), 0.0);
  vec3 waterCol = mix(uDeep, uScatter, crest * 0.4 * sunSide);

  // Fresnel 하늘 반사 — 스카이돔과 동일한 그라데이션을 반사 방향으로 샘플링
  float fres = 0.025 + 0.975 * pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 5.0);
  fres = min(fres, 0.85);
  vec3 refl = skyGradient(reflect(-V, n), uZenith, uMidSky, uHorizonSky, uSunDir);
  vec3 color = mix(waterCol, refl, fres);

  // 태양 글린트 — 좁고 또렷한 윤슬만 (넓은 로브는 근경에서 뿌연 번짐을 만들어 제거)
  vec3 H = normalize(V + uSunDir);
  float ndh = max(dot(n, H), 0.0);
  float spec = pow(ndh, 600.0) * 0.8 + pow(ndh, 180.0) * 0.015;
  color += uSunColor * spec;

  // 포말: crest + 항적
  float steep = 1.0 - n.y;
  float crestFoam = smoothstep(0.62, 0.95, crest) * smoothstep(0.02, 0.06, steep);

  float wake = 0.0;
  for (int i = 0; i < ${TRAIL_N}; i++) {
    vec4 tp = uTrail[i];
    float age = uTime - tp.z;
    if (tp.w > 0.001 && age > 0.0 && age < 14.0) {
      float rad = 1.35 + age * 0.9; // 천천히 퍼진다 — 이웃 점과 겹쳐 연속된 띠가 되게
      float d = distance(vWorldPos.xz, tp.xy);
      float fadeIn = smoothstep(0.0, 0.45, age); // 탁 튀며 생기지 않게 서서히 등장
      wake += tp.w * fadeIn * exp(-age * 0.26) * smoothstep(rad, rad * 0.15, d);
    }
  }
  wake = clamp(wake, 0.0, 1.0);

  float foamNoise = 0.55 + 0.45 * noise(vWorldPos.xz * 0.9 + uTime * 0.2);
  // 항적은 노이즈를 약하게 태워 끊김 없이, 파도 마루 포말은 기존대로 얼룩덜룩하게
  float foam = clamp(crestFoam * 0.45 * foamNoise + wake * (0.68 + 0.32 * foamNoise), 0.0, 1.0);
  color = mix(color, vec3(0.94, 0.97, 0.98), foam * 0.85);

  // 물가 전이 — 수역 마스크 경계 근처(뭍 쪽)에 얕은 물 톤 + 찰랑이는 포말 띠
  if (uHasMask > 0.5) {
    vec2 muv = (vWorldPos.xz + uMaskBound) / (2.0 * uMaskBound);
    if (muv.x > 0.0 && muv.x < 1.0 && muv.y > 0.0 && muv.y < 1.0) {
      float m = texture2D(uShoreMask, muv).r; // 1=물, 0=뭍
      float shallow = 1.0 - smoothstep(0.5, 0.85, m);
      color = mix(color, color * 1.12 + vec3(0.03, 0.045, 0.045), shallow * 0.5);
      float bandIn = smoothstep(0.5, 0.58, m) * (1.0 - smoothstep(0.58, 0.8, m));
      float lap = 0.5 + 0.5 * sin(uTime * 1.2 + vWorldPos.x * 0.4 + vWorldPos.z * 0.31);
      float shoreFoam = bandIn * (0.3 + 0.45 * lap) * (0.5 + 0.5 * noise(vWorldPos.xz * 1.6));
      color = mix(color, vec3(0.92, 0.95, 0.96), clamp(shoreFoam, 0.0, 0.55));
    }
  }

  gl_FragColor = vec4(color, 1.0);
  #include <fog_fragment>
}
`;

type LonLat = [number, number];
type PolygonCoords = LonLat[][];

interface WaterMaskData {
  polygons: WaterPolygon[];
}

interface OverpassPoint {
  lat: number;
  lon: number;
}

interface OverpassMember {
  role?: string;
  geometry?: OverpassPoint[];
}

interface OverpassElement {
  type: "way" | "relation" | "node";
  tags?: Record<string, string>;
  geometry?: OverpassPoint[];
  members?: OverpassMember[];
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

function buildOverpassQuery(): string {
  const { south, west, north, east } = DAECHUNG_BBOX;
  const bbox = `${south},${west},${north},${east}`;
  return `
    [out:json][timeout:25];
    (
      way["natural"="water"](${bbox});
      relation["natural"="water"](${bbox});
      way["water"="reservoir"](${bbox});
      relation["water"="reservoir"](${bbox});
      way["landuse"="reservoir"](${bbox});
      relation["landuse"="reservoir"](${bbox});
    );
    out body geom;
  `;
}

function ringArea(points: WaterPolygon["outer"]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.z - b.x * a.z;
  }
  return Math.abs(area) / 2;
}

function isWaterTags(tags: Record<string, string> | undefined): boolean {
  if (!tags) return false;
  return (
    tags.natural === "water" ||
    tags.water === "reservoir" ||
    tags.water === "lake" ||
    tags.landuse === "reservoir"
  );
}

function toLonLatRing(points: OverpassPoint[]): LonLat[] {
  return points.map((p) => [p.lon, p.lat]);
}

function pointKey(point: OverpassPoint): string {
  return `${point.lat.toFixed(7)},${point.lon.toFixed(7)}`;
}

function isClosed(points: OverpassPoint[]): boolean {
  return points.length >= 4 && pointKey(points[0]) === pointKey(points[points.length - 1]);
}

function stitchSegments(segments: OverpassPoint[][]): OverpassPoint[][] {
  const remaining = segments.filter((segment) => segment.length >= 2).map((segment) => [...segment]);
  const rings: OverpassPoint[][] = [];

  while (remaining.length > 0) {
    let ring = remaining.shift() ?? [];
    let changed = true;

    while (!isClosed(ring) && changed) {
      changed = false;
      const ringStart = pointKey(ring[0]);
      const ringEnd = pointKey(ring[ring.length - 1]);

      for (let i = 0; i < remaining.length; i += 1) {
        const segment = remaining[i];
        const segStart = pointKey(segment[0]);
        const segEnd = pointKey(segment[segment.length - 1]);

        if (ringEnd === segStart) {
          ring = [...ring, ...segment.slice(1)];
        } else if (ringEnd === segEnd) {
          ring = [...ring, ...segment.slice(0, -1).reverse()];
        } else if (ringStart === segEnd) {
          ring = [...segment.slice(0, -1), ...ring];
        } else if (ringStart === segStart) {
          ring = [...segment.slice(1).reverse(), ...ring];
        } else {
          continue;
        }

        remaining.splice(i, 1);
        changed = true;
        break;
      }
    }

    if (isClosed(ring)) rings.push(ring);
  }

  return rings;
}

function lonLatRingToLocalPoints(ring: LonLat[]) {
  return ring.map(([lon, lat]) =>
    lonLatToLocalMeters(lon, lat, config.initialLon, config.initialLat),
  );
}

function polygonToWaterPolygon(polygon: PolygonCoords): WaterPolygon | null {
  const [outerRing, ...holeRings] = polygon;
  if (!outerRing || outerRing.length < 4) return null;

  const outer = lonLatRingToLocalPoints(outerRing);
  if (ringArea(outer) < MIN_WATER_AREA_M2) return null;

  return {
    outer,
    holes: holeRings.filter((ring) => ring.length >= 4).map(lonLatRingToLocalPoints),
  };
}

function extractPolygons(overpass: OverpassResponse): PolygonCoords[] {
  const polygons: PolygonCoords[] = [];
  for (const element of overpass.elements ?? []) {
    if (element.type === "way" && isWaterTags(element.tags) && element.geometry) {
      if (isClosed(element.geometry)) polygons.push([toLonLatRing(element.geometry)]);
    }

    if (element.type === "relation" && isWaterTags(element.tags) && element.members) {
      const outerSegments = element.members
        .filter((member) => member.role !== "inner" && member.geometry)
        .map((member) => member.geometry as OverpassPoint[]);
      const innerSegments = element.members
        .filter((member) => member.role === "inner" && member.geometry)
        .map((member) => member.geometry as OverpassPoint[]);

      const outerRings = stitchSegments(outerSegments).map(toLonLatRing);
      const innerRings = stitchSegments(innerSegments).map(toLonLatRing);

      for (const outer of outerRings) {
        polygons.push([outer, ...innerRings]);
      }
    }
  }
  return polygons;
}

async function fetchWaterMaskData(signal: AbortSignal): Promise<WaterMaskData> {
  const cached = sessionStorage.getItem(CACHE_KEY);
  const osm = cached ? JSON.parse(cached) : await fetchOverpass(signal);
  const rawPolygons = extractPolygons(osm as OverpassResponse);
  return {
    polygons: rawPolygons
      .map(polygonToWaterPolygon)
      .filter((polygon): polygon is WaterPolygon => Boolean(polygon)),
  };
}

async function fetchOverpass(signal: AbortSignal): Promise<unknown> {
  const query = buildOverpassQuery();
  let lastError: unknown = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: `data=${encodeURIComponent(query)}`,
        signal,
      });
      if (!response.ok) throw new Error(`${endpoint} failed: ${response.status}`);
      const data = await response.json();
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
      return data;
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Overpass failed");
}

export function WaterMask({ sunDir }: { sunDir: THREE.Vector3 }) {
  const setWaterPolygons = useSimStore((s) => s.setWaterPolygons);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchWaterMaskData(controller.signal)
      .then((data) => {
        setWaterPolygons(data.polygons);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.warn("Failed to load water mask", error);
        }
      });
    return () => {
      controller.abort();
      setWaterPolygons([]);
    };
  }, [setWaterPolygons]);

  // 항적 포말 링버퍼 — Vector4(worldX, worldZ, 발생시각, 세기)
  const trail = useMemo(
    () => Array.from({ length: TRAIL_N }, () => new THREE.Vector4(0, 0, -1000, 0)),
    [],
  );
  const wakeState = useRef({ nextIdx: 0, lastEmit: -1, lastX: 0, lastZ: 0 });

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSunDir: { value: sunDir.clone().normalize() },
      ...createSkyColorUniforms(),
      uDeep: { value: new THREE.Color(0x33699f) }, // 자연스러운 중간 파랑 (과포화 방지)
      uScatter: { value: new THREE.Color(0x6f9fce) }, // 마루 산란 — 부드러운 밝은 파랑
      uSunColor: { value: new THREE.Color(0xfff4dc) },
      uTrail: { value: trail },
      // 물가 마스크 — 로드되면 useFrame에서 실제 텍스처로 교체
      uShoreMask: { value: new THREE.Texture() },
      uMaskBound: { value: 1 },
      uHasMask: { value: 0 },
      fogColor: { value: new THREE.Color() },
      fogNear: { value: 1 },
      fogFar: { value: 1000 },
    }),
    [sunDir, trail],
  );

  // 셰이더 문자열은 렌더 시점에 조립한다 (모듈 로드 순서에 의존하지 않아 HMR에 안전)
  const shaders = useMemo(
    () => ({ vertexShader: makeVertexShader(), fragmentShader: makeFragmentShader() }),
    [],
  );

  useFrame(({ clock }) => {
    const mat = materialRef.current;
    if (!mat) return;
    const t = clock.elapsedTime;
    mat.uniforms.uTime.value = t;

    // 공유 물가 마스크가 준비되면 바인딩 (지형 쪽에서 생성)
    if (mat.uniforms.uHasMask.value < 0.5) {
      const mask = getCurrentWaterMask();
      if (mask) {
        mat.uniforms.uShoreMask.value = mask.texture;
        mat.uniforms.uMaskBound.value = mask.bound;
        mat.uniforms.uHasMask.value = 1;
      }
    }

    // 항적 포말 — 좌/우 데미헐 후미에서 한 쌍씩, 이동 거리 기준으로 고르게 방출.
    // (시간 기준이면 속도에 따라 점 간격이 벌어져 뚝뚝 끊긴 띠가 된다)
    const { usv } = useSimStore.getState();
    const spd = Math.abs(usv.speed);
    const ws = wakeState.current;
    const moved = Math.hypot(usv.x - ws.lastX, usv.z - ws.lastZ);
    const churn = Math.max(Math.abs(usv.thrustPort), Math.abs(usv.thrustStbd)) / 100;
    const shouldEmit =
      (moved >= WAKE_SPACING_M && spd > 0.4) ||
      // 제자리 회전(pivot) — 거의 안 움직여도 쓰러스터가 물을 휘저으면 거품
      (t - ws.lastEmit > 0.4 && churn > 0.4 && spd <= 0.4);
    if (shouldEmit) {
      ws.lastEmit = t;
      ws.lastX = usv.x;
      ws.lastZ = usv.z;
      const rad = (usv.heading * Math.PI) / 180;
      const fwdX = Math.sin(rad);
      const fwdZ = -Math.cos(rad); // 북쪽 = -z
      const stbX = -fwdZ; // 우현 방향
      const stbZ = fwdX;
      const base = Math.min(spd / 7, 1);
      // 각 헐의 웨이크는 그 쪽 쓰러스터 출력(프로펠러 후류)에서만 나온다 —
      // 한쪽만 추진하면 그쪽 헐 뒤에만 물자국이 남고, 차동 선회 시 좌우 비대칭이 보인다.
      // 쓰러스터는 후미 고정 장착이므로 후진 중에도 방출점은 항상 선미다.
      const emit = (lateral: number, thrustPct: number) => {
        const use = Math.abs(thrustPct) / 100; // 0~1
        if (use < 0.04) return; // 쓰러스터가 꺼진 헐에서는 웨이크 없음
        const strength = Math.min(1, Math.pow(use, 0.7) * (0.45 + 0.55 * base));
        trail[ws.nextIdx].set(
          usv.x - fwdX * WAKE_STERN_AFT_M + stbX * lateral,
          usv.z - fwdZ * WAKE_STERN_AFT_M + stbZ * lateral,
          t,
          strength,
        );
        ws.nextIdx = (ws.nextIdx + 1) % TRAIL_N;
      };
      emit(-WAKE_HULL_OFFSET_M, usv.thrustPort); // 좌현 헐
      emit(WAKE_HULL_OFFSET_M, usv.thrustStbd); // 우현 헐
    }
  });

  return (
    <mesh
      name="daecheong-water-surface"
      position={[0, WATER_Y, 0]}
      rotation-x={-Math.PI / 2}
      frustumCulled={false}
    >
      <planeGeometry args={[WATER_SIZE, WATER_SIZE, WATER_SEGMENTS, WATER_SEGMENTS]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={shaders.vertexShader}
        fragmentShader={shaders.fragmentShader}
        uniforms={uniforms}
        fog
      />
    </mesh>
  );
}
