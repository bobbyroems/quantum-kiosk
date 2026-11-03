export const NANOWIRE_COLORS = Object.freeze({
  neutral: 0xd1d4d6,
  airborne: 0x6f8fe9,
  /* The inspection field is deliberately achromatic so the one saturated red
     atom is unmistakable. Repair returns that atom to gray while its emissive
     and halo turn green as the confirmation signal. */
  defectCore: 0xf4364c,
  defectCoreEmissive: 0xf4364c,
  defectHalo: 0xff9a70,
  defect: 0xa70922,
  defectEmissive: 0x340008,
  repairedDefect: 0xc8cbcc,
  repairHalo: 0xc1ffaa,
  correctionPulse: 0x73c800,
  correctionPulseEmissive: 0x549900
})

/* One satin ceramic-metal surface for both the navigation preview and the
   full experience. Story colours are applied on top of this identity; they
   never replace its roughness or clearcoat response. */
export const NANOWIRE_ATOM_SURFACE = Object.freeze({
  metalness: 0.025,
  roughness: 0.34,
  clearcoat: 0.3,
  clearcoatRoughness: 0.34,
  envMapIntensity: 1
})

/* The reference perturbation is a moving field across the complete lattice,
   not a radial marker around the defective atom. */
export const NANOWIRE_PERTURBED_FLOW_GRADIENT = Object.freeze([
  0xb90f2e,
  0xd52b2f,
  0xe95c2d,
  0xf2a72e,
  0xe8dc26,
  0xbddf24,
  0x72d936,
  0x25cc64,
  0x27c7a1
])

export const NANOWIRE_LOUPE_ERROR_GRADIENT = Object.freeze([
  0xf4f3f5,
  0xd9d9d6,
  0xb1b3b3,
  0xc8cbcc,
  0x9fa4a6,
  0xe7e7e4,
  0xb8bbbc
])

export const NANOWIRE_LOUPE_CORRECTED_GRADIENT = Object.freeze([
  0xf4f3f5,
  0xd9d9d6,
  0xb1b3b3,
  0xc8cbcc,
  0xa7abad,
  0xe2e2df,
  0xb6b9ba
])

/* The finished wire, replacing the blue-to-lime flow it used to run (IQM,
   25 Aug). Both values are sampled from the finished wire on the design board:
   the body sits between #1C5FCB and #376ED6 across its lit faces, and the light
   passing through it reads around #8CC0EA. */
export const NANOWIRE_FINAL_FLOW_BASE = 0x1f5fd0
export const NANOWIRE_FINAL_FLOW_PULSE = 0x86cbe8
