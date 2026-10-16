// Bloom and tilt-shift (station spec §5). The bloom is gentle and capped: a high threshold and a low
// strength, so lit things glow instead of blowing out. The tilt-shift keeps a band around your row sharp and
// blurs toward the top of the screen (more) and the bottom (less), drawn as two 9-tap passes.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const TiltShift = {
  uniforms: {
    tDiffuse: { value: null },
    focus: { value: 0.45 }, // the sharp band's centre, 0 = bottom of the screen, 1 = top
    band: { value: 0.18 }, // half its height: wide enough that the wall signs a few tiles north of you stay readable
    top: { value: 2.0 }, // blur toward the top, in texels per tap
    bottom: { value: 1.4 },
    dir: { value: new THREE.Vector2(1, 0) },
    texel: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float focus, band, top, bottom; uniform vec2 dir, texel; varying vec2 vUv;
    void main() {
      float d = vUv.y - focus;
      float a = d > 0.0 ? smoothstep(band, band + 0.45, d) * top : smoothstep(band, band + 0.35, -d) * bottom;
      if (a < 0.01) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec4 s = vec4(0.0); float w = 0.0;
      for (int i = -4; i <= 4; i++) { float f = float(i); float k = exp(-f * f / 8.0); s += texture2D(tDiffuse, vUv + dir * texel * f * a) * k; w += k; }
      gl_FragColor = s / w;
    }`,
};

export function createPost(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.35, 0.88); // strength, radius, threshold
  composer.addPass(bloom);
  const across = new ShaderPass(TiltShift), down = new ShaderPass(TiltShift);
  down.uniforms.dir.value.set(0, 1);
  composer.addPass(across);
  composer.addPass(down);
  const output = new OutputPass();
  composer.addPass(output);
  return {
    setSize(w, h, dpr) {
      composer.setPixelRatio(dpr);
      composer.setSize(w, h);
      for (const p of [across, down]) p.uniforms.texel.value.set(1 / (w * dpr), 1 / (h * dpr));
    },
    // The tilt-shift on or off (first person sees everything sharp).
    setTilt(on) { for (const p of [across, down]) { p.uniforms.top.value = on ? 2.0 : 0; p.uniforms.bottom.value = on ? 1.4 : 0; } },
    setFocus(y01) { across.uniforms.focus.value = down.uniforms.focus.value = Math.min(0.9, Math.max(0.1, y01)); },
    render() { composer.render(); },
    dispose() { bloom.dispose(); across.dispose?.(); down.dispose?.(); output.dispose(); composer.dispose(); },
  };
}
