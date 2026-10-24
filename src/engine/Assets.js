import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

// Asset cache. Paths are relative to /assets (Vite publicDir), e.g. 'textures/asphalt/albedo.png'.
export class Assets {
  constructor(renderer) {
    this.renderer = renderer;
    this.texLoader = new THREE.TextureLoader();
    this.gltfLoader = new GLTFLoader();
    this.hdrLoader = new HDRLoader();
    this.cache = new Map();
  }

  // opts: { srgb: bool (true for albedo/emissive), repeat: [x,y], anisotropy }
  texture(path, opts = {}) {
    const key = 'tex:' + path + JSON.stringify(opts);
    if (this.cache.has(key)) return this.cache.get(key);
    const p = this.texLoader.loadAsync('/' + path).then((t) => {
      t.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
      t.anisotropy = opts.anisotropy ?? 16;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.needsUpdate = true;
      return t;
    }).catch((e) => { console.warn('[assets] missing texture', path, e?.message); return null; });
    this.cache.set(key, p);
    return p;
  }

  gltf(path) {
    const key = 'gltf:' + path;
    if (this.cache.has(key)) return this.cache.get(key);
    const p = this.gltfLoader.loadAsync('/' + path).catch((e) => { console.warn('[assets] missing gltf', path, e?.message); return null; });
    this.cache.set(key, p);
    return p;
  }

  hdr(path) {
    const key = 'hdr:' + path;
    if (this.cache.has(key)) return this.cache.get(key);
    const p = this.hdrLoader.loadAsync('/' + path).catch(() => null);
    this.cache.set(key, p);
    return p;
  }
}
