# #BuildHybridAI 2026 — what the hackathon asks for

Read 2026-11-28 from the user's open Chrome tabs (Devpost blocks automated fetches and the
built-in browser with a bot check: HTTP 403). Paraphrased, not the official text; the rules
digest with section numbers is [../HACKATHON_RULES.md](../HACKATHON_RULES.md).

| Page | URL |
|---|---|
| Overview | https://firebasehybridaihackathon.devpost.com/ |
| Resources | https://firebasehybridaihackathon.devpost.com/resources |
| Rules | https://firebasehybridaihackathon.devpost.com/rules |

## Key dates (Pacific Time)

| What | When |
|---|---|
| Submission deadline | **Mon Nov 30, 2026, 2:00 PM PT**. Commits pushed after it are not judged. |
| Judging | Dec 10 – Dec 16, 2026 |
| Winners | around Dec 21, 2026 |

## The challenge (overview page)

- On-device models are fast, private and free, but not on every device. Build an app that
  runs prompts on-device when a local model exists and falls back to the cloud when not,
  using the **Firebase AI Logic hybrid inference SDK**.
- Platforms: **Web (Chrome) or Chrome extension** with Gemini Nano, Android with Gemini
  Nano, or iOS with Apple Foundation Models — all through Firebase AI Logic.
- Multi-platform apps get "strong consideration" for the Grand Prize; an outstanding
  single-platform app can still win.
- Their own example idea: a notes app that summarises on-device offline and **hands long
  documents to the cloud**. (MyLocalAI's router does exactly this split.)
- New projects and significantly updated existing ones are both eligible. This repo's
  first commit is 2026-11-22, inside the period, so it is a new project.

## What to build

- A Gen AI app on Firebase AI Logic, **plus supported Firebase products** such as App
  Check, Remote Config, Firestore and Authentication.
- App Check is required by Firebase AI Logic; **debug tokens are accepted** in submissions.
- Any IDE or coding agent is fine (Antigravity is recommended; Claude Code is allowed) as
  long as the app's AI runs on Firebase AI Logic. Firebase Agent Skills are encouraged
  (see [firebase-ai-logic-hybrid.md](firebase-ai-logic-hybrid.md#firebase-agent-skills-and-mcp)).

## What to submit

- A working project on at least one selected platform.
- A text description: **how Firebase AI Logic is used, the features, the value proposition**.
- A **public GitHub/GitLab repo** with all source, assets and setup instructions, stating
  the value proposition and showing Firebase AI Logic **imported and actually called at
  runtime** (an import plus real calls, not just a README mention). Here:
  `tools/firebase-bundle/entry.js` → `vendor/firebase-ai.js` → `providers/firebase-*.js`.
- An **open-source licence file**, visible in the repo's About section (Apache preferred;
  this repo has MIT).
- A **demo video, max 3 minutes**, public on YouTube, English or English subtitles, showing
  it running on the platform. Only the first 3 minutes are judged.
- Encouraged: a URL for judges to test (for an extension: a zip / Web Store link plus
  setup steps), Google IDEs, coding agents with Firebase skills.
- Must be free to use; all materials in English.

## Judging criteria (equal weight, 1–5 each)

1. **Technological implementation** — build quality, and how effectively it uses Firebase
   AI Logic *hybrid inference*.
2. **Design** — a complete, coherent product experience, not a proof of concept.
3. **Potential impact** — a credible, specific case for a real problem and a real
   audience, backed by what is demonstrated.
4. **Quality of the idea** — a creative, non-obvious use of Firebase AI Logic, showing real
   understanding of the problem space.

Stage 1 is pass/fail on the requirements above. Ties are broken in the order listed.
Judging may include automated AI analysis of the repo, so the README and code comments
must make the hybrid logic easy to find.

## Prizes

Grand $10,000 · 1st runner-up $7,000 · 2nd runner-up $4,000 · **Best Web/Chrome App
$3,000** (also Best Android, Best iOS). One entry wins at most one grand prize and one
"Best of" prize. Top winners get an interview and a Firebase blog post.

## Resources page (links worth opening)

- Build session recording (Cynthia Jiang, Firebase team, Nov 12): hybrid app built live.
- Inspiration projects: "Finnish IT and Jojo Apps", "Karrot".
- Free-tier idea list: realtime voice/camera coach (Live API + function calling), PDF reader
  (`gemini-3.8-flash` + `gemini-3.1-flash-tts-preview`), multiplayer tabletop game master
  (`gemini-3.5-flash-lite` + TTS).
- Docs: AI Logic overview, understanding hybrid inference, hybrid AI prompting, hybrid web
  setup, Firebase Agent Skills, production checklist, per-platform guides, "configure your
  project for direct model access to Gemini Nano". Summarised in
  [firebase-ai-logic-hybrid.md](firebase-ai-logic-hybrid.md).
- Google Quota Accounts (for paid features like image generation): request form, ID check,
  4-day accounts in sprints; the final sprint closed Nov 25.
- Help: Devpost Discord `#hackathon-help` (filter the #BuildHybridAI tag),
  firebase-talk Google group, firebase.google.com/community.
