# Research notes (read these instead of re-fetching the web)

Saved 2026-11-28 so agents don't have to re-read Devpost, Firebase and Chrome docs.
Devpost blocks automated fetches (HTTP 403), so these notes are the reliable copy. Each
file lists its source URLs; open a source only when a detail here is missing or you need
exact wording.

| File | Read it when you… |
|---|---|
| [hackathon.md](hackathon.md) | write the submission, README value proposition, demo video script, or check a deadline, requirement, judging criterion or prize. Rules with section numbers: [../HACKATHON_RULES.md](../HACKATHON_RULES.md). |
| [firebase-ai-logic-hybrid.md](firebase-ai-logic-hybrid.md) | touch any `providers/firebase-*.js` file or `tools/firebase-bundle`, add a Firebase product (App Check, Remote Config, Auth, Firestore), pick or change a model name, use `InferenceMode` / `inferenceSource` / structured output, or start a new Firebase hybrid app. |
| [chrome-built-in-ai.md](chrome-built-in-ai.md) | change `sidebar/backends/nano*.js`, model download or availability handling, context-window logic, or consider another built-in API (Summarizer, Translator…). |
| [similar-extensions.md](similar-extensions.md) | argue what is new about this project (pitch, README, "Quality of the idea"), or look for UI ideas. |
| [hybrid-decisions.md](hybrid-decisions.md) | plan the next feature, check what is built and unverified, or before changing routing, structured output or Remote Config behaviour. Update it when you finish an item. |

Keep each file under 500 lines (`tests/structure-checks.mjs`). When you learn something new
from the web, add it to the matching file with the date and source URL.
