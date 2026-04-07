import type { SlugShaderEffect } from "../../library";

export function createWaveEffect(
  name: string,
  phase: number,
  frequency: number,
  amplitude: number,
): SlugShaderEffect {
  return {
    name,
    uniforms: {
      uWavePhase: { value: phase },
      uWaveFrequency: { value: frequency },
      uWaveAmplitude: { value: amplitude },
    },
    vertex: `
      float slugWaveSeed = aScaleBias.z * 0.03 + aScaleBias.w * 0.017;
      transformed.y += sin(slugWaveSeed + uSlugTime * max(uWaveFrequency, 0.0001) + uWavePhase) * uWaveAmplitude;
    `,
  };
}

export function createRainbowEffect(
  name: string,
  mix: number,
  phase: number,
): SlugShaderEffect {
  return {
    name,
    uniforms: {
      uRainbowMix: { value: mix },
      uRainbowPhase: { value: phase },
    },
    fragment: `
      vec3 slugRainbow = rainbowColor(vGlyphInstance * 0.07 + uSlugTime * 0.25 + uRainbowPhase + vGlyphParams.x);
      diffuseColor.rgb = mix(diffuseColor.rgb, slugRainbow, clamp(uRainbowMix, 0.0, 1.0));
    `,
  };
}

export function createPulseEffect(
  name: string,
  strength: number,
  phase: number,
): SlugShaderEffect {
  return {
    name,
    uniforms: {
      uPulseStrength: { value: strength },
      uPulsePhase: { value: phase },
    },
    fragment: `
      float slugPulse = 0.5 + 0.5 * sin(uPulsePhase + uSlugTime * 2.0 + vGlyphInstance * 0.05 + vGlyphParams.x * 0.02);
      diffuseColor.rgb *= 1.0 + slugPulse * uPulseStrength;
      diffuseColor.a *= 1.0 + 0.15 * slugPulse * uPulseStrength;
    `,
  };
}
