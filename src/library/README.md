# JSlug Library

This package contains the reusable Slug generation and rendering primitives extracted from the demo app.

## Install

```bash
npm install three-ts-slug
```

## Usage

```ts
import { SlugGenerator, SlugLoader, SlugGeometry, SlugMaterial, injectSlug } from "three-ts-slug";
```

## API Surface

- `SlugGenerator` converts OpenType-compatible font data into Slug texture and geometry data.
- `SlugLoader` parses `.sluggish` buffers back into renderable data.
- `SlugGeometry` builds the instanced glyph geometry used by the shader pipeline.
- `SlugMaterial` and `injectSlug` integrate Slug rendering into Three.js materials.
- Types are exported from `./types` through the package entry point.

## Notes

The demo UI and GitHub Pages showcase live outside this package in the root `ts-slug/` app.
