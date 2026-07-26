# Latent: Market, Competitive & Strategic Analysis + Roadmap

*Revision 2 — July 2026. Key facts re-verified against current sources; adds bottom-up market sizing, unit economics, evidence grading, a demand-first validation sequence, and corrections to Apple Motion Art constraints and competitor pricing. See "Revision notes" at the end.*

---

## Decision summary (one page)

| Question | Answer |
|---|---|
| **What to build** | A calm, deterministic, client-side (WebGL2 + WebCodecs) tool that turns a track's cover art into on-spec **Spotify Canvas** and **Apple Music Motion Art** loops, driven by the artist's actual audio. |
| **Who for** | Independent ambient / lo-fi / classical / jazz / meditation / sleep artists who release frequently and care about visual identity. |
| **The wedge** | Guaranteed spec compliance (never-rejected uploads, seam-free loops), no-strobe by design, and local-first privacy for unreleased tracks — not "wow" visuals. |
| **What NOT to build** | Anything positioned as "make my song go viral on TikTok." Cold-feed algorithms reward high-motion hooks; calm loses that war by design. |
| **Pricing** | Freemium. Lead with a **one-time watermark-removal unlock ($39–$79)** as anti-subscription positioning; offer an optional low subscription ($8–$12/mo) for preset sync and updates. Zero marginal render cost makes both viable. |
| **First milestone** | Before building the full app: a landing page + demo that produces one perfect Canvas, 10 paying-intent conversations, and ≥100 waitlist signups from one community. |
| **Biggest risk** | Distribution, not product. Free "good enough" alternatives (CapCut, DistroKid's generator) mean Latent must win on trust and spec-perfection **and** find cheap repeatable top-of-funnel — the second is harder. |
| **Kill criteria** | Paid conversion <1% after onboarding fixes; Spotify/Apple ship a first-party "animate your cover" button; mobile-Safari support load exceeds solo-dev capacity. |

---

## TL;DR

- **Latent should NOT try to be a mass-market "music visualizer."** Its calm/subtle, deterministic, privacy-first approach loses the open social-feed war (TikTok/Reels/Shorts algorithms reward high-motion hooks in the first ~3 seconds) but wins in a specific beachhead: **Spotify Canvas / Apple Music Motion Art creation for ambient, lo-fi, classical, jazz, meditation and sleep artists** — genres where calm motion is genre-appropriate and where platform specs actively forbid strobing.
- **One material correction to the calm thesis:** Apple's Motion Art guidelines require that motion be *clearly present* — "no static imagery or stills, unless actively integrated into the animation" — while also banning frenetic flashing and requiring the animation to "stay on the album cover art." Latent's sweet spot is therefore a **band**: motion subtle enough to pass the no-flashing rule, visible enough to pass the no-stills rule. Ultra-minimal presets need a "motion visibility" validator, not just an amplitude cap.
- **The value proposition is real but thin as a standalone paid app.** Zero-marginal-cost client-side rendering, no-strobe-by-design accessibility, local-first privacy for unreleased tracks, and a pro "routing matrix" are genuine differentiators versus credit-metered AI tools (Kaiber, Neural Frames, Runway) and template shops (Specterr, CapCut). But commoditization risk is severe: CapCut, Canva and distributors (DistroKid) already offer free Canvas generation, so Latent must win on quality, control and trust, not on "makes a moving image."
- **Recommended path: validate demand first (landing page + conversations), then a freemium web app with a one-time watermark-removal unlock**, launched into the lo-fi/ambient musician community, with an explicit later play to white-label the engine to a distributor. Expect freemium-to-paid conversion of 2–5% and model at the low end; the business only works at meaningful top-of-funnel volume, so distribution is the single biggest risk for a solo dev.

---

## Market sizing: a bottom-up model (replacing unreliable top-down figures)

Top-down "music visualizer software" market estimates are junk — they span **$170M to $2.8B for roughly the same year** across research shops, with CAGRs from ~9% to ~31%. Nobody has a reliable number; the category is small and definitionally fuzzy. (The adjacent AI-video market is better-tracked and large — Grand View: ~$3.86B in 2024 → ~$42B by 2033 — but that is a different category; it's where the marketing oxygen lives, not where Latent competes.)

A bottom-up funnel is more honest. All steps below are stated with their confidence grade (**A** = verified primary/current source, **B** = credible secondary, **C** = assumption/estimate):

| Funnel step | Estimate | Grade |
|---|---|---|
| Tracks uploaded to DSPs per day | ~100,000 (Luminate via MBW/Billboard brackets 49K–100K+; one 2026 guide says 106K) | B |
| Implied tracks/year | ~36M | B (arithmetic) |
| Unique active releasing indie artists/year, globally | ~3–6M (DistroKid alone claims 2M+ artists; TuneCore, CD Baby, UnitedMasters, Amuse add more, with overlap) | C |
| Share in calm-native genres (ambient, lo-fi, classical, jazz, meditation, sleep) | ~8–15% (unmeasured; lo-fi/functional listening is large — Lofi Girl ~15.8M YouTube subs, "lofi beats" playlist 5M+ likes — but genre share of *uploads* is an assumption) | C |
| Calm-genre releasing artists/year | **~250K–900K** (serviceable addressable) | C |
| Reachable by a solo dev in 12–18 months via one community + SEO + Product Hunt | ~5K–30K registered users | C |
| Free→paid conversion (self-serve creative freemium) | 2–5% (Poyar/ChartMogul data; design/creative freemium often 1–3%) | B |
| **Implied paying customers at 12–18 months** | **~100–1,500** | C |

**Read:** even the pessimistic end of this funnel supports a meaningful solo-dev side business ($2.5K–$10K/mo equivalent — see unit economics below), and the optimistic end supports a real full-time business. But every order-of-magnitude of upside lives in the *reach* row, which is why go-to-market is the plan's center of gravity, not features.

---

## Key findings

### Spotify Canvas is the strongest demand signal — and it favors Latent's format

- **Canvas specs (verified current, July 2026):** 9:16 vertical, 3–8 seconds (uploads fail outside this window), MP4 (or JPG for a static frame), 720–1080 px tall — Spotify's own upload guidance accepts up to 1080, so exporting above 1080×1920 buys nothing. No audio track. The loop hard-cuts back to frame one, so seam-free design is the whole craft. Free to all artists via Spotify for Artists. **[Grade A]**
- Spotify's first-party marketing data: tracks with a Canvas see **+5% streams, +145% shares, +20% playlist adds, +1.4% saves, +9% profile visits** vs. control (a "+120% streams / +114% saves" variant also circulates). **Critical caveat:** a 2025 **Chartmetric analysis of ~12,000 independent releases** (via MusicPulse), controlling for playlist pitching, social campaigns and ad spend, found the isolated causal stream lift is roughly **1.5–2.2%** — artists who bother to upload a Canvas are also the ones doing everything else right. Sell Canvas as *table stakes for a professional release*, not as a growth hack. **[Grade B]**
- **Spotify for Artists remains upload-only — there is no first-party creation tool as of July 2026.** The platform-absorption risk is real but has not materialized. **[Grade A]**

### Apple Music Motion Art raises the bar — in ways that both help and constrain Latent

Verified against Apple's own Album Motion guidelines and distributor documentation (EmuBands, Symphonic, LabelGrid): **[Grade A]**

- **Two files, no audio:** 3:4 at 2048×2732 (phone album pages) and 1:1 at 3840×3840 (Mac/iPad/TV). H.264 or ProRes; **bitrate 45–100 Mbps**; 23.976/24/25/29.97/30 fps; Rec 709 or sRGB. Hand-reviewed by Apple; some distributors charge per release (Symphonic: $50).
- **Rules that endorse Latent's thesis:** first frame must match the static cover (a vague or black first frame is rejected); no frenetic/constant flashing; no multiple edits — "the animation should stay on album cover art"; must loop without visible jumps.
- **Rule that constrains it:** "No static imagery or stills, unless actively integrated into the animation." Near-imperceptible motion risks rejection just as strobing does. **Latent must target and validate a *motion band* — above the stills floor, below the flashing ceiling — and should surface both checks in-app.**
- **Engineering note:** a 45–100 Mbps encode at 3840×3840 is a serious client-side WebCodecs workload — meaningfully heavier than the 1080×1920 Canvas case. Feasible on desktop; expect failures on older phones. Position Apple Motion Art export as a desktop feature at launch.

### The calm thesis is a genre bet, not a universal one — the evidence is against it for open social feeds

- Every credible source on TikTok/Reels/Shorts distribution says the same thing: **the first ~3 seconds decide everything.** Influencer Marketing Hub: 71% of TikTok users decide whether to keep watching within three seconds. Hansen Insights (2026): TikTok widens distribution only if ~70%+ of a test sample watches through, with completion estimated at 40–50% of the ranking decision. Pattern interrupts and high-energy openers win cold distribution; calm subtle motion is their opposite. **[Grade B]**
- **Therefore calm positioning is a liability in the "make my song go viral" use case and an asset in the on-platform Canvas/Motion-Art use case.** Lean entirely into the latter.
- The calm-native audience is genuinely large: Lofi Girl ~15.8M YouTube subscribers (~2.6B views), Chillhop 3M+, Spotify's "lofi beats" 5M+ likes, with reported 340% playlist-follower growth since 2020 driven by functional/background listening. For this audience, non-distracting motion is a feature. **[Grade B]**

### Distribution economics context

- **DistroKid:** Musician plan now **$24.99/year** (verified July 2026; effective spend for active artists is typically $150–$300+/yr with add-ons like Content ID and Leave a Legacy). 2M+ artists; valued at $1.3B after the 2021 Insight Partners round (a ~$2B figure circulated mid-2026); estimated to handle roughly a third of all new music; ~70% of indie artists reportedly use it (Chartlex). **[pricing Grade A; artist counts/valuation Grade B]**
- The relevant insight: artists already pay $25–$300/yr to *distribute*; a $39–$79 one-time or ~$10/mo tool that makes every release look professional is within the same budget frame — but it must be obviously better than the free Canvas generator DistroKid bundles.

---

## Competitive landscape

### Spectrum/waveform visualizers (closest "look" competitors)

- **Specterr** — browser-based. Verified current tiers: **Free** (1 video/day, 720p/30fps, max 5 min, watermarked, videos expire after 10 days), **Pro ~$16.50/mo billed annually (~$198/yr**, 60 videos/yr, 1080p60, no watermark), **Unlimited ~$49/mo (~$588/yr**, 4K60, unlimited). Server-side render queue at peak; waveform/bars/particles aesthetic; traffic estimates ~44K–169K monthly visits depending on estimator. Weakness: generic bars-on-image look, expiring free videos, render queue. **[pricing Grade B — sources conflict on exact figures; direction is clear: more expensive than previously noted]**
- **CapCut** — free, massive template library explicitly branded "Spotify Canvas"; individual templates show tens of thousands of uses. The 800-lb commoditizer.
- **Renderforest, EchoWave, Vizzy.io, Kapwing, Veed.io, Wavve, Tuneform, Banger.Show, Visuval, MusicVid, Kaleidosync** — crowded freemium field, mostly waveform/spectrum overlays, $9–$60/mo. **Visuval** runs fully client-side (WebGL/Web Audio), no render queue, 1080p free export — the closest architectural analog to Latent, and proof the architecture alone is not a moat.
- **Canva, Headliner** — general-purpose giants that treat music visuals as a feature.

### AI generative music-video tools (the marketing-hype category)

- **Kaiber** — credit-metered: Starter $10/mo (500 credits), Creator $29/mo (1,500, commercial rights), Pro $99/mo (5,000). Bundles Kling/Veo/Luma/Runway models. Known complaints: credit drain, cancellation friction.
- **Neural Frames** — music-first, 8-stem audio reactivity; from ~$13/mo; top-model clips can cost thousands of credits. Deep audio-reactivity is its moat.
- **Runway** — Free (125 one-time credits), Standard $12/mo, Pro $28/mo, Max $76/mo; Gen-4.5 at 25 credits/sec. No native audio awareness.
- **Pika, Luma, Kling, Morphic, Deforum** — general generative video; credit-based; non-deterministic.
- **Shared structural weaknesses Latent exploits:** non-deterministic output that changes the artist's image; per-render compute cost that forces credit metering; cloud queues; uploading unreleased audio/art to a server. *(Competitor pricing moves frequently; figures are 2025–2026 sources — re-verify before quoting in marketing.)*

### Depth-parallax / "living photo"

- **Immersity AI (ex-LeiaPix)** — 3M+ users; credit-based from ~$4.99; 2D→3D depth parallax, 11 animation styles; named by Apple as a Motion Art vendor (alongside Canva and Rotor). Closest *conceptual* competitor — it moves the user's real pixels — but depth-driven, **not audio-reactive**. Audio-reactivity on your own pixels is Latent's unclaimed intersection.
- **Motionleap/Lightricks, Plotaverse, Pixaloop** — mobile living-photo apps; loops and overlays; not audio-driven.

### Professional/desktop (verified pricing, 2025–2026)

- **After Effects** $22.99/mo annual ($263.88/yr) / $34.49 month-to-month; **Trapcode Suite** (incl. Sound Keys) now subscription-only, $85/mo or $639/yr; **Resolume** Avenue €299 / Arena €799 perpetual; **TouchDesigner** free non-commercial (1280×1280 cap), $600 Commercial / $2,200 Pro; **Magic Music Visuals** $44.95/$79.95 perpetual; **Synesthesia** $199/$399 perpetual; **Butterchurn/MilkDrop/projectM** free/open-source but can't easily take a user's still → on-spec Canvas.
- **Takeaway:** every pro tool serves motion-graphics work, live performance, or generative programming. None offers "one still image → on-spec Canvas/Motion Art loop." That gap is Latent's opening.

### Platform-native / free

Spotify Canvas upload (no creation tool), **DistroKid's free Canvas generator** (royalty-free clip library — generic clips, not the artist's own cover), Apple Motion Art via distributor vendors, CapCut/Canva templates. Free and "good enough" for many — this is the commoditization floor Latent must clearly beat on *specificity* (your cover, your audio, guaranteed on-spec).

---

## Where Latent genuinely wins

1. **Determinism.** AI tools hallucinate; every render differs. Latent moves the *exact* uploaded pixels, identically every time — aligned with Apple's first-frame-matches-cover and stay-on-the-cover rules, and with how artists feel about album identity.
2. **Zero marginal render cost.** Client-side WebGL2 + WebCodecs means no per-render COGS. Unlimited exports at a flat or one-time price is a structural advantage credit-metered AI tools *cannot* match — their compute is a real cost.
3. **Privacy/local-first.** Audio never uploads — a concrete confidentiality benefit for pre-release music. (Demand size for this is an assumption, not a measured fact — flag it as such in marketing claims.)
4. **Speed.** No cloud queue; instant local preview and export. (Specterr's free tier even expires your videos after 10 days — a sharp contrast to "your files, on your machine, forever.")
5. **No-strobe by design / accessibility.** WCAG 2.3.1 (Level A) forbids flashing >3×/sec; 2.3.2 (AAA) forbids it entirely; DOJ's ADA Title II rule sets April 2027 compliance deadlines for public-sector web content; Apple rejects frenetic flashing. Hard amplitude caps and slew limiting make Latent structurally compliant — a marketable trust angle. **Pair it with a motion-visibility floor check so "calm" never fails Apple's no-stills rule.**
6. **Routing matrix as the "Pro" surface.** A routable analysis→effect matrix with drive/base controls, live meters and JSON preset import/export is a real power-user differentiator versus template shops — with acknowledged onboarding-complexity risk.
7. **Sounduz adjacency.** The existing audio-analysis app is a warm audience, shared DSP codebase, and a natural funnel (analyze → visualize).

## Where the approach is weak or at risk

- **"Calm" is a niche, not a market.** Only defensible inside genre- and spec-appropriate contexts (Canvas, Apple Motion, ambient/lo-fi/classical). Broad "go viral" positioning loses to CapCut and disappoints users.
- **Commoditization is the top risk.** CapCut, Canva, DistroKid ship free Canvas creation today; Kapwing/Canva/Adobe could add "audio-reactive subtle motion on your photo" in a sprint. Visuval already proves the client-side architecture. Durable defense = depth (routing matrix, DSP smoothing quality, on-spec loop perfection, spec validators, privacy, no-strobe) + community trust — not the base capability. **Assume the capability gets copied; build the parts that don't copy in a sprint: the validators, the preset ecosystem, and the audience.**
- **No AI = weaker marketing hook.** Convert it into the wedge — "your real art, never regenerated; deterministic; private" — rather than hiding it. The AI-tool credit-fatigue backlash is real and quotable.
- **Browser constraints are real but narrower than before.** WebCodecs reached full cross-browser support with Safari 26 (2025); Firefox still lacks AAC audio encoding — **irrelevant for the core product, since Canvas and Motion Art outputs are audio-stripped.** The real burden: long tracks + high-res offline encoding (especially Apple's 3840×3840 at 45–100 Mbps) will stress mobile Safari memory and low-end GPUs. Mitigate: cap durations, tier resolutions, make Apple-spec export desktop-first, degrade gracefully. Genuine support burden for a solo dev.
- **The still-plus-subtle-motion deliverable is too thin to charge for in the open market** — but exactly right where *spec compliance and the seamless loop are the value*. Keep the product framed as a deliverable-maker, not an art tool.
- **Copyright:** users uploading music they don't own is standard-ToS territory; local-first reduces exposure since nothing is stored server-side. *(Lightly sourced; the architectural mitigation stands regardless.)*
- **Distribution is the existential risk.** At 2–5% conversion, Latent needs large, cheap, repeatable top-of-funnel. Without a distribution engine (one community, SEO, then a distributor partnership), a superior product stalls.

---

## Recommendations

### Positioning statement

**"Latent turns your cover art into a calm, on-spec Spotify Canvas and Apple Music Motion Art loop — driven by your actual music, never regenerated by AI, rendered privately on your device."** Target the artist who cares about their visual identity and whose music is calm by nature.

### Beachhead (stage 1)

**Independent ambient / lo-fi / classical / jazz / meditation / sleep artists making Spotify Canvas + Apple Music Motion Art.** Rationale: calm motion is genre-appropriate and spec-favored (no strobing, stay-on-cover); these artists release frequently and value mood/aesthetic; the audience is huge (Lofi Girl ~15.8M subs); it sidesteps the unwinnable high-motion viral battle.

### Validation-first sequence (do this BEFORE the full build)

The original plan built first and measured later. Invert it:

1. **Weeks 1–2 — fake-door test.** Landing page with the positioning statement, a real demo Canvas made with the prototype, and a waitlist + "$39 founding unlock" pre-order button. Drive traffic from one lo-fi/ambient community and targeted SEO pages. **Pass: ≥100 waitlist signups or ≥10 pre-orders.**
2. **Weeks 2–4 — 10 problem interviews** with releasing artists in the beachhead genres: what do they use for Canvas today, have they had rejections/seam complaints, would they pay, one-time vs. subscription preference. **Pass: ≥5 of 10 describe the rejection/seam/watermark pain unprompted.**
3. **Only then** invest in the full app build. If both gates fail, the strategy's core assumption (free tools aren't "good enough" for this segment) is falsified — see kill criteria.

### Feature roadmap (sequenced, tied to findings)

1. **Nail the Canvas deliverable first.** One-click preset guaranteeing: 9:16, 3–8s, seamless loop (first frame = last frame = static cover), H.264 MP4, audio stripped, 1080×1920 (not higher — Spotify caps at 1080 tall). **Auto-validate against platform rules so uploads never get rejected** — this validator is the wedge and the hardest thing for template shops to copy credibly.
2. **Apple Motion Art preset, desktop-first:** dual 3:4 (2048×2732) + 1:1 (3840×3840) export, 45–100 Mbps, approved frame rates, first-frame-matches-cover check, **and a motion-visibility floor check** (Apple rejects stills) alongside the flash ceiling check.
3. **"No-strobe guaranteed" badge + accessibility mode.** Surface WCAG/photosensitivity compliance as an explicit, testable feature (PEAT-style flash check). Market to meditation/sleep/wellness and accessibility-conscious segments.
4. **Privacy/local-first messaging:** "your unreleased track never leaves your device" as a headline for artists on embargo.
5. **Routing matrix as the Pro surface** with JSON preset sharing — seed a preset library/community (user-generated presets drive retention and word-of-mouth, à la Carrd templates).
6. **Sounduz integration:** cross-link (analyze → one click to visualize), shared account, bundle pricing.
7. **Later: white-label/embeddable engine + API** pitched to a distributor (DistroKid, TuneCore, Symphonic) or label — zero-marginal-cost client-side rendering is ideal for embedding at scale, and Symphonic's $50/release Motion Art fee shows distributors monetize this today.

### Battles to fight vs. avoid

- **Fight:** on-spec loop perfection and validators, no-strobe/accessibility, privacy, determinism ("your real art"), pro control (routing matrix), calm-genre fit, price (unlimited local renders).
- **Avoid:** "go viral on TikTok," high-motion spectacle, generic waveform bars (CapCut/Specterr own this and it's free), and any head-to-head with generative AI on novelty.

### Pricing, monetization & unit economics

- **Freemium web app.** Free: watermarked and/or 720p, limited exports. Paid: watermark-free, 1080p+, all aspect ratios, routing matrix, preset library.
- **Lead with a one-time watermark-removal / lifetime unlock ($39–$79** — benchmarks: Tuneform $39.99 one-time, Magic Music Visuals $44.95 perpetual), plus an **optional $8–$12/mo subscription** for cloud preset sync and ongoing updates. Zero marginal render cost makes the one-time price sustainable in a way credit-metered competitors cannot copy; it's also anti-subscription positioning that resonates with credit-fatigued artists.
- **The math (model at the low end):**
  - Assume 3% free→paid, 70/30 split one-time ($49) vs. subscription ($10/mo, ~14-month average lifetime ≈ $140 LTV): blended revenue per paying user ≈ **$76**.
  - $2.5K/mo equivalent ($30K/yr) ⇒ ~395 paying users/yr ⇒ **~13K registered free users/yr** ⇒ ~1,100 signups/month. That is a real but achievable content/community target for a solo dev in months 6–18; it is *not* achievable from a Product Hunt spike alone.
  - Sensitivity: at 1% conversion the required funnel triples (~40K/yr) — which is why the <1% kill criterion matters.
- Watch Specterr's move upmarket (~$198/yr Pro, free videos that expire): it validates willingness to pay in the category and leaves a resentment gap Latent's one-time unlock exploits.

### Go-to-market for a solo dev

1. **One community first, deeply:** lo-fi/ambient Discords, r/WeAreTheMusicMakers, DistroKid/indie-artist forums. Ship the presets those communities ask for; recruit the first 10 interviewees there.
2. **SEO/content on exact high-intent pains:** "Spotify Canvas from your album cover," "Apple Music Motion Art without a designer," "seamless Canvas loop," "Canvas rejected why," "no-strobe Canvas." Low competition; AI tools under-serve these queries.
3. **Product Hunt launch** (proven solo-dev channel: DevUtils $6K/48h) with the launch asset itself being a beautiful Latent Canvas — after the community beachhead exists, so the spike lands on a durable funnel.
4. **Partnership motion:** pitch the embeddable engine to a distributor once consumer demand is validated.
5. **Leverage Sounduz's existing audience** as the warm launch list.
6. Solo-dev archetypes to copy: Carrd (constraint + word-of-mouth), Bannerbear (~$991K/yr, API for automated visuals — the model for the white-label play), ShipFast, DevUtils. Common pattern: niche focus, charge early, master one channel.

### Measurable milestones

- **Month 0–1:** fake-door landing page live; ≥100 waitlist or ≥10 pre-orders; 10 problem interviews done. *(Gate — do not build past this without passing.)*
- **Months 1–3:** on-spec Canvas export shipping with validator; first 100 activated users from one community.
- **Months 3–6:** 1,000+ activated users; ≥2% free→paid; Apple Motion Art desktop export; preset library live; first distributor conversation.
- **Months 6–18:** ~13K cumulative registered users and ~$2.5K/mo equivalent (≈205 subscribers or ≈500 one-time sales or the blended mix above); consistent with indie-dev benchmarks of 6–18 months to $10K MRR for the successful cohort.

### Evidence that would INVALIDATE the strategy

- Fake-door and interview gates both fail (free DistroKid/CapCut tools are "good enough" for the beachhead) — or paid conversion <1% after onboarding fixes.
- Spotify or Apple ships a first-party "animate your cover" button (not yet, as of July 2026 — Spotify for Artists remains upload-only).
- WebCodecs/mobile-Safari instability drives support load and refunds above solo-dev sustainability.
- The routing matrix confuses more users than it delights (test: activation rate on the Pro surface).
- Apple rejections of calm output cluster at the "too still" end — would force a rethink of how subtle the default presets can be.

---

## Caveats & evidence quality

- **Grading used throughout:** A = verified against current primary sources (July 2026); B = credible secondary sources; C = explicit assumption/estimate. The bottom-up market model is mostly C-grade by construction — its purpose is honest structure, not precision.
- **Top-down market-size figures for "music visualizer software" are unreliable and contradictory** ($170M–$2.8B for the same period); treat all as directional at best.
- **Spotify's Canvas lift stats are first-party marketing data.** Present them only alongside the Chartmetric-controlled ~1.5–2.2% figure.
- **Competitor pricing moves frequently** and varies by region/promo; Specterr's tiers in particular are reported inconsistently across sources (the ~$16.50/mo Pro figure is the most recent found). Re-verify any figure before it appears in marketing or a pitch.
- **Privacy-demand and copyright sections remain lightly sourced;** the local-first architectural benefit is real regardless, but the *size* of pre-release-confidentiality demand is an assumption.
- Traffic estimates (Specterr ~44K–169K monthly visits) come from third-party estimators that disagree; approximate only.
- Product-side claims (WebGL2 + WebCodecs architecture, routing matrix, Sounduz) describe the intended product and were taken as given; nothing in this document verifies implementation status.

---

## Revision notes (what changed and why)

1. **Added a one-page decision summary** so the document leads with the decision, not the evidence.
2. **Corrected the Apple Motion Art analysis** (verified against Apple's Album Motion guidelines): the spec bans *both* frenetic flashing *and* static stills, and demands 45–100 Mbps at 2048×2732 / 3840×3840. This turns "calm" from a pure asset into a band to engineer for — new motion-visibility validator requirement, and Apple export repositioned as desktop-first.
3. **Replaced reliance on contradictory top-down market sizes with a graded bottom-up funnel** ending in an implied paying-customer range, connected to unit economics.
4. **Added unit-economics math** (blended revenue per paying user, required funnel at 3% and 1% conversion) so the milestones are derived, not asserted.
5. **Inverted the sequence to validation-first:** a fake-door test and 10 problem interviews now gate the full build.
6. **Verified and updated facts:** DistroKid Musician $24.99/yr (was "verify before quoting"); Canvas specs confirmed with the 1080px-tall cap noted; Specterr's current pricing (~$16.50/mo Pro, expiring free videos) replacing older figures; Chartmetric 1.5–2.2% lift confirmed; Spotify for Artists confirmed upload-only (absorption risk not yet materialized); WebCodecs Safari-26 support confirmed — and noted that audio-encoder gaps are irrelevant because Canvas/Motion Art outputs are audio-stripped.
7. **Added evidence-confidence grading (A/B/C)** on load-bearing claims.
