/*
 * Quantum computer hero model for the Quantum vs. Classical carousel card:
 * m2_glb_full_chandelier.web.glb — the whole chandelier as one authored asset,
 * with the Majorana 2 chip already in place and its own materials baked in.
 *
 * This replaces the hand-assembled version (SM_Quantum_Computer.FBX plus a
 * separately scaled SM_Majorana1.OBJ, with materials rebuilt from loose PNG
 * maps). Nothing here rebuilds materials any more: the glTF carries them, so
 * the only thing added is the HDRI environment the metals reflect.
 *
 * The model loads once, eagerly at module import — i.e. during app boot, while
 * the attract screen is up — and is memoised, so the menu card never shows a
 * loading gap.
 */

import * as THREE from 'three'
import { assetUrl } from '../../core/asset-url.js'

const MODEL_URL = 'assets/m2_glb_full_chandelier.web.glb'

/* The geometry is Draco-compressed, so the decoder has to travel with the
   app: the kiosk runs with no network, and three's default decoder path is a
   CDN. These three files are vendored from three/examples/jsm/libs/draco/gltf
   into public/, and need re-copying if three is upgraded. */
const DRACO_DECODER_PATH = 'assets/draco/'

/* Only the chassis feeds the shadow map — shadowing the dense internals as
   well tips the carousel pool over its frame budget. The glTF's meshes are all
   exported as "OUT", so the chassis is identified by its material name, which
   is the only thing in the file that distinguishes the parts. */
const SHADOW_CASTING_MATERIALS = /chassis/i

let assemblyPromise = null

function loadChandelier() {
  assemblyPromise ??= (async () => {
    const [{ GLTFLoader }, { DRACOLoader }, { EXRLoader }] = await Promise.all([
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/loaders/DRACOLoader.js'),
      import('three/addons/loaders/EXRLoader.js')
    ])

    /* Real HDRI environment for the metals (palermo square). */
    const environment = await new EXRLoader().loadAsync(
      assetUrl('assets/palermo_square_1k.exr')
    )
    environment.mapping = THREE.EquirectangularReflectionMapping

    const dracoLoader = new DRACOLoader().setDecoderPath(assetUrl(DRACO_DECODER_PATH))
    const loader = new GLTFLoader().setDRACOLoader(dracoLoader)
    let gltf
    try {
      gltf = await loader.loadAsync(assetUrl(MODEL_URL))
    } finally {
      /* Decoding is finished by the time the load settles, so the worker pool
         can go. Left running it holds a worker per core for the whole session. */
      dracoLoader.dispose()
    }

    const assembly = gltf.scene
    assembly.traverse(node => {
      if (!node.isMesh) return
      const materials = Array.isArray(node.material) ? node.material : [node.material]
      node.castShadow = materials.some(
        material => SHADOW_CASTING_MATERIALS.test(material?.name || '')
      )
      for (const material of materials) {
        if (!material?.isMeshStandardMaterial) continue
        material.envMap = environment
        material.envMapIntensity = 1.1
        /* glTF textures arrive at anisotropy 1, which crawls on the card's
           grazing angles. */
        for (const map of [material.map, material.normalMap, material.roughnessMap,
          material.metalnessMap, material.aoMap, material.emissiveMap]) {
          if (map) map.anisotropy = 8
        }
        material.needsUpdate = true
      }
    })

    return assembly
  })()
  return assemblyPromise
}

/* Warm the cache at app boot, while the attract screen is up. */
void loadChandelier().catch(error => {
  console.warn('Quantum computer nav model could not be preloaded.', error)
})

export function createQuantumComputerMenuObject({ radius }) {
  const group = new THREE.Group()
  const spinner = new THREE.Group()
  group.add(spinner)

  void loadChandelier().then(assembly => {
    /* Frame the whole chandelier inside the card. The hand-assembled model this
       replaced was cropped at the top on purpose — it was mostly support pipe up
       there — but this one carries detail all the way up, so it is sized to fit
       rather than to run off the edge, and anchored on its middle. */
    const bounds = new THREE.Box3().setFromObject(assembly)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const scale = Math.min(
      (radius * 1.9) / Math.max(size.x, size.z),
      (radius * 2.5) / size.y
    )
    const anchorY = bounds.min.y + (size.y * 0.5)
    assembly.scale.setScalar(scale)
    assembly.position.set(-center.x * scale, -anchorY * scale, -center.z * scale)
    spinner.add(assembly)
  }).catch(error => {
    console.warn('Quantum computer nav model could not be loaded.', error)
  })

  /* Rigid presentation: the fridge turns slowly in place — no tilt,
     no sway. */
  group.userData.update = seconds => {
    spinner.rotation.y = seconds * 0.32
  }
  return group
}
