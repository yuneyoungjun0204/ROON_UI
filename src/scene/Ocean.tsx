// 바다 — 정점 셰이더에서 파도(waves.ts와 동일 파라미터)로 변위시키는 대형 평면.
// 평면은 USV를 따라다니므로 끝에 도달하지 않는다(파도는 월드 좌표 기준이라 이동해도 무늬가 흐르지 않음).

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { wavesGlsl } from "../sim/waves";
import { useSimStore } from "../store";

const SIZE = 4000;
const SEGMENTS = 256;

const vertexShader = /* glsl */ `
uniform float uTime;
varying vec3 vWorldPos;
varying vec3 vNormal;

${"__WAVES__"}

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float h = waveHeight(wp.xz, uTime);
  wp.y += h;

  // 유한 차분으로 법선 계산
  float e = 1.2;
  float hx = waveHeight(wp.xz + vec2(e, 0.0), uTime);
  float hz = waveHeight(wp.xz + vec2(0.0, e), uTime);
  vNormal = normalize(vec3(h - hx, e, h - hz));
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uDeepColor;
uniform vec3 uSkyColor;
varying vec3 vWorldPos;
varying vec3 vNormal;

void main() {
  vec3 n = normalize(vNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);

  // 프레넬 — 낮은 각도에서 하늘색 반사가 강해진다
  float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
  vec3 base = mix(uDeepColor, uSkyColor, fresnel * 0.85);

  // 태양 스페큘러
  vec3 halfDir = normalize(uSunDir + viewDir);
  float spec = pow(max(dot(n, halfDir), 0.0), 220.0);
  vec3 color = base + vec3(1.0, 0.97, 0.85) * spec * 0.9;

  // 파고에 따른 미세한 밝기 변화
  color += vec3(0.02, 0.04, 0.05) * smoothstep(0.2, 0.9, vWorldPos.y);

  gl_FragColor = vec4(color, 1.0);
}
`;

export function Ocean({ sunDir }: { sunDir: THREE.Vector3 }) {
  const meshRef = useRef<THREE.Mesh>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSunDir: { value: sunDir.clone().normalize() },
      uDeepColor: { value: new THREE.Color("#0d3550") },
      uSkyColor: { value: new THREE.Color("#8fc3e8") },
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
