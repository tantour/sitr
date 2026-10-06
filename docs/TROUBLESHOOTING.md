# Troubleshooting

| Symptom | What to check |
|---|---|
| Chrome refuses the extension | Use Chrome 148+, extract the ZIP, and select the directory containing manifest.json. |
| Nothing changes on an existing tab | Refresh the page after installation/reload. Check the main switch, selected people, media switches, Chrome site-access grants, and site exceptions. |
| Image stays black | Wait for cold startup, inspect All settings → Diagnostics, then retry the engine. An unavailable/unreadable source or unsupported animation can remain black. |
| Model build fails | Run `npm run models` to verify all hashes. Install the exact model ZIP for this source version. Do not disable hash checks. |
| Video stays black | DRM, canvas players, inaccessible frames, or failed CORS recovery may prevent capture. Inspect diagnostics. More than two active videos can exceed capacity. |
| Playback stalls after a source reload | CORS recovery can reload an anonymous-readable source once. If the host requires authentication or blocks access, try pausing Sitr on that site. |
| Frequent Strict blackouts | Check model latency, use a lower resolution/performance preset or fast video boxes, and compare with Smooth. Smooth can leave an older mask visible longer. |
| Excess background is covered | Fast boxes are conservative rectangles. Try silhouette mode or reduce expansion after checking coverage. |
| Appearance estimate is wrong | Use Everyone to remove dependence on appearance-based selection, or assign a temporary manual label through Diagnostics. Unclassified → Show reduces coverage. |
| Blur fails or looks black | When copying media into an effect canvas fails, Sitr retains a black mask. Low blur intensity can still reveal recognizable shapes. |
| Site-list edit did not apply | Click Save websites. Entries cover the named hostname, subdomains, and embedded players. |
| Screenshot or UI differs | Check Sitr's version in All settings, reload the unpacked build, then refresh website tabs. |

For bug reports, include versions, your relevant settings, observed status, and a
minimal public or locally generated reproduction. Do not include sensitive media
or browsing URLs. The probes in `scripts/` cover local browser paths; they do not
establish compatibility with every live website. Read [the user guide](USER_GUIDE.md)
and [privacy policy](../PRIVACY.md) for detailed acquisition behavior.
