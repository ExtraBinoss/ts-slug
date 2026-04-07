import * as THREE from "three";
import type {
  SlugInjectionOptions,
  SlugMaterialParameters,
  SlugShaderEffect,
} from "./types";

const slug_pars_fragment = `
precision highp int;
precision highp usampler2D;

in vec2 vTexCoords;
flat in vec4 vGlyphBandScale;
flat in uvec4 vBandMaxTexCoords;
flat in vec4 vGlyphColor;
flat in vec4 vGlyphParams;
flat in float vGlyphInstance;

uniform sampler2D curvesTex;
uniform usampler2D bandsTex;

const float epsilon = 0.0001;

#define glyphScale     vGlyphBandScale.xy
#define bandScale      vGlyphBandScale.zw
#define bandMax        vBandMaxTexCoords.xy
#define bandsTexCoords vBandMaxTexCoords.zw

float TraceRayCurveH(vec2 p1, vec2 p2, vec2 p3, float pixelsPerEm)
{
    if(max(max(p1.x, p2.x), p3.x) * pixelsPerEm < -0.5)
    {
        return 0.0;
    }

    uint code = (0x2E74U >> (((p1.y > 0.0) ? 2U : 0U) + ((p2.y > 0.0) ? 4U : 0U) + ((p3.y > 0.0) ? 8U : 0U))) & 3U;
    if(code == 0U)
    {
        return 0.0;
    }

    vec2 a = p1 - p2 * 2.0 + p3;
    vec2 b = p1 - p2;
    float c = p1.y;
    float ayr = 1.0 / a.y;
    float d = sqrt(max(b.y * b.y - a.y * c, 0.0));
    float t1 = (b.y - d) * ayr;
    float t2 = (b.y + d) * ayr;

    if(abs(a.y) < epsilon)
    {
        t1 = t2 = c / (2.0 * b.y);
    }

    float coverage = 0.0;

    if((code & 1U) != 0U)
    {
        float x1 = (a.x * t1 - b.x * 2.0) * t1 + p1.x;
        float cov_c = clamp(x1 * pixelsPerEm + 0.5, 0.0, 1.0);
        coverage += cov_c;
    }

    if(code > 1U)
    {
        float x2 = (a.x * t2 - b.x * 2.0) * t2 + p1.x;
        float cov_c = clamp(x2 * pixelsPerEm + 0.5, 0.0, 1.0);
        coverage -= cov_c;
    }

    return coverage;
}

float TraceRayBandH(uvec2 bandData, float pixelsPerEm)
{
    float coverage = 0.0;
    for(uint curve = 0U; curve < bandData.x; ++curve)
    {
        uint curveOffset = bandData.y + curve;
        ivec2 curveLoc = ivec2(texelFetch(bandsTex, ivec2(curveOffset & 0xFFFU, curveOffset >> 12U), 0).xy);
        vec4 p12 = texelFetch(curvesTex, curveLoc, 0) / vec4(glyphScale, glyphScale) - vec4(vTexCoords, vTexCoords);
        vec2 p3 = texelFetch(curvesTex, ivec2(curveLoc.x + 1, curveLoc.y), 0).xy / glyphScale - vTexCoords;
        coverage += TraceRayCurveH(p12.xy, p12.zw, p3.xy, pixelsPerEm);
    }
    return coverage;
}

float TraceRayBandV(uvec2 bandData, float pixelsPerEm)
{
    float coverage = 0.0;
    for(uint curve = 0U; curve < bandData.x; ++curve)
    {
        uint curveOffset = bandData.y + curve;
        ivec2 curveLoc = ivec2(texelFetch(bandsTex, ivec2(curveOffset & 0xFFFU, curveOffset >> 12U), 0).xy);
        vec4 p12 = texelFetch(curvesTex, curveLoc, 0) / vec4(glyphScale, glyphScale) - vec4(vTexCoords, vTexCoords);
        vec2 p3 = texelFetch(curvesTex, ivec2(curveLoc.x + 1, curveLoc.y), 0).xy / glyphScale - vTexCoords;
        coverage += TraceRayCurveH(p12.yx, p12.wz, p3.yx, pixelsPerEm);
    }
    return coverage;
}

vec3 rainbowColor(float phase)
{
  return 0.5 + 0.5 * cos(6.2831853 * (phase + vec3(0.0, 0.33, 0.67)));
}
`;

