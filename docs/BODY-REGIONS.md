# Choose image areas for each gender

Open the popup's Images tab or All settings → Coverage. Select **Female** or
**Male**, click an area on the person, then choose its action. The area menu
offers the same choices for keyboard users. Face has Show, Black, Blur and
Pixelate; hair and exposed body-skin areas have Show or Hide. Blur and Pixelate
show their strength directly below the actions, independently for each gender.

To hide only male thighs: enable **Advanced segmentation**, select **Male → Show all**, click either thigh, then
choose **Hide**. Hair, face, neck, torso, arms, hands, lower legs and feet remain
shown. **Show all** also shows unrecognized skin. Female choices are independent.
**Groin (pelvis)** is a separate area on the diagram and in the area menu. To
cover the pelvis and upper thighs without the chest/belly, hide **Groin** and
**Thighs**, leaving **Torso** shown. Saved groin choices initially inherit the
previous torso action, including Show all; either can then be changed independently.
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
pixels. Its original hip/shoulder landmarks predict the groin through clothing,
while hip-to-knee segments repair upper thighs mislabelled as torso or lower legs.
The pelvis follows bent/crossed legs and ends above the learned knees. Instance
masks isolate each person's evidence; ambiguous overlaps and uncertain landmarks
are rejected. Clothing remains excluded from the output map. Torso combines chest
and belly. Neck uses BodyPix head labels that
MediaPipe considers body skin; it is an estimate, not a dedicated neck class.
Overlapping parts and skin classification can be wrong.
If reliable pelvis landmarks are unavailable (for example small people or torso-
only crops), the decoder retains the existing part labels instead of inventing
a groin. Quality gives more useful detail for small people; it is not a guarantee
of complete groin or thigh coverage. Modest-image checks establish localization
and clothing exclusion on the tested fixtures, not universal demographic accuracy.

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

The models add about 10.00 MB to the distribution. Only the chosen variant loads
when image skin needs it; both reuse ONNX Runtime Web with WebGPU and WASM
paths. No TensorFlow.js dependency or external inference service is added.
Policy edits/manual labels reuse image region maps; switching variants
reanalyzes images.

## Diagnostics

Enable **Show AI debug outlines, face boxes, and gender estimates**. BodyPix
adds colored skin regions and a model/backend/status/time caption. Torso is red,
upper arms blue, forearms purple, hands yellow, thighs pink, lower legs green,
feet cyan, neck orange, groin coral. Regular images and CSS backgrounds use the same palette. These are
model estimates, not ground truth.

`data-local-media-censor-body-regions` on media elements contains JSON:

- `model`, `inputSize`, and `stride`: chosen variant and successful input grid.
- `status`: `disabled`, `skipped-video`, `skipped-coverage`, `skipped-no-skin`,
  `ready`, `cache`, or `fallback`; `error` explains fallback when present.
- `backend`: the backend which produced the map. Cache retains this provenance.
- `skinPixels`, `unknownSkinPixels`: source-grid body-skin counts.
- `groinEstimatedPeople`, `groinSkippedPeople`: accepted and rejected per-person
  pelvis estimates. Cached results retain these counts.
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

Before the groin update, packaged-worker checks on an i5-8250U/UHD 620 measured about 32–51 ms for the
faster variant and 81–96 ms for the finer variant after startup (three samples
each, WebGPU, 320-pixel bus fixture). Cold BodyPix initialization can add seconds.
These are stage timings, not full-extension throughput or playback-FPS measurements.
Backend, cold startup, and other work change performance. See [benchmark
notes](../BENCHMARK.md).

Run `node scripts/body-regions-probe.mjs` after building to check packaged
models, independent appearance policies, cached edits, duplicates, video
skipping, and conservative failure fallback. [Model setup](../models/README.md)
documents conversion and source/output hashes.

Run `node scripts/groin-probe.mjs` for standing, crossed-leg, seated, multiple-
person and torso-crop photographs and their mirrors, using both variants. The
fixtures are fully clothed men; no underwear, swimwear or immodest images are
used. Diagnostic maps probe clothed anatomy, while a separate normal skin-map
pass checks that clothing pixels stay unlabelled. Synthetic tests verify skin
masking and independent policies. Reports/diagnostic PNGs are saved under `.cache/`.
