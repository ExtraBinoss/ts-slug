# JSlug TypeScript Library

Live demo: https://extrabinoss.github.io/ts-slug/

Install:

```bash
npm install three-ts-slug
```

This project is a TypeScript port of JSlug, with a publishable npm library in `src/library`.
The Vue app in this repository is only a showcase for the library.

## Why This Port Exists

- Port the Slug pipeline to TypeScript.
- Keep support for both runtime `.ttf` generation and `.sluggish` import.
- Expose a clean Three.js-focused API surface.
- Add text effects support through shader hooks.
- Render text using per-character GPU instancing for high throughput.

## Core Features

- TypeScript implementation of generator, loader, geometry, and material pipeline.
- Per-character instanced rendering with `SlugGeometry`.
- Shader effect extension points (`SlugShaderEffect`) for custom animation and styling.
- Binary `.sluggish` export/import path for caching and fast startup.
- Runtime font parsing path via `opentype.js`.

## Library API Surface

Library entry point: `src/library/index.ts`

Main exports:

- `SlugGenerator`
	- `generateFromUrl(url)`
	- `generateFromFile(file)`
	- `generateFromBuffer(buffer)`
	- `generate(font)`
	- `exportSluggish(generatedData)`
- `SlugLoader`
	- `load(url, onLoad, onProgress?, onError?)`
	- `parse(buffer)`
- `SlugGeometry`
	- Instanced glyph geometry with wrapping, alignment, line-height, and glyph styles.
- `SlugMaterial` and `injectSlug`
	- Slug rendering integration for Three.js materials.
	- Runtime shader effect support.
- Types
	- `SlugGeneratedData`, `SlugLoaderData`, `SlugTextOptions`, `SlugShaderEffect`, and more.

Minimal usage:

```ts
import * as THREE from "three";
import { SlugGenerator, SlugGeometry, injectSlug } from "three-ts-slug";

const generator = new SlugGenerator({ fullRange: true });
const slugData = await generator.generateFromUrl("/fonts/MyFont.ttf");

const geometry = new SlugGeometry(4000);
geometry.addText("Hello TypeScript", slugData, {
	fontScale: 0.12,
	justify: "left",
});

const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
const mesh = new THREE.Mesh(geometry, material);
injectSlug(mesh, material, slugData);
```

## Demo

The interactive demo is located in `src/components/SlugDemo.vue`.

What it validates:

- Runtime generation from `.ttf`.
- Direct import of `.sluggish` files (manifest-based or local upload).
- Playground, benchmark, and effects scenes powered by the same instanced text pipeline.

## CI/CD

- Demo deploy workflow: `.github/workflows/deploy.yml`
	- Builds and deploys the Vue showcase to GitHub Pages.
- Library publish workflow: `.github/workflows/publish-npm.yml`
	- Bumps version in `src/library`, builds the library, publishes to npm, and pushes commit/tag.

Required secret for npm publishing: `NPM_TOKEN`

## Credits

- Original project: [manthrax/JSlug](https://github.com/manthrax/JSlug)
- Slug algorithm credit (upstream): Eric Lengyel
- Sluggish C++ reference (upstream): mightycow/Sluggish
- Runtime dependencies: Three.js and opentype.js

## License TODO

- Verify and document license requirements for the algorithm, dependencies, fonts, and generated `.sluggish` assets before broad distribution.
