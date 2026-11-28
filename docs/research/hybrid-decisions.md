# Hybrid design decisions, status and next steps

What was built for the hackathon, why, and what is still open. Update this file when a
decision changes or an item is done.

## Built (2026-11-28) and the judging criterion each serves

| Feature | Why | Code | Criterion |
|---|---|---|---|
| Long-input router | The SDK picks Nano whenever it exists, even if the prompt overflows its 9,216 tokens. On *On-device first*, such prompts go `ONLY_IN_CLOUD`; on *On-device only* they are refused with an explanation. Matches the hackathon's own "long documents to the cloud" example. | `providers/firebase-routing.js` (`chooseRequestMode`), `routeRequest` in `providers/firebase-backend.js` | Tech, Idea |
| Answer-source chip | Users must see when text left the device. From `inferenceSource`. | `describeAnswerSource`, `showAnswerSource` in `sidebar/ui/response-actions.js` | Design, Impact |
| Hybrid structured output | Memory tool and chat compaction get schema-constrained JSON on both Nano and cloud. | `generateJson` in `firebase-backend.js`, `askProviderForJson` in `sidebar/backends/structured-output.js` | Tech |
| Remote Config model names | Production checklist recommendation; swap retired models without a release. Only stable Gemini text models accepted. Fetched only on cloud routes. | `providers/firebase-remote-config.js`, `applyCloudModelNames` in `providers/firebase-settings.js` | Tech (extra Firebase product) |
| Live Remote Config + "cloud failed" chip (2026-11-28) | A console publish now reaches an open panel (`onConfigUpdate`), instead of waiting out the 1-hour fetch cache. On *Cloud first* the SDK silently answers on-device when the cloud call fails (App Check 403 seen in a real run); the chip now says "cloud failed". `scripts/firebase-diagnose.mjs` checks App Check / Remote Config / realtime from Node. | `watchCloudModelNames` in `providers/firebase-remote-config.js`, `reasonAfterAnswer` in `providers/firebase-routing.js` | Tech, Design |
| App Check debug token | Required by AI Logic; reCAPTCHA can't load in MV3. | `initializeAppCheckForExtension` | Requirement |
| "Cloud & internet" switch, on-device default | Private by default; one click guarantees no network. | `providers/firebase-settings.js` | Impact, Design |

Fixed constraints in this repo: free-tier cloud models only (`gemini-3.5-flash-lite`,
`gemini-4-hydrogen`; `gemini-3.8-flash` is also free and could be added); no Firebase code
in `sidebar/` (only `provider-hook.js` / `structured-output.js` talk to the provider);
real config only in git-ignored `firebase-settings.local.js`.

## Not verified in a real browser yet

- Cloud `responseSchema` accepting the trimmed schema (`toCloudSchema`).
- `onDeviceParams.promptOptions.responseConstraint` passing through the SDK to Nano.
- A real Remote Config fetch from the extension page. From Node (`scripts/firebase-diagnose.mjs`,
  2026-11-28) fetch and the realtime stream both work for this project; the extension page
  itself is still unchecked.
- The token estimate (3 chars/token) against real Nano limits on long pages.

Try in `dist/mylocalai-firebase-hybrid` after `node scripts/build.mjs firebase-hybrid`.

## Ideas not done (ranked by likely judging value)

1. **Demo video (required, ≤ 3 min).** Suggested flow: on-device chat with ⚡ chip →
   paste a long report on *On-device first* → ☁️ "too long for on-device" chip →
   switch "Cloud & internet" off → same long message is refused, nothing sent → memory
   learned via structured output → Remote Config changes the cloud model live.
2. Use the **Summarizer API** on-device to shrink a long page before deciding to go to
   the cloud (keeps more on-device).
3. **Firebase Authentication + Firestore** to sync memories / saved prompts across
   devices (another two Firebase products; must stay opt-in and off for on-device only).
4. Remote Config for the system prompt and the routing threshold.
5. Limited-use App Check tokens (`useLimitedUseAppCheckTokens: true`).
6. Multi-platform (Android/iOS) — the Grand Prize favours it, but it's a separate app.
