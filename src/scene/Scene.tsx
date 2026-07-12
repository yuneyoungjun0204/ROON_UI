// 3D 씬 — 하늘·조명·바다·USV·추적 카메라.
// 하늘 돔을 PMREM 환경맵으로 구워 씬 전체(배 PBR 반사, 지형 조명)가
// 눈에 보이는 하늘과 같은 빛을 공유한다 — 요소들이 한 세계에 있는 것처럼 보이는 핵심.

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { Ocean } from "./Ocean";
import { Usv } from "./Usv";
import { Wake } from "./Wake";
import { GeoMapSurface } from "./GeoMapSurface";
import { WaterMask } from "./WaterMask";
import { RouteLine } from "./RouteLine";
import { StationZone } from "./StationZone";
import { FpvRenderPass } from "./FpvCamera";
import { useSimStore } from "../store";
import { waveHeight, lakeWaveHeight, WATER_LEVEL_Y } from "../sim/waves";
import { makeSkyMaterial, SKY_PALETTE } from "./skyGlsl";
import { config } from "../config";

/** 수면 높이 샘플러 — 지오맵(호수) 모드면 잔잔한 호수 너울, 아니면 바다 파도 */
const waterHeight = config.vworldKey ? lakeWaveHeight : waveHeight;
/** 수면 기준 높이 — 지오맵 모드에서만 올림 (바다 모드는 y=0) */
const WATER_LEVEL = config.vworldKey ? WATER_LEVEL_Y : 0;

const SUN_DIR = new THREE.Vector3(50, 62, -38);

/** 그라데이션 스카이돔 — 수면 반사·환경맵과 동일한 하늘 재질을 공유한다. */
function SkyDome() {
  const material = useMemo(() => makeSkyMaterial(SUN_DIR), []);
  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
  });

  return (
    <mesh frustumCulled={false} renderOrder={-100} material={material}>
      <sphereGeometry args={[5200, 32, 24]} />
    </mesh>
  );
}

/** 하늘 돔을 PMREM으로 한 번 구워 scene.environment로 —
 * 배의 PBR 재질이 실제 하늘빛을 반사하게 된다 (shipmulator 방식). */
function SkyEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envScene = new THREE.Scene();
    const mat = makeSkyMaterial(SUN_DIR);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 20), mat);
    envScene.add(dome);
    const rt = pmrem.fromScene(envScene, 0.04);
    scene.environment = rt.texture;
    return () => {
      scene.environment = null;
      rt.dispose();
      pmrem.dispose();
      dome.geometry.dispose();
      mat.dispose();
    };
  }, [gl, scene]);

  return null;
}

/** 카메라가 USV를 따라가되, 사용자가 자유롭게 돌려볼 수 있게 한다. */
function FollowCamera() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const target = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera, clock }) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const { usv } = useSimStore.getState();
    const y = WATER_LEVEL + waterHeight(usv.x, usv.z, clock.elapsedTime);
    target.set(usv.x, y + 1.2, usv.z);
    // 타깃 이동량만큼 카메라도 평행이동 → 시점 유지한 채 따라감
    camera.position.add(target.clone().sub(controls.target));
    controls.target.copy(target);
    controls.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enablePan={false}
      minDistance={6}
      maxDistance={120}
      maxPolarAngle={Math.PI / 2 - 0.04}
      enableDamping
      dampingFactor={0.08}
    />
  );
}

export function Scene() {
  return (
    <Canvas
      shadows
      camera={{ position: [18, 10, 24], fov: 55, near: 0.5, far: 6000 }}
      gl={{ antialias: true }}
    >
      <SkyDome />
      <SkyEnvironment />
      {/* 대기 원근 — 원경이 수평선색으로 잦아들어 깊이감을 만든다 */}
      <fog attach="fog" args={[SKY_PALETTE.horizon, 500, 2600]} />
      <hemisphereLight args={["#cfe6f8", "#3a5f6e", 0.5]} />
      <ambientLight intensity={0.22} />
      <directionalLight
        position={SUN_DIR.toArray()}
        intensity={1.35}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      <directionalLight position={[-40, 25, 60]} intensity={0.25} />
      {config.vworldKey ? (
        <>
          <GeoMapSurface />
          <WaterMask sunDir={SUN_DIR} />
        </>
      ) : (
        <Ocean sunDir={SUN_DIR} />
      )}
      {!config.vworldKey && <Wake />}
      <RouteLine />
      <StationZone />
      <Usv />
      <FollowCamera />
      <FpvRenderPass />
    </Canvas>
  );
}
