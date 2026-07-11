// 선수 카메라 (FPV) — 쌍동선 상판 앞쪽 중앙에 장착되어 항상 정면을 바라본다.
// USV 그룹에 자식으로 붙어 침로·파도 자세(히브/롤/피치)를 그대로 물려받고,
// 메인 렌더 후 HUD 카메라 카드(#fpv-view) 위치에 시저(scissor) 패스로 그려진다.

import { useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/** 장착 위치 (USV 그룹 로컬, 선수 = -z): 데크 앞끝 중앙, 선수 난간(높이 ~2.1m) 바로 위 —
 * 난간·데크가 프레임 하단에 살짝 걸려 1인칭감을 주되 렌즈를 가리지는 않는 높이. */
const MOUNT_POSITION: [number, number, number] = [0, 2.35, -4.35];

export const fpvCamera = new THREE.PerspectiveCamera(65, 16 / 9, 0.3, 6000);
fpvCamera.position.set(...MOUNT_POSITION);
fpvCamera.rotation.set(0, 0, 0); // 기본 시선 -z = 선수 방향

/** 메인 뷰 + FPV 뷰를 직접 렌더링하는 패스.
 * useFrame 우선순위 > 0 이면 R3F 자동 렌더가 꺼지므로 메인 패스도 여기서 그린다. */
export function FpvRenderPass() {
  const gl = useThree((s) => s.gl);

  // 언마운트 시 자동 렌더 상태로 복원되도록 뷰포트를 되돌린다
  useEffect(() => {
    return () => {
      gl.setScissorTest(false);
      gl.autoClear = true;
    };
  }, [gl]);

  useFrame(({ gl: renderer, scene, camera, size }) => {
    // 1) 메인 패스 (전체 화면)
    renderer.autoClear = true;
    renderer.setViewport(0, 0, size.width, size.height);
    renderer.render(scene, camera);

    // 2) FPV 패스 — HUD 카드의 뷰 영역과 같은 위치·크기로 시저 렌더
    const el = document.getElementById("fpv-view");
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return;
    const canvasRect = renderer.domElement.getBoundingClientRect();
    const x = rect.left - canvasRect.left;
    const y = canvasRect.bottom - rect.bottom; // GL 뷰포트 y는 아래에서 위
    const aspect = rect.width / rect.height;
    if (Math.abs(fpvCamera.aspect - aspect) > 1e-3) {
      fpvCamera.aspect = aspect;
      fpvCamera.updateProjectionMatrix();
    }

    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, rect.width, rect.height);
    renderer.setViewport(x, y, rect.width, rect.height);
    renderer.render(scene, fpvCamera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.width, size.height);
    renderer.autoClear = true;
  }, 1);

  return null;
}
