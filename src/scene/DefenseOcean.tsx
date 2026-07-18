// ─────────────────────────────────────────────────────────────────────────
// 방어 시뮬레이터용 바다 — 파도가 있는 대형 평면
// Ocean.tsx 기반, 중앙 고정
// ─────────────────────────────────────────────────────────────────────────

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { wavesGlsl } from "../sim/waves";
import { DEFENSE_CONFIG as C } from "../config/defense";

const SIZE = C.worldSize * 1.2;
const SEGMENTS = 200;

const vertexShader = /* glsl */ `
uniform float uTime;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vWaveH;

${"__WAVES__"}

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float h = waveHeight(wp.xz, uTime);
  wp.y += h;
  vWaveH = h;

  float e = 1.2;
  float hx = waveHeight(wp.xz + vec2(e, 0.0), uTime);
  float hz = waveHeight(wp.xz + vec2(0.0, e), uTime);
  vNormal = normalize(vec3(h - hx, e, h - hz));
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uDeepColor;
uniform vec3 uSeaColor;
uniform vec3 uSkyColor;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vWaveH;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float detailH(vec2 p, float t) {
  float h = 0.0;
  h += vnoise(p * 0.35 + vec2(t * 0.20, t * 0.13)) * 0.60;
  h += vnoise(p * 0.95 - vec2(t * 0.26, t * 0.17)) * 0.30;
  h += vnoise(p * 2.30 + vec2(t * 0.34, -t * 0.23)) * 0.12;
  return h;
}

void main() {
  vec2 wp = vWorldPos.xz;

  float camDist = length(cameraPosition - vWorldPos);
  float detailAmp = 0.8 * (1.0 - smoothstep(60.0, 900.0, camDist));
  float e = 0.45;
  float h0 = detailH(wp, uTime);
  float hx = detailH(wp + vec2(e, 0.0), uTime);
  float hz = detailH(wp + vec2(0.0, e), uTime);
  vec3 n = normalize(vNormal + vec3((h0 - hx) * detailAmp, 0.0, (h0 - hz) * detailAmp));

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float facing = max(dot(n, viewDir), 0.0);

  vec3 base = mix(uSeaColor, uDeepColor, facing);
  float fresnel = pow(1.0 - facing, 3.0);
  vec3 color = mix(base, uSkyColor, fresnel * 0.85);

  float sunBehind = max(dot(viewDir, -uSunDir), 0.0);
  color += vec3(0.02, 0.12, 0.11) * sunBehind * smoothstep(0.1, 1.1, vWaveH);

  vec3 halfDir = normalize(uSunDir + viewDir);
  float ndh = max(dot(n, halfDir), 0.0);
  color += vec3(1.0, 0.96, 0.82) * (pow(ndh, 260.0) * 1.2 + pow(ndh, 36.0) * 0.12);

  float crest = smoothstep(0.55, 1.15, vWaveH + (h0 - 0.5) * 0.9);
  color = mix(color, vec3(0.90, 0.95, 0.97), crest * 0.30);

  gl_FragColor = vec4(color, 1.0);
}
`;

interface DefenseOceanProps {
  sunDir: THREE.Vector3;
}

export function DefenseOcean({ sunDir }: DefenseOceanProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSunDir: { value: sunDir.clone().normalize() },
      uDeepColor: { value: new THREE.Color("#07304a") },
      uSeaColor: { value: new THREE.Color("#155e74") },
      uSkyColor: { value: new THREE.Color("#9dccec") },
    }),
    [sunDir],
  );

  useFrame(({ clock }) => {
    uniforms.uTime.value = clock.elapsedTime;
  });

  return (
    <mesh ref={meshRef} rotation-x={-Math.PI / 2} position={[0, 0, 0]} frustumCulled={false}>
      <planeGeometry args={[SIZE, SIZE, SEGMENTS, SEGMENTS]} />
      <shaderMaterial
        vertexShader={vertexShader.replace("__WAVES__", wavesGlsl())}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
      />
    </mesh>
  );
}