const slug_fragment_core = `
    vec2 fdx = dFdx(vTexCoords);
    vec2 fdy = dFdy(vTexCoords);
    vec2 fw = max(max(abs(fdx), abs(fdy)), vec2(0.000001));
    vec2 pixelsPerEm = vec2(1.0 / fw.x, 1.0 / fw.y);

    pixelsPerEm = clamp(pixelsPerEm, vec2(1.0), vec2(200.0));

    uvec2 bandIndex = uvec2(clamp(uvec2(vTexCoords * bandScale), uvec2(0U, 0U), bandMax));

    uint hBandOffset = bandsTexCoords.y * 4096U + bandsTexCoords.x + bandIndex.y;
    uvec2 hBandData = texelFetch(bandsTex, ivec2(hBandOffset & 0xFFFU, hBandOffset >> 12U), 0).xy;

    uint vBandOffset = bandsTexCoords.y * 4096U + bandsTexCoords.x + bandMax.y + 1U + bandIndex.x;
    uvec2 vBandData = texelFetch(bandsTex, ivec2(vBandOffset & 0xFFFU, vBandOffset >> 12U), 0).xy;

    float coverageX = TraceRayBandH(hBandData, pixelsPerEm.x);
    float coverageY = TraceRayBandV(vBandData, pixelsPerEm.y);

    coverageX = min(abs(coverageX), 1.0);
    coverageY = min(abs(coverageY), 1.0);
    float slugAlpha = (coverageX + coverageY) * 0.5;
`;

const slug_fragment_standard =
  slug_fragment_core +
  `
    vec3 effectColor = mix(vGlyphColor.rgb, rainbowColor(vGlyphParams.x + uSlugTime * 0.25), clamp(vGlyphParams.w, 0.0, 1.0));
    diffuseColor.rgb *= effectColor;
    diffuseColor.a *= vGlyphColor.a;
    diffuseColor.a *= slugAlpha;
    if ( diffuseColor.a < 0.0001 ) discard;
`;

const slug_pars_vertex = `
in vec4 aScaleBias;
in vec4 aGlyphBandScale;
in vec4 aBandMaxTexCoords;
in vec4 aGlyphColor;
in vec4 aGlyphParams;

out vec2 vTexCoords;
flat out vec4 vGlyphBandScale;
flat out uvec4 vBandMaxTexCoords;
flat out vec4 vGlyphColor;
flat out vec4 vGlyphParams;
flat out float vGlyphInstance;
`;

const slug_vertex = `
    vec3 transformed = vec3( position.xy * aScaleBias.xy + aScaleBias.zw, 0.0 );
    vTexCoords = position.xy * 0.5 + 0.5;

  float waveSeed = aGlyphParams.x + float(gl_InstanceID) * 0.021;
  float waveOffset = sin((waveSeed + uSlugTime * 2.0) * max(aGlyphParams.y, 0.0001)) * aGlyphParams.z;
  transformed.y += waveOffset;
    
    #ifdef SLUG_MODELSPACE_UV
    #ifdef USE_UV
    vUv = transformed.xy;
    #endif
    #ifdef USE_MAP
    vMapUv = ( mapTransform * vec3( vec2(length(modelMatrix[0].xyz)*transformed.x,length(modelMatrix[2].xyz)*transformed.y), 1.0 ) ).xy;
    #endif
    #endif

    vGlyphBandScale = aGlyphBandScale;
    vBandMaxTexCoords = uvec4(aBandMaxTexCoords);
    vGlyphColor = aGlyphColor;
    vGlyphParams = aGlyphParams;
    vGlyphInstance = float(gl_InstanceID);
`;

function buildEffectUniforms(
  effects: SlugShaderEffect[],
): Record<string, THREE.IUniform> {
  const uniforms: Record<string, THREE.IUniform> = {};

  for (const effect of effects) {
    if (!effect.uniforms) continue;
    for (const [name, uniform] of Object.entries(effect.uniforms)) {
      if (uniform && typeof uniform === "object" && "value" in uniform) {
        uniforms[name] = uniform as THREE.IUniform;
      } else {
        uniforms[name] = { value: uniform };
      }
    }
  }

  return uniforms;
}

function buildEffectSnippet(
  effects: SlugShaderEffect[],
  key: "vertex" | "fragment",
): string {
  return effects
    .map((effect) => effect[key]?.trim())
    .filter((snippet): snippet is string => Boolean(snippet))
    .join("\n");
}

function glslTypeFromUniformValue(value: unknown): string {
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return "float";
  if (Array.isArray(value)) {
    if (value.length === 2) return "vec2";
    if (value.length === 3) return "vec3";
    if (value.length === 4) return "vec4";
  }
  return "float";
}

function buildEffectUniformDeclarations(effects: SlugShaderEffect[]): string {
  const declarations = new Map<string, string>();

  for (const effect of effects) {
    if (!effect.uniforms) continue;
    for (const [name, uniform] of Object.entries(effect.uniforms)) {
      const value =
        uniform && typeof uniform === "object" && "value" in uniform
          ? (uniform as { value: unknown }).value
          : uniform;
      declarations.set(name, glslTypeFromUniformValue(value));
    }
  }

  declarations.set("uSlugTime", "float");

  return Array.from(declarations.entries())
    .map(([name, type]) => `uniform ${type} ${name};`)
    .join("\n");
}

