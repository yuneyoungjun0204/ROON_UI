// 3D 씬 — 하늘·조명·바다·USV·추적 카메라.

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Sky } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { Ocean } from "./Ocean";
import { Usv } from "./Usv";
import { useSimStore } from "../store";
import { waveHeight } from "../sim/waves";

const SUN_DIR = new THREE.Vector3(60, 38, -45);

/** 카메라가 USV를 따라가되, 사용자가 자유롭게 돌려볼 수 있게 한다. */
function FollowCamera() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const target = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera, clock }) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const { usv } = useSimStore.getState();
    const y = waveHeight(usv.x, usv.z, clock.elapsedTime);
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
      camera={{ position: [14, 8, 18], fov: 55, near: 0.5, far: 6000 }}
      gl={{ antialias: true }}
    >
      <Sky
        distance={450000}
        sunPosition={SUN_DIR.toArray()}
        turbidity={6}
        rayleigh={1.6}
        mieCoefficient={0.004}
      />
      <fog attach="fog" args={["#a8c8de", 300, 2600]} />
      <hemisphereLight args={["#bcd8ee", "#1d3a50", 0.9]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={SUN_DIR.toArray()}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      <directionalLight position={[-40, 25, 60]} intensity={0.5} />
      <Ocean sunDir={SUN_DIR} />
      <Usv />
      <FollowCamera />
    </Canvas>
  );
}
