# Code, models and footage

## Source code and weights

| Component | Fixed source | Attribution / license record |
|---|---|---|
| StegaVAR | https://github.com/clxhsa/StegaVAR/tree/ef9d7f56568f205d60f47b06e3154338d0fe6c5b | Lixin Chen, MIT; keep the upstream LICENSE in the downloaded checkout |
| LF-VSN | https://github.com/MC-E/LF-VSN/tree/cc05d16665122bfcd11522c74e8e1253d0bd9d51 | Chong Mou, Youmin Xu, Jiechong Song, Chen Zhao, Bernard Ghanem, Jian Zhang; CVPR 2023. The inspected checkout has no LICENSE file; no additional redistribution grant is asserted here |
| LF-VSN one-video checkpoint | Google Drive link in the pinned LF-VSN README | SHA-256 `97dbc2d7115fb8ab7c8a219fca60c34f1bac39d1921291d1efbc98cf1d31d504` |
| X-CLIP | https://huggingface.co/microsoft/xclip-base-patch32/tree/a2e27a78a2b5d802e894b8a1ef14f3a8ce490963 | Microsoft; the pinned model card declares MIT and is included in the downloaded files |

`config/assets.lock.json` pins source revisions and SHA-256 for every required model file. Downloaded repositories and model weights are excluded from Git. CPU compatibility changes are distributed in `patches/`. The integration scripts originate from the workspace's StegaVAR demo; they provide file preparation, CPU inference, motion measurement and display packaging.

## Covers

| ID | Creator | Source |
|---|---|---|
| surf | Evgenia Kirpichnikova | https://www.pexels.com/video/a-surfer-riding-the-waves-of-the-sea-2873620/ |
| hike | Dario Fernandez Ruz | https://www.pexels.com/video/a-man-carrying-backpack-while-hiking-on-mountains-9130066/ |
| camp | Taryn Elliott | https://www.pexels.com/video/roasting-a-marshmallow-in-the-campfire-6922819/ |

The source demo records the Pexels License at https://www.pexels.com/license/. Source URLs, cut positions, creators and hashes are retained in `config/scenes.json` and `config/cover-provenance.json`. Each cover is cropped/resized to 384×216 at 10 fps and used for a four-second rover case. No creator endorsement is implied.

## Rover recordings

The two recordings were supplied for the Rover demo. `config/cases.json` records filenames, SHA-256, selected time ranges and the manual case annotations. Original recordings are private build inputs and are not committed. Public display assets are explicit derivatives selected for the application. Motion measurements express visible changes in the fixed ROI; they do not establish job completion or authorize payment.
