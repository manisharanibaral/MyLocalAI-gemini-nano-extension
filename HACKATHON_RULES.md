# #BuildHybridAI 2026 — rules digest for this fork

Source pages (read 2026-11-22 in a browser; automated fetches got HTTP 403):

| Page | Status |
|---|---|
| https://firebasehybridaihackathon.devpost.com/rules | Read |
| https://firebasehybridaihackathon.devpost.com/resources | Read |
| https://firebasehybridaihackathon.devpost.com/ (overview) | **Not read**: the fetcher got 403 and the browser navigation was blocked. Paste its text to fill the gap. |

> **This is a paraphrase, not the official text.** Quoting limits allowed only one short
> verbatim quote, so each item below is summarised and points to its section of the
> Official Rules. Check the rules page before relying on any item. Where wording matters
> (eligibility, IP, licence), read the original.

## Dates (Rules §4, all Pacific Time)

| What | When |
|---|---|
| Submission period | Nov 11, 2026 1:30 PM PT → **Nov 30, 2026 2:00 PM PT** |
| Judging | Dec 10, 2026 9:00 AM PT → Dec 16, 2026 2:00 PM PT |
| Winners announced | On or around Dec 21, 2026 12:00 PM PT |
| Quota-account sprint 3 (final) | Request by Wed Nov 25, 10 AM PT; account sent Fri Nov 27 (§5) |

Entrants must work out the matching time in their own time zone (§4). §7 says commits
pushed after the submission period ends are **not evaluated**, except for changes Google
or Devpost approve in writing.

## Eligibility (Rules §3)

- You must be above the age of majority where you live (at least 20 in Taiwan) when you enter.
- Residents of, and organisations based in, Brazil, Quebec, Crimea, Russia, Italy, Syria,
  Sudan, Belarus, Cuba, Iran, North Korea, or any other OFAC-designated country cannot enter.
  The contest is void there.
- You cannot be subject to US export controls or sanctions, and you must have had internet
  access as of Nov 11, 2026.
- These people are excluded: employees, interns, contractors and office-holders of Google,
  Devpost and the other organisations running the contest; their immediate families and
  households; government-agency employees; and anyone with a real or apparent conflict
  of interest.
- If you enter on behalf of an employer, the employer must know about it and consent.

## Cost (Rules §5)

- The required tools, including Firebase AI Logic and Gemini Nano 4, are free on the free
  tier. No purchase is necessary.
- Billing-required models (for example image generation) need a Google Quota Account.
  You apply on a form; approval is at Google's discretion and lasts 4 days per sprint.
  **You pay any fees outside that quota.** This fork uses free-tier models only.

## What to build (Rules §6, "What to Create")

- A generative-AI app built with **Firebase AI Logic**, plus supported Firebase products
  such as App Check, Remote Config, Firestore and Authentication.
- At least one platform is required; multi-platform is preferred. The Web (Chrome) option
  is Gemini Nano 4 through Firebase AI Logic, built as a web app or a **Chrome extension**.
  That is this project's category.
- §6 says, verbatim: "Firebase AI Logic requires App Check; debug tokens are accepted in submissions."
- The judging criteria score how well the project uses **Firebase AI Logic hybrid
  inference** (§8).

## Rules that limit what we build or use (Rules §6)

- **Existing projects:** MyLocalAI existed before Nov 11, so it must be *significantly
  updated* after the period started. We must **disclose any pre-existing code** and give a
  **summary of what was built during the submission period**. Frameworks, libraries,
  starter templates and AI coding assistants are allowed.
- **Existing app with public usage:** the description must explain the core value the
  existing app brings to the new project. How widely it is used is optional.
- **Third-party SDKs, APIs and data:** we must be authorised under their terms and
  licences. This fork bundles Firebase (Apache-2.0), marked and DOMPurify.
- **Secrets and PII:** no production API keys, live Google Cloud project secrets,
  confidential commercial data, or PII in the repository, submission form or testing
  instructions. *This is why real config lives only in the git-ignored
  `firebase-settings.local.js`.*
- **Functionality:** the project must install and run consistently, and must behave as
  shown in the video and description.
- **Testing access:** judges must be able to test the project free of charge and without
  restriction until judging ends, through a link, demo or test build. Judges may judge
  from the video and description alone.
- **Language:** the app must support English. Materials must be in English or come with
  English translations.
- **IP and ownership:** the work must be original and solely owned, and must not infringe
  anyone's rights. Open source is allowed if you follow its licence *and* the project
  builds meaningfully on top of it.
- **No sponsor or administrator funding:** projects funded, contracted or licensed by Google
  or Devpost are ineligible.
- **Content:** nothing offensive or unlawful, no third-party advertising, logos or
  trademarks that imply sponsorship, and nothing that violates someone's privacy or
  publicity rights.
- **Multiple entries:** allowed, but each must be substantially different.

## Submission checklist (Rules §6, "Submission Requirements")

- [ ] Select at least one platform (Web/Chrome).
- [ ] Text description covering **how Firebase AI Logic is used**, the features, and the
      **value proposition**. Add the existing-app summary items above.
- [ ] A **public GitHub or GitLab repository** with all source, assets and setup
      instructions. It must state the value proposition and show Firebase AI Logic
      **imported and actually called at runtime**; naming it in the README is not enough.
      Here that is `firebase-backend.js` → `vendor/firebase-ai.js`.
- [ ] An **open-source licence file**, detectable in the repo's About section. Apache is
      preferred. *An MIT `LICENSE` was added to the fork on 2026-11-22. Apache is preferred, but any
      open-source licence is accepted.*
- [ ] A **demo video of at most 3 minutes**, public on YouTube, in English or with English
      subtitles, showing the project running on its platform.
- [ ] Encouraged but optional: a hosted or testable URL, Google IDEs, and coding agents
      with Firebase agent skills.

## Judging (Rules §8)

Stage 1 is pass/fail: did the entry meet all requirements and address a challenge?
Stage 2 scores four equally weighted criteria from 1 to 5, and the scores are averaged:

1. **Technological implementation:** build quality, and how well it uses Firebase AI
   Logic hybrid inference.
2. **Design:** a complete, coherent product, not just a proof of concept.
3. **Potential impact:** a credible case for a real problem and a real audience.
4. **Quality of the idea:** a creative, non-obvious use of Firebase AI Logic, showing
   real understanding of the problem.

Ties are broken by comparing the criteria in that order. Judging may include automated
AI analysis.

## Prizes (Rules §9)

Grand Prize $10,000; 1st runner-up $7,000; 2nd runner-up $4,000. **Best Web/Chrome**,
Best Android and Best iOS each pay $3,000. One entry can win at most one grand prize and
one "Best of" prize. Winners pay their own taxes and fees (§10).

## Licence granted to Google (Rules §12)

You keep ownership. By entering, you grant Google a perpetual, worldwide, royalty-free,
non-exclusive licence to use and display the project for judging and promotion.

## Resources page (summary)

- A recorded build session, Nov 12, on building a hybrid app with Firebase AI Logic.
- Docs links: AI Logic overview, hybrid inference, hybrid prompting, hybrid web setup,
  Firebase Agent Skills (which names Claude Code), and the production checklist (App Check
  required; Remote Config, Firestore and Auth as supporting products).
- Quota-account process: register, submit the form, pass the eligibility check, verify
  identity (ID photo and selfie), then get approved.
- Support: Discord `#hackathon-help`, the firebase-talk Google group, and the Firebase
  community page.
