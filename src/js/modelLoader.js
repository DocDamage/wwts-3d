/**
 * One loader for every model: compressed GLB first (meshopt geometry + WebP
 * textures, made by tools/convert_assets.mjs), falling back to the source FBX.
 *
 * GLB materials arrive as PBR (MeshStandardMaterial); the stage lighting was
 * tuned for the FBX look, so characters get classic Phong materials back.
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

let gltfLoader = null;
let fbxLoader = null;

function gltf() {
  if (!gltfLoader) {
    gltfLoader = new GLTFLoader();
    gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  }
  return gltfLoader;
}

function fbx() {
  if (!fbxLoader) fbxLoader = new FBXLoader();
  return fbxLoader;
}

/** PBR -> Phong, keeping maps and transparency */
function toClassic(m) {
  if (!m || !m.isMeshStandardMaterial) return m;
  const p = new THREE.MeshPhongMaterial({
    name: m.name,
    color: m.color,
    map: m.map,
    normalMap: m.normalMap,
    emissive: m.emissive,
    emissiveMap: m.emissiveMap,
    transparent: m.transparent,
    opacity: m.opacity,
    alphaTest: m.alphaTest,
    side: m.side,
    shininess: 18,
    specular: new THREE.Color(0x1a1a1a)
  });
  if (m.normalMap) p.normalScale.copy(m.normalScale);
  m.dispose();
  return p;
}

function loadGlb(url, { classic = true } = {}) {
  return new Promise((resolve, reject) => {
    gltf().load(url, (res) => {
      const root = res.scene;
      root.animations = res.animations || [];
      if (classic) {
        root.traverse(n => {
          if (!n.isMesh) return;
          n.material = Array.isArray(n.material) ? n.material.map(toClassic) : toClassic(n.material);
        });
      }
      resolve(root);
    }, undefined, reject);
  });
}

function loadFbx(url) {
  return new Promise((resolve, reject) => fbx().load(url, resolve, undefined, reject));
}

/**
 * Load a model by its FBX path; the .glb next to it is used when present.
 * Resolves to an Object3D with `.animations`.
 */
async function loadModel(path, opts) {
  const glb = path.replace(/\.fbx$/i, '.glb');
  if (glb !== path) {
    try {
      return await loadGlb(glb, opts);
    } catch {
      // no compressed version (or it failed): use the source
    }
  }
  return /\.glb$/i.test(path) ? loadGlb(path, opts) : loadFbx(path);
}

export { loadModel, loadGlb, loadFbx };
