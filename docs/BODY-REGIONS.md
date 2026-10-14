# Choose image areas for each gender

Open the popup's Images tab or All settings → Coverage. Select **Female** or
**Male**, click an area on the person, then choose its action. The area menu
offers the same choices for keyboard users. Face has Show, Black, Blur and
Pixelate; hair and exposed body-skin areas have Show or Hide. Blur and Pixelate
show their strength directly below the actions, independently for each gender.

To hide only male thighs: enable **Advanced segmentation**, select **Male → Show all**, click either thigh, then
choose **Hide**. Hair, face, neck, torso, arms, hands, lower legs and feet remain
shown. **Show all** also shows unrecognized skin. Female choices are independent.
There is no global Female/Male/Everyone/No one selector. Videos have separate
Show/Black/Blur/Pixelate choices for each gender and cover the whole person.

The visible **Advanced segmentation** checkbox above the gender tabs switches area detection
on or off. When on, its adjacent quality selector offers **Fast** (stride 16) and
**Quality** (stride 8, slower with finer detail); the segmented diagram controls individual areas.
When off, one continuous body-skin shape replaces those segments. Show all /
Hide all above it affect body skin only, while face and hair keep independent
choices. The area menu then offers Body skin, Face and Hair. Turning off groups
each gender's skin: any requested skin hide becomes Hide for all body-skin
areas, otherwise all stay shown. In on mode, Show all / Hide all reset all image
areas, including face and hair. Neither mode changes video choices.

MediaPipe still detects skin/hair/face; BodyPix labels anatomy at body-skin
pixels. Torso combines chest and belly. Neck uses BodyPix head labels that
MediaPipe considers body skin; it is an estimate, not a dedicated neck class.
Overlapping parts and skin classification can be wrong.

**Unrecognized skin** has its own Show/Hide action in the area menu. Unclassified
people use the existing Show/Censor control; Censor uses the union of the
gender policies. A missing body map covers requested hidden skin conservatively,
but a Show-all person remains shown. Inferred map failures are diagnosed.

Expansion is clipped against shown skin, hair and faces. Fully shown people
do not receive semantic border masks near their instance. Genuine hidden
pixels from another person at an overlap retain coverage. **Cover area** is above
the editor: Chosen areas uses skin choices; Whole body includes clothing and
keeps face effects separate. Body-area actions return coverage to Chosen areas;
face and hair choices preserve the current mode. Skin-exposure rules have been
removed and existing saved rules are disabled.

Existing choices are migrated when opening the new editor. Old all-body-area
exemptions also migrate hair and neck to Show. Policy settings use
`personPolicies.female` and `.male`, each with `skin`, `otherSkin`, `hair`,
`face`, optional `faceStrength`, and `video`. Existing strengths inherit the previous shared value until edited. Legacy fields remain readable for older automation clients.

The models add about 9.84 MB to the distribution. Only the chosen variant loads
when image skin needs it; both reuse ONNX Runtime Web with WebGPU and WASM
paths. No TensorFlow.js dependency or external inference service is added.
Policy edits/manual labels reuse image region maps; switching variants
reanalyzes images.

## Diagnostics

Enable **Show AI debug outlines, face boxes, and gender estimates**. BodyPix
adds colored skin regions and a model/backend/status/time caption. Torso is red,
upper arms blue, forearms purple, hands yellow, thighs pink, lower legs green,
feet cyan, neck orange. Regular images and CSS backgrounds use the same palette. These are
model estimates, not ground truth.

`data-local-media-censor-body-regions` on media elements contains JSON:

- `model`, `inputSize`, and `stride`: chosen variant and successful input grid.
- `status`: `disabled`, `skipped-video`, `skipped-coverage`, `skipped-no-skin`,
  `ready`, `cache`, or `fallback`; `error` explains fallback when present.
- `backend`: the backend which produced the map. Cache retains this provenance.
- `skinPixels`, `unknownSkinPixels`: source-grid body-skin counts.
- `allowedSkinPixels`, `coveredSkinPixels`: confidently owned, selected body-
  skin policy counts before expansion. Forced blackouts/unassigned/ambiguous
  pixels use separate existing coverage mechanisms.
- `femaleAllowedRegions`, `maleAllowedRegions`: current shown body-skin areas.
- `policies`: current per-gender skin, hair, face, unrecognized-skin and video actions.

`data-local-media-censor-timings-ms` adds `bodyRegions`, `bodyRegionPreprocess`,
`bodyRegionRun`, `bodyRegionDecode`, `bodyRegionModel`, `bodyRegionBackend`.
The total stage includes lazy initialization; warm run/decode fields isolate
execution and readback. Cached policy edits/adoptions and video skips report
zero new BodyPix work. Timing backend reports `cache` when the map is reused.
Person/semantic stages can overlap, so do not sum them to estimate total time.

Packaged-worker checks on an i5-8250U/UHD 620 measured about 32–51 ms for the
faster variant and 81–96 ms for the finer variant after startup (three samples
each, WebGPU, 320-pixel bus fixture). Cold BodyPix initialization can add seconds.
These are stage timings, not full-extension throughput or playback-FPS measurements.
Backend, cold startup, and other work change performance. See [benchmark
notes](../BENCHMARK.md).

Run `node scripts/body-regions-probe.mjs` after building to check packaged
models, independent appearance policies, cached edits, duplicates, video
skipping, and conservative failure fallback. [Model setup](../models/README.md)
documents conversion and source/output hashes.
