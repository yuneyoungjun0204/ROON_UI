// 스테이션 존 — 선박의 초기 위치(로컬 원점)를 중심으로 한 기지 구역 표시.
// 하늘로 뻗는 빛기둥: 위로 갈수록 잦아드는 반투명 원통 벽(가산 블렌딩) +
// 얇은 수면 테두리 + 바깥으로 번지는 글로우 링. 은은한 펄스로 시선을 끈다.
// 전용 레이어에 두어 메인 카메라·스테이션 CCTV에는 보이고,
// FPV(선수 카메라)에는 나타나지 않는다. (항로 레이어와는 별도)

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { WATER_LEVEL_Y } from "../sim/waves";
import { config, STATION_ZONE_RADIUS_M } from "../config";

/** 스테이션 존 표시 전용 레이어 — CCTV에는 보이되 FPV에는 숨긴다 */
export const ZONE_LAYER = 2;

const ZONE_Y = config.vworldKey ? WATER_LEVEL_Y : 0;
const RADIUS = STATION_ZONE_RADIUS_M;
const WALL_HEIGHT_M = 400; // 빛기둥 높이 — 멀리서도 하늘을 배경으로 또렷하게 보인다
const GLOW_OUTER_M = RADIUS + 7; // 수면 글로우가 번지는 바깥 반경
const ZONE_COLOR = new THREE.Color("#ffd44d");

/** 원통 벽 — 아래는 또렷하고 위로 갈수록 빛이 잦아드는 세로 그라데이션 */
function makeWallMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: ZONE_COLOR },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying float vH;
      void main() {
        vH = uv.y; // 0 = 밑동, 1 = 꼭대기
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      varying float vH;
      void main() {
        float fade = pow(1.0 - vH, 2.8); // 위로 갈수록 빠르게 사라짐
        float pulse = 0.85 + 0.15 * sin(uTime * 1.6);
        gl_FragColor = vec4(uColor, fade * 0.30 * pulse);
      }
    `,
  });
}

/** 수면 글로우 링 — 테두리에서 바깥으로 부드럽게 번지는 빛 */
function makeGlowMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: ZONE_COLOR },
      uTime: { value: 0 },
      uInner: { value: RADIUS },
      uOuter: { value: GLOW_OUTER_M },
    },
    vertexShader: /* glsl */ `
      varying vec2 vPos;
      void main() {
        vPos = position.xy; // RingGeometry는 XY 평면
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uInner;
      uniform float uOuter;
      varying vec2 vPos;
      void main() {
        float t = clamp((length(vPos) - uInner) / (uOuter - uInner), 0.0, 1.0);
        float pulse = 0.8 + 0.2 * sin(uTime * 1.6);
        gl_FragColor = vec4(uColor, pow(1.0 - t, 2.2) * 0.55 * pulse);
      }
    `,
  });
}

export function StationZone() {
  const groupRef = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  const wallMat = useMemo(makeWallMaterial, []);
  const glowMat = useMemo(makeGlowMaterial, []);

  useEffect(
    () => () => {
      wallMat.dispose();
      glowMat.dispose();
    },
    [wallMat, glowMat],
  );

  // 메인 카메라가 존 레이어를 보도록 켠다 (CCTV는 FpvCamera 쪽에서 켠다)
  useEffect(() => {
    camera.layers.enable(ZONE_LAYER);
  }, [camera]);

  // 레이어는 상속되지 않으므로 마운트 시 전체를 존 레이어로 옮긴다
  useEffect(() => {
    groupRef.current?.traverse((o) => o.layers.set(ZONE_LAYER));
  }, []);

  useFrame(({ clock }) => {
    wallMat.uniforms.uTime.value = clock.elapsedTime;
    glowMat.uniforms.uTime.value = clock.elapsedTime;
  });

  return (
    <group ref={groupRef} position={[0, ZONE_Y, 0]}>
      {/* 빛기둥 벽 */}
      <mesh position={[0, WALL_HEIGHT_M / 2, 0]} renderOrder={10} material={wallMat}>
        <cylinderGeometry args={[RADIUS, RADIUS, WALL_HEIGHT_M, 64, 1, true]} />
      </mesh>
      {/* 바깥으로 번지는 수면 글로우 */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.28, 0]} renderOrder={11} material={glowMat}>
        <ringGeometry args={[RADIUS, GLOW_OUTER_M, 64]} />
      </mesh>
      {/* 얇고 또렷한 경계선 */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.3, 0]} renderOrder={12}>
        <ringGeometry args={[RADIUS - 0.35, RADIUS, 64]} />
        <meshBasicMaterial
          color={ZONE_COLOR}
          transparent
          opacity={0.95}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}
