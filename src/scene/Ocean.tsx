// 바다 — 정점 셰이더에서 파도(waves.ts와 동일 파라미터)로 변위시키는 대형 평면.
// 프래그먼트에서 절차적 노이즈로 잔물결 노말과 마루 거품을 더한다.
// 평면은 USV를 따라다니므로 끝에 도달하지 않는다(파도는 월드 좌표 기준이라 이동해도 무늬가 흐르지 않음).

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { wavesGlsl } from "../sim/waves";
import { useSimStore } from "../store";

const SIZE = 3200;
const SEGMENTS = 380;

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

  // 유한 차분으로 스웰 법선 계산
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

// 값 노이즈 — 잔물결 디테일용
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
// 스케일이 다른 노이즈 3겹을 서로 다른 방향으로 흘려 잔물결을 만든다
float detailH(vec2 p, float t) {
  float h = 0.0;
  h += vnoise(p * 0.35 + vec2(t * 0.20, t * 0.13)) * 0.60;
  h += vnoise(p * 0.95 - vec2(t * 0.26, t * 0.17)) * 0.30;
  h += vnoise(p * 2.30 + vec2(t * 0.34, -t * 0.23)) * 0.12;
  return h;
}

void main() {
  vec2 wp = vWorldPos.xz;

  // 잔물결로 법선 교란 (거리에 따라 약화 — 원경 반짝임 노이즈 방지)
  float camDist = length(cameraPosition - vWorldPos);
  float detailAmp = 0.8 * (1.0 - smoothstep(60.0, 900.0, camDist));
  float e = 0.45;
  float h0 = detailH(wp, uTime);
  float hx = detailH(wp + vec2(e, 0.0), uTime);
  float hz = detailH(wp + vec2(0.0, e), uTime);
  vec3 n = normalize(vNormal + vec3((h0 - hx) * detailAmp, 0.0, (h0 - hz) * detailAmp));

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float facing = max(dot(n, viewDir), 0.0);

  // 내려다보면 깊은 청록, 스치듯 보면 밝아짐 + 프레넬 하늘 반사
  vec3 base = mix(uSeaColor, uDeepColor, facing);
  float fresnel = pow(1.0 - facing, 3.0);
  vec3 color = mix(base, uSkyColor, fresnel * 0.85);

  // 파도 뒤로 해가 비칠 때의 투과광(가짜 SSS) — 마루를 청록빛으로
  float sunBehind = max(dot(viewDir, -uSunDir), 0.0);
  color += vec3(0.02, 0.12, 0.11) * sunBehind * smoothstep(0.1, 1.1, vWaveH);

  // 태양 스페큘러 (좁은 글린트 + 넓은 광택)
  vec3 halfDir = normalize(uSunDir + viewDir);
  float ndh = max(dot(n, halfDir), 0.0);
  color += vec3(1.0, 0.96, 0.82) * (pow(ndh, 260.0) * 1.2 + pow(ndh, 36.0) * 0.12);

  // 마루 거품 — 파고와 노이즈로 살짝 흩뿌림
  float crest = smoothstep(0.55, 1.15, vWaveH + (h0 - 0.5) * 0.9);
  color = mix(color, vec3(0.90, 0.95, 0.97), crest * 0.30);

  gl_FragColor = vec4(color, 1.0);
}
`;

export function Ocean({ sunDir }: { sunDir: THREE.Vector3 }) {
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
    // 바다 평면이 USV를 따라오게
    const { usv } = useSimStore.getState();
    meshRef.current?.position.set(usv.x, 0, usv.z);
  });

  return (
    <mesh ref={meshRef} rotation-x={-Math.PI / 2} frustumCulled={false}>
      <planeGeometry args={[SIZE, SIZE, SEGMENTS, SEGMENTS]} />
      <shaderMaterial
        vertexShader={vertexShader.replace("__WAVES__", wavesGlsl())}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
      />
    </mesh>
  );
}
