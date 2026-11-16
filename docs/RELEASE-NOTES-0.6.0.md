# Sitr v0.6.0 - Smart clothing, animated images, and PDF protection

## Highlights

- Optional smart clothing fill extends garment colors over covered body skin. Hair uses black coverage with a smoother outline and a narrower face-aware edge.
- Custom rules support individual and combined body areas, multiple percentage conditions, and configurable actions. Expansion follows each person's size in frame. The settings editor has clearer area controls and fabric-fill placement.
- Animated GIF and WebP use frame-matched video protection; single-frame files use image settings. Gallery previews keep inactive animations covered without keeping every decoder running.
- PDF protection uses the existing image policies, processes visible content first, prepares the next three pages, and retains the previous two pages. Local and network PDFs have loading feedback, editable picture boxes, tile reconstruction, and scan-based picture detection without another AI layout model.
- Video updates improve motion alignment, tracking continuity, mask delivery, and brief-gap handling. This release does not guarantee a particular frame rate on every site or GPU.
- Fixes cover tab resume, dynamic Google Images previews, small thumbnails, image backgrounds, and stale clothing overlays during reprocessing.

## Installation and updates

Download `sitr-0.6.0-chrome.zip`, verify it against `SHA256SUMS.txt`, extract it, and load its folder from `chrome://extensions` with Developer mode enabled. Update an existing unpacked installation in the same folder, reload the extension, and refresh open tabs or reopen PDFs. The installed extension is named **Sitr**.

Chrome 148 or later is required. Automatic PDF handling requires Chrome 151 or later; the popup also provides Open PDF reader. PDFs use Images policies through their separate PDFs switch. PDF handling uses a custom reader and does not implement all native Chrome PDF features.

## Limits and privacy

Processing stays on the device. Network PDF/image retrieval contacts the source website and may use that site's cookies; there is no inference upload. Downloaded PDF bytes and the reading window consume memory, and preparing pages increases memory and background work. Picture boxes, skin segmentation, appearance estimates, and motion masks remain approximate. Scans can include text or decorations in a box, and content can still be missed. Manual PDF box corrections last for the current document session.

Model weights and hashes remain unchanged from 0.5.2. PDF.js 6.5.438 and its notices are included. Extension permissions are unchanged. The matching source and model archives accompany the Chrome archive for modification and license compliance.

## Validation

See [release validation](RELEASE-VALIDATION-0.6.0.md) for checks performed on the release build. Test results do not guarantee complete filtering or compatibility with every site or PDF.
