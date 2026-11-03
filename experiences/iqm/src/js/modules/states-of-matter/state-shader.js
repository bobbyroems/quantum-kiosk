/*
 * Full-screen screen-shader for States of Matter: frost, then rain, then steam,
 * composited over the scrub video.
 *
 * The water pass is a port of the Codrops "Rain & Water Effect Experiments" by
 * Lucas Bebber (2015) — https://github.com/codrops/RainEffect, src/shaders/
 * water.frag. Licence: "Integrate or build upon it for free in your personal or
 * commercial projects. Don't republish, redistribute or sell as-is."
 * https://tympanus.net/codrops/licensing/
 *
 * The three steps the module is specified around:
 *
 *   1. frost dynamically builds on the screen
 *   2. condensation forms as the ice melts
 *   3. fog makes things behind it blurry
 *
 * Step 1 is a port of Andrea Riccardi's FreezePostProcess — the shader behind
 * the 80.lv "freezing screen shader" article:
 *   https://github.com/a-riccardi/shader-toy
 *     ShaderToy/Assets/FreezePostProcess/Shaders/Git/FreezePostProcess.shader
 * It is per-pixel, driven by deterministic field textures baked from
 * state-fields.js by scripts/generate-som-frost-assets.mjs, and includes Inigo
 * Quilez's non-uniform tiling so the crystal map never repeats visibly. Frost was
 * briefly built out of stamped sprites the way the rain builds its drops; discrete
 * stamps read as blotches no matter how irregular the sprite, because frost is a
 * continuous field at every scale.
 *
 * Step 2 is the Codrops rain: a CPU-built normal map refracted per pixel.
 *
 * One deliberate departure from both originals: each composites an opaque
 * backdrop of its own, whereas this is a TRANSPARENT overlay. Steps 1 and 2 leave
 * the footage entirely untouched — no blur, no scale, no filter — and layer over
 * it. The rain original leans on a blurred backdrop to make each drop read as a
 * lens; with the footage pristine that job falls to the drops' own shading (the
 * fresnel rim and specular below), which this scene needs regardless, since a
 * smooth grey gradient gives a lens nothing to reveal.
 *
 * Step 3's blur is not in here. The fog blurs the video element itself (see
 * index.js), while this transparent canvas contributes the steam. The complete
 * treatment is contained by the media stacking context so module chrome remains
 * clear and interactive above it.
 */
import { assetUrl } from '../../core/asset-url.js'
import { leaseWebGLRenderer } from '../../core/webgl-renderer-pool.js'
import {
  calculateStageAwarePixelRatio,
  elementCssScale
} from '../../core/three-render-budget.js'
import { drawVideoFrameToCanvas } from './media.js'
import { createRainDrops } from './rain-drops.js'

const DROP_ALPHA_ASSET = 'assets/modules/states-of-matter/rain/drop-alpha.png'
const DROP_COLOR_ASSET = 'assets/modules/states-of-matter/rain/drop-color.png'
const DROP_SHINE_ASSET = 'assets/modules/states-of-matter/rain/drop-shine.png'
const FROST_MAP_ASSET = 'assets/modules/states-of-matter/frost/frost-main.png'
const FROST_FINE_MAP_ASSET = 'assets/modules/states-of-matter/frost/frost-fine.png'
const FROST_FILM_MAP_ASSET = 'assets/modules/states-of-matter/frost/frost-film.png'
const NOISE_MAP_ASSET = 'assets/modules/states-of-matter/frost/noise.png'

/* Frost, rain and steam are all diffuse, so a full-screen pass can run below
   native resolution and stay inside the frame budget while the video seek is
   also competing for the GPU. */
const MAX_RENDER_PIXELS = 2_000_000
const TARGET_FPS = 30
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS

/* Copy of the video the drops refract. Only ever sampled inside a drop or a
   frost facet, both of which distort it, so it needn't match the panel. */
export const SCENE_SOURCE_WIDTH = 1080
export const SCENE_SOURCE_HEIGHT = 1920
/* The rain simulation runs on the CPU, so it renders small and upscales. */
export const WATER_MAP_WIDTH = 720
export const WATER_MAP_HEIGHT = 1280

/* The original is tuned for a ~1024x768 landscape canvas. On a 720x1280 map
   upscaled to a 2160x3840 portrait panel its default 10..40 radii would give
   drops 100-300px wide, so the radii and droplet sizes are scaled down to keep
   the drops the same apparent size they have in the reference. */
const RAIN_OPTIONS = Object.freeze({
  minR: 7,
  maxR: 26,
  maxDrops: 900,
  /* Spawn radius is biased cubically toward minR, and the big drops come from
     collision merging rather than from spawning large. That needs population
     density, so the rates run above the reference's defaults. */
  rainChance: 0.5,
  rainLimit: 5,
  dropletsRate: 55,
  dropletsSize: [1.5, 3.2],
  trailRate: 1,
  globalTimeScale: 1
})

