# Browser QA: main01 evidence contradiction repair

Date: 2026-06-16
Repository: `/Volumes/App_Dev/new_Prompt_prj`
Branch: `main01`
Scope: read-only review of currently tracked `evidence/screenshots/*.png` and
browser evidence reports under `evidence/`.

## status

PASS_EVIDENCE

## boundaries

- This review did not rerun the browser main flow.
- This review does not claim `PASS_BROWSER`.
- This review treats the current evidence as reusable browser evidence only.
- This review did not read `真实配置.json`.
- This review did not edit business code.
- The only write from this review is this report.

## evidence reviewed

| Artifact | Status | Evidence |
| --- | --- | --- |
| `evidence/screenshots/browser-qa-main01-text.png` | PASS_EVIDENCE | Tracked PNG. Visual inspection shows generated preview, task history, completion UI, and visible sanitization overlays. |
| `evidence/screenshots/browser-qa-main01-image.png` | PASS_EVIDENCE | Tracked PNG. Visual inspection shows completion UI and visible sanitization overlays over prompt/reference areas. |
| `evidence/screenshots/final-v1-4-contract-before-submit.png` | PASS_EVIDENCE | Tracked PNG. Visual inspection shows pre-submit UI state with sanitization overlays; this supports setup/context evidence, not a post-submit success by itself. |
| `evidence/screenshots/final-v1-4-contract-after-submit.png` | PASS_EVIDENCE | Tracked PNG. Visual inspection shows generated preview after submit with sanitization overlays. |
| `evidence/visual-e2e-report.md` | PASS_EVIDENCE | Browser report says retained screenshots are sanitized PNG files tracked on `main01`, trace/network captures are ignored runtime, text generation and image edit succeeded in the latest recorded browser evidence, and no mock success is accepted. |
| `evidence/final-v1-4-fix-report.md` | PASS_EVIDENCE | Browser state section records text generation and image edit success, generated-image GET checks, no-store cache control, tracked sanitized screenshots, and no `main` push authorization. |
| `evidence/network-summary.json` | PASS_EVIDENCE | JSON records `checked_at=2026-06-15`, `branch=main01`, text generation success, image edit success, no mock success, screenshots saved, no trace saved, and no network capture saved. |
| `evidence/final-v1-4-network-summary.json` | PASS_EVIDENCE | JSON records `checked_at=2026-06-15`, `branch=main01`, text/image browser statuses, `generated_image_get_no_store=true`, `screenshots_tracked=true`, and no tracked raw provider bodies, encoded image payloads, or credential values. |
| `evidence/premerge-current-tree-browser-report.md` and summary JSON | PASS_EVIDENCE | These are explicitly historical/superseded evidence and should not be used alone as current image-edit PASS evidence. They are consistent as audit trail only. |

## command evidence

| Command | Status | Result |
| --- | --- | --- |
| `git status --short --branch -- evidence ...` | PASS_EVIDENCE | Branch is `main01`; scoped evidence files are tracked and staged as modified, with no unstaged evidence diff. |
| `git ls-files evidence/screenshots evidence/*.md evidence/*.json` | PASS_EVIDENCE | Returned all scoped screenshot PNGs and browser evidence reports as tracked paths. |
| `git diff --cached --stat -- evidence/screenshots evidence/visual-e2e-report.md ...` | PASS_EVIDENCE | Current staged evidence changes are four sanitized PNG replacements and one wording repair in `evidence/visual-e2e-report.md`. |
| `file evidence/screenshots/*.png` | PASS_EVIDENCE | All four scoped screenshot files are PNG images. Dimensions are `2584x1859`, `2584x1859`, `1265x2306`, and `1265x2234`. |
| `shasum -a 256 ...` | PASS_EVIDENCE | Current reviewed artifacts have stable hashes recorded during this review. |
| `strings -a ... | rg ...` | PASS_EVIDENCE | No matches for obvious secret/header/config/link/base64 markers in the four screenshot files. |
| Manual image inspection | PASS_EVIDENCE | Screenshots show application UI, generated images or pre-submit context, and visible `SANITIZED EVIDENCE` overlays. No visible API key, Authorization header, Cookie, raw provider body, raw base64 payload, complete generated-image link, complete reference link, runtime config, or `真实配置.json` content was observed. |

## browser wording review

The evidence reports use wording such as "latest real browser rerun". In this
review, that wording is accepted only as a description of the already-recorded
2026-06-15 browser evidence. It must not be read as a 2026-06-16 browser rerun.

The current report therefore supports `PASS_EVIDENCE`: the tracked screenshots
and browser reports are enough for a reused-evidence browser acceptance口径.
It does not support `PASS_BROWSER`, because no browser main flow was rerun in
this review.

## conclusion

PASS_EVIDENCE

The current tracked evidence set can support reused browser evidence acceptance.
The required limitation is explicit: this is not a fresh browser rerun and must
not be reported as `PASS_BROWSER`.
