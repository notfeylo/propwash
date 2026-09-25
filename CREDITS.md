# Credits

The PROPWASH source code is MIT-licensed (see [LICENSE](LICENSE)). Third-party assets keep their own licenses, listed per file below.

## 3D model

| File                                                                  | License                                                  |
| --------------------------------------------------------------------- | -------------------------------------------------------- |
| `assets-src/drone/*` (source) · `public/models/drone.glb` (generated) | [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/) |

This work is based on "FPV-dron_NonStop" (https://sketchfab.com/3d-models/fpv-dron-nonstop-c75dea6e3ae441ac87f292efb17f5bae) by Viktor_ (https://sketchfab.com/Viktor.Zhuravlev) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

Changes were made: split into parts, re-scaled to meters, textures re-encoded.

The original license file ships at [`assets-src/drone/license.txt`](assets-src/drone/license.txt).

## Audio

The public build ships **procedurally synthesized** motor audio and beeps only; no recorded audio is committed. See [`assets-src/audio/LICENSE-NOTE.md`](assets-src/audio/LICENSE-NOTE.md).

## Environment maps

| File                                 | Source                                                                                     | License                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `public/hdri/studio_small_09_1k.hdr` | [Studio Small 09](https://polyhaven.com/a/studio_small_09) by Sergej Majboroda, Poly Haven | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |

## Bench set

The concrete floor and landing pad textures are generated procedurally at runtime (`src/render/proceduralTextures.ts`). They are original to this project.