function applyStandardMaterialEffects(
  shader: any,
  effects: SlugShaderEffect[],
): void {
  const vertexSnippet = buildEffectSnippet(effects, "vertex");
  const fragmentSnippet = buildEffectSnippet(effects, "fragment");

  if (Object.keys(buildEffectUniforms(effects)).length > 0) {
    shader.uniforms = {
      ...shader.uniforms,
      ...buildEffectUniforms(effects),
    };
  }

  shader.vertexShader = shader.vertexShader.replace(
    "#include <begin_vertex>",
    vertexSnippet ? `${slug_vertex}\n${vertexSnippet}` : slug_vertex,
  );

  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <alphatest_fragment>",
    `${slug_fragment_standard}${fragmentSnippet ? `\n${fragmentSnippet}` : ""}\n#include <alphatest_fragment>`,
  );
}

export function injectSlug(
  target: THREE.Mesh,
  material: THREE.Material,
  slugData: any,
  options?: SlugInjectionOptions,
): void;
export function injectSlug(
  target: THREE.Material,
  slugData: any,
  options?: SlugInjectionOptions,
): void;
export function injectSlug(
  target: THREE.Mesh | THREE.Material,
  ...args: any[]
): void {
  if ((target as THREE.Mesh).isMesh) {
    const mesh = target as THREE.Mesh;
    const material = args[0] as THREE.Material;
    const slugData = args[1];
    const options = args[2] as SlugInjectionOptions | undefined;

    mesh.material = material;
    injectSlug(material, slugData, options);

    if ((material as any).isRawShaderMaterial) return;

    if (!slugData._depthMaterial) {
      slugData._depthMaterial = new THREE.MeshDepthMaterial({
        side: THREE.DoubleSide,
      });
      injectSlug(slugData._depthMaterial, slugData);
    }

    if (!slugData._distanceMaterial) {
      slugData._distanceMaterial = new THREE.MeshDistanceMaterial({
        side: THREE.DoubleSide,
      });
      injectSlug(slugData._distanceMaterial, slugData);
    }

    mesh.customDepthMaterial = slugData._depthMaterial;
    mesh.customDistanceMaterial = slugData._distanceMaterial;
    return;
  }

  const material = target as THREE.Material & {
    userData?: Record<string, any>;
    onBeforeCompile?: (shader: any) => void;
    transparent?: boolean;
    alphaTest?: number;
  };
  const slugData = args[0];
  const options = args[1] as SlugInjectionOptions | undefined;
  const effects = options?.effects || [];
  const effectUniformDeclarations = buildEffectUniformDeclarations(effects);

  if (material.userData && material.userData.slugInjected) return;

  material.transparent = true;
  material.alphaTest = 0.01;

  material.onBeforeCompile = (shader: any) => {
    shader.uniforms.curvesTex = { value: slugData.curvesTex };
    shader.uniforms.bandsTex = { value: slugData.bandsTex };
    shader.uniforms.uSlugTime = { value: 0 };

    shader.vertexShader = shader.vertexShader.replace(
      "#include <clipping_planes_pars_vertex>",
      "#include <clipping_planes_pars_vertex>\n" +
        slug_pars_vertex +
        (effectUniformDeclarations ? `\n${effectUniformDeclarations}` : ""),
    );

    applyStandardMaterialEffects(shader, effects);

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <clipping_planes_pars_fragment>",
      "#include <clipping_planes_pars_fragment>\n" +
        slug_pars_fragment +
        (effectUniformDeclarations ? `\n${effectUniformDeclarations}` : ""),
    );

    material.userData = material.userData || {};
    material.userData.slugRuntimeUniforms = shader.uniforms;
  };

  material.userData = material.userData || {};
  material.userData.slugData = slugData;
  material.userData.slugInjected = true;
}

const SLUG_RAW_PIXEL_SHADER = `
precision highp float;
${slug_pars_fragment}

out vec4 fragColor;

void main() {
${slug_fragment_core}
  vec3 effectColor = mix(vGlyphColor.rgb, rainbowColor(vGlyphParams.x), clamp(vGlyphParams.w, 0.0, 1.0));
  fragColor = vec4(effectColor, slugAlpha * vGlyphColor.a);
}
`;

const SLUG_RAW_VERTEX_SHADER = `
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uSlugTime;
in vec2 position;
${slug_pars_vertex}
void main() {
${slug_vertex}
    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}
`;

export class SlugMaterial extends THREE.RawShaderMaterial {
  constructor(parameters: SlugMaterialParameters = {}) {
    super({
      vertexShader: SLUG_RAW_VERTEX_SHADER,
      fragmentShader: SLUG_RAW_PIXEL_SHADER,
      uniforms: {
        curvesTex: { value: null },
        bandsTex: { value: null },
        uSlugTime: { value: 0 },
      },
      transparent: true,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      glslVersion: THREE.GLSL3,
    });

    const uniforms = this.uniforms as {
      curvesTex: THREE.IUniform;
      bandsTex: THREE.IUniform;
      uSlugTime: THREE.IUniform;
    };

    if (parameters.curvesTex) uniforms.curvesTex.value = parameters.curvesTex;
    if (parameters.bandsTex) uniforms.bandsTex.value = parameters.bandsTex;

    this.userData = this.userData || {};
    this.userData.slugRuntimeUniforms = uniforms;
  }
}
