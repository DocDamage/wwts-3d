/**
 * Fresnel rim light for any lit three.js material (Lambert / Phong / Standard).
 * Edges facing away from the camera glow in `color`, so dark outfits keep a
 * readable silhouette against a dark stage.
 */
import * as THREE from 'three';

export function addRimLight(material, { color = 0xffffff, strength = 1, power = 2.5 } = {}) {
  const uniforms = {
    uRimColor: { value: new THREE.Color(color) },
    uRimStrength: { value: strength },
    uRimPower: { value: power }
  };
  material.userData.rim = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uRimColor;
uniform float uRimStrength;
uniform float uRimPower;`)
      .replace('#include <opaque_fragment>', `{
  float rimF = pow(1.0 - saturate(abs(dot(normalize(normal), normalize(vViewPosition)))), uRimPower);
  outgoingLight += uRimColor * rimF * uRimStrength;
}
#include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'rim-light';
  material.needsUpdate = true;
  return uniforms;
}