/*
 * Bead-film values, tuned on the glass and settled.
 *
 * Still uniforms rather than GLSL constants so the film stays adjustable from one
 * place if it needs another pass, but nothing writes them at runtime any more — the
 * dev panel that drove them has been removed now the look is signed off.
 */
const BEAD_UNIFORMS = Object.freeze({
  uFrostFilmTiling: 2.05,
  uFrostFilmGain: 0.52,
  uFrostFilmRefraction: 0.34,
  uFrostFilmLift: 0.04,
  uFrostFilmSpan: 0.16,
  uFrostFilmSpanY: 0.18,
  uFrostFilmOuter: 0.29,
  uFrostFilmInner: 0,
  /* Three scales on the film's own frontier: coarse swings the boundary in lobes,
     mid shreds those into lace, fine throws speckle out ahead of it. Distances are
     in uv, so the coarse term is what decides how far a lobe can reach. */
  uFrostFilmNoiseCoarse: 0.055,
  uFrostFilmNoiseMid: 0.022,
  uFrostFilmNoiseFine: 0.012
})

const VERTEX_SHADER = /* glsl */`
  varying vec2 vUv;


  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const FRAGMENT_SHADER = /* glsl */`
  precision highp float;

  uniform sampler2D uTextureFg;
  uniform sampler2D uWaterMap;
  uniform sampler2D uShine;
  uniform sampler2D uFrostMap;
  uniform sampler2D uFrostFineMap;
  uniform sampler2D uFrostFilmMap;
  uniform sampler2D uNoiseMap;
  uniform vec2 uResolution;
  uniform float uFrost;
  uniform float uWater;
  uniform float uGas;
  uniform float uTime;

  varying vec2 vUv;

  /* Water constants, from the reference renderer's defaults. */
  const float MIN_REFRACTION = 256.0;
  const float REFRACTION_DELTA = 256.0;
  const float ALPHA_MULTIPLY = 20.0;
  const float ALPHA_SUBTRACT = 5.0;
  const float BRIGHTNESS = 1.04;
  const bool RENDER_SHINE = true;
  const bool RENDER_SHADOW = true;

  /* Peak opacity of the gas smoke. Higher than the flat veil it replaced, because
     the field is modulated rather than uniform. */
  const float GAS_SMOKE_ALPHA = 0.9;

  /* Ice and crust values, tuned on the glass and settled. Constants; the bead film's
     equivalents are the uniforms below, seeded from BEAD_UNIFORMS. */
  const float FREEZE_STEEPNESS = 6.6;
  const float FROST_COVERAGE_GAIN = 0.3;
  const float FROST_REFRACTION = 0.45;
  const float FROST_EDGE_FADE = 0.23;
  const float FROST_EDGE_EROSION = 3.0;
  const float FROST_FINE_TILING = 2.9;
  const float FROST_FINE_EDGE_BIAS = 2.5;
  const float FROST_FINE_GAIN = 0.67;
  const vec3 FROST_TINT = vec3(0.788, 0.812, 0.812);
  const float FROST_TINT_STRENGTH = 0.28;

  /* How much the bead columns thicken toward the top and bottom of the stage. Zero
     gives two plain vertical bands; it cannot widen them past the gate. */
  const float FROST_FILM_CORNER_BIAS = 0.8;

  /* Opaque white bloom at the border. SPAN is how far in from the edge it reaches,
     as a fraction of the axis; SOFTNESS is the width of the noise threshold, so
     smaller values give harder-edged patches. */
  const float FROST_BLOOM_SPAN = 0.19;
  const float FROST_BLOOM_ALPHA = 0.48;
  const float FROST_BLOOM_SOFTNESS = 0.42;
  const float FROST_BLOOM_FALLOFF = 2.6;
  const float FROST_BLOOM_NOISE_COARSE = 0.058;
  const float FROST_BLOOM_NOISE_MID = 0.02;

  /* The media fills the stage, but the top 120px are hidden by the opaque nav.
     Treat its lower edge as the visible frost boundary so the white crust does not
     spend its strongest part behind the nav and leave only a watery fringe below. */
  const float FROST_TOP_INSET = 120.0 / 3840.0;

  /* The info card, carved out of the white bloom the same way it is carved out of the
     growth map — the bloom reaches over the panel. Kept in
     step with state-fields.js and styles.css by hand. */
  const float CARD_TOP = 830.0 / 3840.0;
  const float CARD_BOTTOM = 1120.0 / 3840.0;
  const float CARD_LEFT = 620.0 / 2160.0;
  const float CARD_RIGHT = 1540.0 / 2160.0;
  const float CARD_FEATHER_V = 0.022;
  const float CARD_FEATHER_U = 0.05;
  const float CARD_KEEP_OUT = 0.94;
  uniform float uFrostFilmTiling;
  uniform float uFrostFilmSpan;
  uniform float uFrostFilmSpanY;
  uniform float uFrostFilmNoiseCoarse;
  uniform float uFrostFilmNoiseMid;
  uniform float uFrostFilmNoiseFine;
  uniform float uFrostFilmInner;
  uniform float uFrostFilmOuter;
  uniform float uFrostFilmLift;
  uniform float uFrostFilmGain;
  uniform float uFrostFilmRefraction;

  /* Straight-alpha blend of fg over bg, as the reference's blend(). */
  vec4 blend(vec4 bg, vec4 fg) {
    vec3 bgm = bg.rgb * bg.a;
    vec3 fgm = fg.rgb * fg.a;
    float ia = 1.0 - fg.a;
    float a = fg.a + (bg.a * ia);
    if (a == 0.0) return vec4(0.0);
    return vec4((fgm + (bgm * ia)) / a, a);
  }

  vec2 pixel() {
    return vec2(1.0) / uResolution;
  }

  /*
   * Tiled lookup into the noise map, used by the fog and steam layers.
   *
   * fract() rather than relying on the texture's wrap mode: a drifting
   * coordinate leaves 0..1 constantly, and if the sampler ends up clamping
   * instead of repeating, the last texel column smears into a hard vertical band
   * that slides across the panel. The map is generated periodic over exactly one
   * UV span, so wrapping by hand is seamless, and with no mipmaps the derivative
   * discontinuity fract() introduces costs nothing.
   */
  float tiledNoise(vec2 coord) {
    return texture2D(uNoiseMap, fract(coord)).b;
  }

  /* As above, screen uv has y=1 at the top, so the card's downward measurements flip. */
  float cardClearance(vec2 uv) {
    float top = 1.0 - CARD_TOP;
    float bottom = 1.0 - CARD_BOTTOM;
    float overCard =
      smoothstep(bottom - CARD_FEATHER_V, bottom, uv.y) *
      (1.0 - smoothstep(top, top + CARD_FEATHER_V, uv.y)) *
      smoothstep(CARD_LEFT - CARD_FEATHER_U, CARD_LEFT, uv.x) *
      (1.0 - smoothstep(CARD_RIGHT, CARD_RIGHT + CARD_FEATHER_U, uv.x));

    return 1.0 - (overCard * CARD_KEEP_OUT);
  }

  /* PNG preserves RGB below fully transparent texels, while the old generated
     canvas discarded those hidden channels. Keep packed growth=0 genuinely absent
     before applying the near-zero full-freeze exponent, otherwise those preserved
     thickness values incorrectly reappear as ice across the centre. */
  float frostGrowthAt(float packedGrowth) {
    float hasGrowth = step(0.5 / 255.0, packedGrowth);
    float exponent = max(0.001, FREEZE_STEEPNESS - (uFrost * FREEZE_STEEPNESS));
    return hasGrowth * pow(max(packedGrowth, 1.0 / 255.0), exponent);
  }


  /*
   * The Codrops water pass, shared by the rain and the frost.
   *
   * Both are normal maps packed the same way, so both get the same treatment: the
   * coverage alpha is sharpened into a crisp lens edge, the frame is sampled
   * through a pixel-space offset along the refraction vector, the drop-shine
   * texture is blended in from that vector, and a soft shadow is taken from the
   * map sampled slightly higher. Running frost through a separate technique is
   * what made it read as a different material.
   *
   * @param refraction  map .gr — x from green, y from red, as the original packs it
   * @param thickness   map .b, scaling how far this pixel refracts
   * @param rawAlpha    coverage before sharpening
   * @param shadowRaw   coverage sampled above, for the drop shadow
   * @param weight      0..1 amount of this layer
   */
  vec4 glassLayer(
    vec2 uv,
    vec2 refractionRaw,
    float thickness,
    float rawAlpha,
    float shadowRaw,
    float weight,
    float refractionScale,
    vec3 tint,
    float tintStrength,
    float lift
  ) {
    float a = clamp((rawAlpha * ALPHA_MULTIPLY) - ALPHA_SUBTRACT, 0.0, 1.0) * weight;
    if (a <= 0.0) return vec4(0.0);

    vec2 refraction = (refractionRaw - 0.5) * 2.0;
    vec2 refractionPos = uv +
      (pixel() * refraction * refractionScale * (MIN_REFRACTION + (thickness * REFRACTION_DELTA)));
    vec4 tex = vec4(texture2D(uTextureFg, clamp(refractionPos, vec2(0.0), vec2(1.0))).rgb, 1.0);

    if (RENDER_SHINE) {
      float maxShine = 490.0;
      float minShine = maxShine * 0.18;
      vec2 shinePos = vec2(0.5) +
        (((1.0 / 512.0) * refraction) * -(minShine + ((maxShine - minShine) * thickness)));
      tex = blend(tex, texture2D(uShine, shinePos));
    }

    /* This footage is a smooth grey gradient, so refraction alone reveals almost
       nothing — a lens needs detail behind it, which the reference gets from a
       photograph. The surface's own shading does the work instead: a fresnel-style
       rim where it turns away from the viewer, plus a tight specular. */
    float slope = clamp(length(refraction), 0.0, 1.0);
    float rim = pow(slope, 2.2);
    float specular = pow(clamp(dot(normalize(vec3(refraction, 0.85)), normalize(vec3(-0.45, -0.6, 0.66))), 0.0, 1.0), 16.0);
    tex.rgb = mix(tex.rgb, tex.rgb * 0.72, rim * 0.55);
    tex.rgb += vec3(specular * 0.8) + vec3(rim * 0.12);

    /* Tint multiplies rather than mixes toward a flat colour: glass colours what
       you see *through* it, so the refracted detail has to survive. A white tint is
       therefore a genuine no-op at any strength. */
    tex.rgb = mix(tex.rgb, tex.rgb * tint, tintStrength);
    /* A flat brightness lift, so a layer can be made to read against dark footage
       without having to push its coverage up. */
    tex.rgb += vec3(lift);

    vec4 fg = vec4(tex.rgb * BRIGHTNESS, a);

    if (RENDER_SHADOW) {
      float borderAlpha = clamp((shadowRaw * ALPHA_MULTIPLY) - (ALPHA_SUBTRACT + 0.5), 0.0, 1.0);
      fg = blend(vec4(0.0, 0.0, 0.0, borderAlpha * 0.42 * weight), fg);
    }

    return fg;
  }

  void main() {
    vec2 uv = vUv;
    float frostContentHeight = 1.0 - FROST_TOP_INSET;
    vec2 frostUv = vec2(uv.x, clamp(uv.y / frostContentHeight, 0.0, 1.0));
    float frostAspect = uResolution.y / max(1.0, uResolution.x);
    vec2 frostNoiseUv = vec2(uv.x, uv.y * frostAspect);
    float frostTopDistance = max(0.0, (1.0 - uv.y) - FROST_TOP_INSET);

    /* ---- Backdrop ----
       Fully transparent: the untouched video plays through underneath, and this
       pass only ever adds to it. */
    vec4 bg = vec4(0.0);

    /* ---- Glass layers ----
       Rain and frost both go through glassLayer() below: the same refraction, the
       same shine lookup, the same shadow. Only the map differs. */
    vec4 waterMap = texture2D(uWaterMap, uv);
    float waterShadow = texture2D(uWaterMap, uv - vec2(0.0, (waterMap.b * 6.0) * pixel().y)).a;
    vec4 fg = glassLayer(
      uv, waterMap.gr, waterMap.b, waterMap.a, waterShadow, uWater,
      1.0, vec3(1.0), 0.0, 0.0
    );

    vec4 color = blend(bg, fg);

    /* ---- Frost ----
       Exactly the same glass pass as the drops above. The only frost-specific
       step is turning the map's growth-order alpha into coverage for the current
       amount, using the progression curve from the freezing-screen technique.

       Zero-growth texels are rejected first; nonzero pow arguments stay strictly
       positive because the full-frost exponent approaches zero and pow(0.0, 0.0)
       is undefined in GLSL. */
    vec4 frostMap = texture2D(uFrostMap, frostUv);
    float frostGrowth = frostGrowthAt(frostMap.a);
    /* Thickness gates coverage, so the crystal structure decides where ice is,
       and the growth curve decides how far in it has reached. */
    float frostCoverage = frostMap.b * frostGrowth * FROST_COVERAGE_GAIN;

    /*
     * Softens the ice out toward its inner boundary.
     *
     * The shared pass sharpens coverage to a hard 0 or 1, which is what gives a
     * drop its crisp lens edge — but it also means frost would end abruptly
     * wherever the band runs out. Feeding a per-pixel weight instead of a flat
     * amount reintroduces translucency at the frontier, so the ice thins out as it
     * reaches inward. Physically apt as well: thin ice is more transparent.
     */
    /* The fade is eroded by noise at three scales rather than being a smooth ramp.
       A plain gradient reads as a soft airbrushed edge; perturbing the threshold
       instead breaks the frontier into lobes, lace and finally speckle, so the ice
       retreats the way real ice does — unevenly, leaving islands behind. The
       coarsest term moves the boundary in bulk, the middle one shreds it, and the
       fine map's needles give the last of it a crystalline edge. */
    float fadeErosion = FROST_EDGE_EROSION * (
      ((tiledNoise(frostNoiseUv * 2.3) - 0.5) * 0.34) +
      ((tiledNoise(frostNoiseUv * 6.7) - 0.5) * 0.18) +
      ((texture2D(uFrostFineMap, fract(uv * FROST_FINE_TILING * 2.1)).a - 0.5) * 0.13)
    );
    float frostFade = uFrost *
      smoothstep(FROST_EDGE_FADE * 0.12, FROST_EDGE_FADE, frostMap.a + fadeErosion);

    vec4 frostShadowMap = texture2D(
      uFrostMap,
      frostUv - vec2(0.0, (frostMap.b * 6.0) * pixel().y)
    );
    float frostShadow = frostShadowMap.b *
      frostGrowthAt(frostShadowMap.a) *
      FROST_COVERAGE_GAIN;

    /* ---- Fine frost, under the main crystals ----
       A denser, finer crust that hugs the very edge of the panel. Its detail is
       the same map sampled at a higher tiling — the map is generated tileable, so
       this costs one extra fetch and no extra memory — while its growth order is
       read from the UNTILED sample, so the vignette stays screen-aligned instead
       of repeating along with the crystals.

       Raising the growth term to a power biases this layer far closer to the
       border than the main ice, which is what makes it read as a second stratum
       underneath rather than more of the same. Drawn before the main layer so it
       sits under it. */
    vec4 fineMap = texture2D(uFrostFineMap, fract(uv * FROST_FINE_TILING));
    float fineEdge = pow(max(frostMap.a, 0.0001), FROST_FINE_EDGE_BIAS);
    float fineCoverage = fineMap.a * fineEdge * frostGrowth * FROST_FINE_GAIN;
    float fineShadow = texture2D(
      uFrostFineMap,
      fract((uv * FROST_FINE_TILING) - vec2(0.0, (fineMap.b * 6.0) * pixel().y))
    ).a * fineEdge * frostGrowth * FROST_FINE_GAIN;

    /* ---- Bead film, beneath everything ----
       A dense static speckle of micro-beads: the character of the rain's
       non-animating droplet layer, acting as the base the crystals grow on.

       Its placement is INDEPENDENT of the ice in every term. That took three goes to
       get right, and each failure looked the same from the outside — beads only ever
       appearing where ice already was:
         1. its extent was a power of the ice's growth map, which hard-zeros in the
            centre, so it could not reach past the ice;
         2. its coverage still multiplied that growth term;
         3. its WEIGHT was still the ice's own edge fade, which gates the final
            alpha — so even with its own vignette driving coverage, the fade
            multiplied the result back down to nothing outside the ice.
       Now the bead texture alone decides coverage, and the film's own vignette
       alone decides where it sits. The only thing it shares with the ice is uFrost,
       the timeline amount. */
    vec4 filmMap = texture2D(uFrostFilmMap, fract(uv * uFrostFilmTiling));
    vec2 filmToEdge = vec2(
      min(uv.x, 1.0 - uv.x),
      min(uv.y, frostTopDistance)
    ) * vec2(1.0, frostAspect);
    /* The frontier is perturbed by noise of the film's OWN — three scales, at
       frequencies and offsets that share nothing with the ice's erosion field. When
       both layers were shaped by the same noise their boundaries coincided exactly
       and the beads read as more of the ice; offsetting them lets the two frontiers
       interlock, each leaving islands where the other has none. */
    float filmNoise =
      ((tiledNoise((frostNoiseUv * 1.3) + vec2(0.37, 0.81)) - 0.5) * uFrostFilmNoiseCoarse) +
      ((tiledNoise((frostNoiseUv * 4.7) + vec2(0.11, 0.53)) - 0.5) * uFrostFilmNoiseMid) +
      ((texture2D(uFrostFineMap, fract((uv * 6.3) + vec2(0.2, 0.4))).a - 0.5) * uFrostFilmNoiseFine);
    /* The horizontal band GATES the film. The centre column of the stage carries the
       card, the masthead and the cube from top to bottom, so the beads may not cross
       it at any height — a union of the two axes let them run right across the top
       and bottom bands and over the copy. The vertical band only thickens the
       columns toward the top and bottom, where the ice is heaviest. */
    float filmBandX = 1.0 - smoothstep(0.0, uFrostFilmSpan, filmToEdge.x + filmNoise);
    float filmBandY = 1.0 - smoothstep(0.0, uFrostFilmSpanY, filmToEdge.y + filmNoise);
    float filmSpan = min(1.0, filmBandX * (1.0 + (FROST_FILM_CORNER_BIAS * filmBandY)));
    /* Beads leave the way the ice does, rather than dimming uniformly. Two parts,
       both borrowed from the crystals:
         - the same progression curve, so as the amount drops the field retreats
           toward the border instead of fading in place;
         - the same multi-scale erosion on the threshold, so the retreating frontier
           breaks into lobes, lace and speckle. */
    float filmGrowth = pow(
      max(filmSpan, 0.0001),
      max(0.001, FREEZE_STEEPNESS - (uFrost * FREEZE_STEEPNESS))
    );
    /* Erosion on the threshold, again on the film's own noise rather than the ice's,
       and applied multiplicatively rather than added as the ice does it. Added, it
       lifted the mask over the threshold in the clear centre too — roughly half of any
       noise field is positive — which scattered stray beads across the middle of the
       screen and over the copy. Scaled by the mask it can only shove a frontier that
       already exists: zero stays zero, and the lobes and lace survive. */
    float filmErosion =
      ((tiledNoise((frostNoiseUv * 2.6) + vec2(0.63, 0.29)) - 0.5) * 1.05) +
      ((tiledNoise((frostNoiseUv * 7.9) + vec2(0.85, 0.17)) - 0.5) * 0.55) +
      ((texture2D(uFrostFineMap, fract((uv * 3.7) + vec2(0.71, 0.05))).a - 0.5) * 0.4);
    float filmEdge = smoothstep(
      uFrostFilmInner,
      uFrostFilmOuter,
      filmSpan * (1.0 + filmErosion)
    ) * filmGrowth;
    /* Coverage is the bead shapes only — no spatial term, or the sharpening below
       would clip the vignette's soft falloff into a hard ring. */
    float filmCoverage = filmMap.a * uFrostFilmGain;
    float filmShadow = texture2D(
      uFrostFilmMap,
      fract((uv * uFrostFilmTiling) - vec2(0.0, (filmMap.b * 6.0) * pixel().y))
    ).a * uFrostFilmGain;
    /* The vignette rides on the weight instead, which multiplies the final alpha
       linearly and so fades smoothly. */
    float filmWeight = uFrost * filmEdge;


    color = blend(color, glassLayer(
      uv,
      filmMap.gr,
      filmMap.b,
      filmCoverage,
      filmShadow,
      filmWeight,
      uFrostFilmRefraction,
      FROST_TINT,
      FROST_TINT_STRENGTH,
      uFrostFilmLift
    ));

    color = blend(color, glassLayer(
      uv,
      fineMap.gr,
      fineMap.b,
      fineCoverage,
      fineShadow,
      frostFade,
      FROST_REFRACTION,
      FROST_TINT,
      FROST_TINT_STRENGTH,
      0.0
    ));

    color = blend(color, glassLayer(
      uv,
      frostMap.gr,
      frostMap.b,
      frostCoverage,
      frostShadow,
      frostFade,
      FROST_REFRACTION,
      FROST_TINT,
      FROST_TINT_STRENGTH,
      0.0
    ));

    /* ---- White bloom, tight to the edge of the screen ----
       Where frost is thickest it stops behaving like a lens: the crystal mass scatters
       so much that it simply goes opaque white. So this layer refracts nothing — it is
       a faded solid white on its own noise, banded close to the border.

       The patch SIZE grows toward the edge, which is what makes it read as depth of
       frost rather than a wash: the threshold the noise has to clear falls as the band
       strengthens, so out at the very border almost all of the field passes and the
       white runs together, while further in only the peaks get through and it breaks
       into flecks. */
    vec2 bloomToEdgePx = vec2(
      min(uv.x, 1.0 - uv.x),
      min(uv.y, frostTopDistance)
    ) * vec2(1.0, frostAspect);
    float bloomToEdge = min(bloomToEdgePx.x, bloomToEdgePx.y);
    float bloomEdgeNoise =
      ((tiledNoise((frostNoiseUv * 1.7) + vec2(0.29, 0.73)) - 0.5) * FROST_BLOOM_NOISE_COARSE) +
      ((tiledNoise((frostNoiseUv * 5.1) + vec2(0.61, 0.19)) - 0.5) * FROST_BLOOM_NOISE_MID);
    float bloomBand = 1.0 - smoothstep(
      0.0,
      FROST_BLOOM_SPAN,
      bloomToEdge + bloomEdgeNoise
    );
    float bloomField = mix(
      tiledNoise((frostNoiseUv * 2.3) + vec2(0.13, 0.47)),
      tiledNoise((frostNoiseUv * 6.9) + vec2(0.83, 0.35)),
      0.4
    );
    float bloomThreshold = 1.0 - bloomBand;
    float bloomPatch = smoothstep(
      bloomThreshold,
      bloomThreshold + FROST_BLOOM_SOFTNESS,
      bloomField
    );
    /* Recedes on the same progression curve as the crystals and the beads, so all
       three retreat toward the border together instead of dimming in place. */
    float bloomGrowth = pow(
      max(bloomBand, 0.0001),
      max(0.001, FREEZE_STEEPNESS - (uFrost * FREEZE_STEEPNESS))
    );
    /* Falloff on top of the patch threshold. Without it the white is flat across the
       whole band and stops at the noise frontier; raising the band to a power gives it
       a long inward decay, so it is solid at the border and dissolves as it comes in. */
    float bloomAlpha = bloomPatch * pow(bloomBand, FROST_BLOOM_FALLOFF) *
      bloomGrowth * uFrost * FROST_BLOOM_ALPHA * cardClearance(uv);
    color = blend(color, vec4(vec3(1.0), bloomAlpha));

    /* ---- Fog / steam ----
       Structure borrowed from the noise map, scrolled in two directions so the
       billows never read as a flat wash. The enlarged fields stop at 0.62 on purpose:
       sampling much lower magnifies the 512px map enormously, bilinear
       magnification resolves into straight-edged facets, and a tight contrast
       stretch on top of that amplifies those facet edges into visible straight
       lines drifting across the panel.

       This is the billowing field the intro used to carry. It was keyed to the FROST
       weight back then, which put smoke on the very first frame once the scene began
       opening fully frozen — so it moved here, to the step it actually belongs to.
       Contrast-stretched rather than left raw: without the stretch it reads as a flat
       grey wash instead of smoke with defined billows. */
    /* Two independently drifting noise samples form a non-periodic flow vector.
       Warping through that field creates irregular folds and rolling pockets,
       avoiding the rhythmic sine bands that made the previous pass read as water. */
    float steamWarpX = tiledNoise(
      (uv * 0.86) + vec2(uTime * 0.011, uTime * -0.026)
    ) - 0.5;
    float steamWarpY = tiledNoise(
      (uv * 0.94) + vec2(uTime * -0.014, uTime * -0.019) + vec2(0.41, 0.67)
    ) - 0.5;
    vec2 steamFlow = vec2(steamWarpX, steamWarpY);
    vec2 steamUvA = uv + vec2(
      (steamFlow.x * 0.19) + (steamFlow.y * 0.07),
      steamFlow.y * 0.065
    );
    vec2 steamUvB = uv + vec2(
      (-steamFlow.y * 0.17) + (steamFlow.x * 0.055),
      (-steamFlow.x * 0.06) + (steamFlow.y * 0.02)
    );
    float steamA = tiledNoise((steamUvA * 0.9) + vec2(uTime * 0.04, uTime * -0.024));
    float steamB = tiledNoise((steamUvB * 0.62) + vec2(uTime * -0.029, uTime * -0.043));
    float steamCurl = tiledNoise(
      (((steamUvA + steamUvB) * 0.5) * 1.55) +
      vec2(uTime * 0.018, uTime * -0.072)
    );
    float steamBody = (steamA * 0.48) + (steamB * 0.37) + (steamCurl * 0.15);
    float steamField = smoothstep(0.04, 0.82, steamBody);

    /* Mostly field, with a small flat base so full gas still veils the thin gaps
       between billows. The blur that goes with it lives on the video element so the
       shader remains a transparent effect layer. */
    color = blend(color, vec4(
      1.0,
      1.0,
      1.0,
      uGas * GAS_SMOKE_ALPHA * (0.2 + (0.8 * steamField))
    ));

    /* Straight alpha, so wherever no effect lands the video shows through
       completely untouched. */
    gl_FragColor = color;
  }
