---
name: huntbot-landing-gpu
description: Landing WebGPU/WebGL — WGSL+WebGL2 fallback, teardown, shader parity, testable TS. Use when editing src/lib/landing.
---

# Landing GPU (when present)

- Prefer WebGPU with WGSL compilation checks and a **WebGL2 fallback** if WebGPU fails.
- Teardown must stop RAF and call `destroy()` on custom renderers; guard async work with a `cancelled` flag.
- When changing uniforms or reveal logic, keep **WGSL and GLSL** shader strings in sync.
- Put pack/unpack math in **testable TypeScript** where possible, not only in shader source.