`

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Could not load ${source}`))
    image.src = assetUrl(source)
  })
}

/**
 * Mounts the screen shader.
 *
 * @param {HTMLCanvasElement} canvas the effect canvas, below the chrome
 * @param {object} options
 * @param {HTMLElement} options.element the module root, for CSS-scale lookup
 * @param {HTMLVideoElement} options.video the scrub video, the scene source
 * @returns {Promise<object|null>} controller, or null if WebGL is unavailable
 */
export async function mountStateShader(canvas, { element, video } = {}) {
  if (!canvas) return null

  const [
    THREE,
    dropAlpha,
    dropColor,
    dropShine,
    noiseMap,
    frostMap,
    frostFineMap,
    frostFilmMap
  ] = await Promise.all([
    import('three'),
    loadImage(DROP_ALPHA_ASSET),
    loadImage(DROP_COLOR_ASSET),
    loadImage(DROP_SHINE_ASSET),
    loadImage(NOISE_MAP_ASSET),
    loadImage(FROST_MAP_ASSET),
    loadImage(FROST_FINE_MAP_ASSET),
    loadImage(FROST_FILM_MAP_ASSET)
  ])

  const rain = createRainDrops({
    width: WATER_MAP_WIDTH,
    height: WATER_MAP_HEIGHT,
    dropAlpha,
    dropColor,
    options: RAIN_OPTIONS
  })
  if (!noiseMap || !frostMap || !frostFineMap || !frostFilmMap || !rain) return null

  /* Copy of the current video frame, off-DOM, used only as a texture source for
     the frost and drops to refract. */
  const sceneCanvas = document.createElement('canvas')
  sceneCanvas.width = SCENE_SOURCE_WIDTH
  sceneCanvas.height = SCENE_SOURCE_HEIGHT

  let rendererLease = null
  let renderer = null
  try {
    rendererLease = leaseWebGLRenderer(THREE, {
      alpha: true,
      antialias: false,
      /* The shader emits straight (non-premultiplied) alpha. */
      premultipliedAlpha: false
    })
    renderer = rendererLease.renderer
    const rendererCanvas = renderer.domElement
    for (const attribute of rendererCanvas.getAttributeNames()) {
      rendererCanvas.removeAttribute(attribute)
    }
    for (const attribute of canvas.attributes) {
      rendererCanvas.setAttribute(attribute.name, attribute.value)
    }
    canvas.replaceWith(rendererCanvas)
    canvas = rendererCanvas
  } catch {
    rendererLease?.release()
    /* No WebGL — the module still works, just without the effect layer. */
    return null
  }

  renderer.setClearColor(0x000000, 0)

  /*
   * Every texture is sampled raw.
   *
   * three only appends its output colour-space conversion to its own materials,
   * never to a bare ShaderMaterial — so tagging these as sRGB would decode them
   * to linear on sample with nothing re-encoding them on write, and the whole
   * panel would come out markedly dark. This pass is a 2D compositor: raw in,
   * raw out, and the round-trip is exact. The normal and density maps need the
   * same treatment anyway, or their decoded vectors would be skewed.
   */
  const makeTexture = source => {
    const texture = new THREE.Texture(source)
    texture.colorSpace = THREE.NoColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    texture.needsUpdate = true
    return texture
  }

  const sceneTexture = makeTexture(sceneCanvas)
  const shineTexture = makeTexture(dropShine)
  const waterTexture = makeTexture(rain.canvas)
  const frostTexture = makeTexture(frostMap)
  const frostFineTexture = makeTexture(frostFineMap)
  frostFineTexture.wrapS = THREE.RepeatWrapping
  frostFineTexture.wrapT = THREE.RepeatWrapping
  const frostFilmTexture = makeTexture(frostFilmMap)
  frostFilmTexture.wrapS = THREE.RepeatWrapping
  frostFilmTexture.wrapT = THREE.RepeatWrapping
  const noiseTexture = makeTexture(noiseMap)
  noiseTexture.wrapS = THREE.RepeatWrapping
  noiseTexture.wrapT = THREE.RepeatWrapping

  const uniforms = {
    uTextureFg: { value: sceneTexture },
    uWaterMap: { value: waterTexture },
    uShine: { value: shineTexture },
    uFrostMap: { value: frostTexture },
    uFrostFineMap: { value: frostFineTexture },
    uFrostFilmMap: { value: frostFilmTexture },
    uNoiseMap: { value: noiseTexture },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uFrost: { value: 1 },
    ...Object.fromEntries(
      Object.entries(BEAD_UNIFORMS).map(([name, value]) => [name, { value }])
    ),
    uWater: { value: 0 },
    uGas: { value: 0 },
    uTime: { value: 0 }
  }

  const scene = new THREE.Scene()
  const camera = new THREE.Camera()
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthTest: false,
    depthWrite: false
  })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  quad.frustumCulled = false
  scene.add(quad)

  let disposed = false
  let animationFrame = 0
  let lastFrameAt = 0
  let startedAt = 0
  /* Nothing is drawn until a real video frame has landed, otherwise the panel
     would flash black. sceneNeedsUpload starts true so the first frame always
     arrives even if no seek ever commits (seeking to the frame the video is
     already parked on fires no `seeked` event), and markSceneDirty re-arms it. */
  let sceneReady = false
  let sceneNeedsUpload = true

  const resize = () => {
    if (disposed) return
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width < 2 || height < 2) return

    renderer.setPixelRatio(calculateStageAwarePixelRatio({
      width,
      height,
      cssScale: element ? elementCssScale(element) : 1,
      devicePixelRatio: window.devicePixelRatio || 1,
      maxRenderPixels: MAX_RENDER_PIXELS
    }))
    renderer.setSize(width, height, false)
    uniforms.uResolution.value.set(renderer.domElement.width, renderer.domElement.height)
    canvas.style.width = '100%'
    canvas.style.height = '100%'
  }

  const render = now => {
    if (disposed) return
    animationFrame = window.requestAnimationFrame(render)

    if (now - lastFrameAt < FRAME_INTERVAL_MS) return
    const delta = lastFrameAt === 0 ? 0 : (now - lastFrameAt) / 1000
    lastFrameAt = now
    if (startedAt === 0) startedAt = now
    uniforms.uTime.value = (now - startedAt) / 1000

    /* The video is scrubbed, not played, so its frame only changes when a seek
       commits — re-blitting every render would cost far more than it buys. */
    if (sceneNeedsUpload && drawVideoFrameToCanvas(video, sceneCanvas)) {
      sceneTexture.needsUpdate = true
      sceneReady = true
      sceneNeedsUpload = false
    }
    if (!sceneReady) return

    rain.update(delta, uniforms.uWater.value)
    waterTexture.needsUpdate = true

    renderer.render(scene, camera)
  }

  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(canvas)
  window.addEventListener('resize', resize)
  resize()
  animationFrame = window.requestAnimationFrame(render)

  return {
    /** Weights come straight from the timeline's vfx block. */
    setWeights({ frost = 0, condensation = 0, fog = 0 } = {}) {
      uniforms.uFrost.value = Math.min(1, Math.max(0, frost))
      uniforms.uWater.value = Math.min(1, Math.max(0, condensation))
      uniforms.uGas.value = Math.min(1, Math.max(0, fog))
    },
    /** Called when a seek commits a new frame, re-arming the scene copies. */
    markSceneDirty() {
      sceneNeedsUpload = true
    },
    dispose() {
      if (disposed) return
      disposed = true
      window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      window.removeEventListener('resize', resize)
      rain.dispose()
      quad.geometry.dispose()
      material.dispose()
      sceneTexture.dispose()
      shineTexture.dispose()
      waterTexture.dispose()
      frostTexture.dispose()
      frostFineTexture.dispose()
      frostFilmTexture.dispose()
      noiseTexture.dispose()
      rendererLease.release()
    }
  }
}
