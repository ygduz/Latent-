# Latent — Implementation Plan (Milestone 1: Core Engine + Minimal UI)

## Context

Latent is a greenfield app. Strategy (see `../market-analysis.md`): a calm, deterministic, **fully client-side** tool that turns a track's cover art into an on-spec **Spotify Canvas** loop (Apple Motion Art comes later), driven by the artist's actual audio, rendered privately in the browser. Decisions locked with the owner:

- **Scope of milestone 1:** core engine + minimal UI. Upload cover art + audio → calm audio-reactive motion → perfect seamless-loop 9:16 MP4 export → built-in spec validator. **No accounts, no payments, no watermarking, no Apple export yet.** The output doubles as the demo asset for the later landing page.
- **Stack:** React + TypeScript + Vite for the shell. The engine is **plain TypeScript with zero React dependencies** so it can later be white-labeled/embedded (the distributor play).
- **Motion range:** Canvas-first — very subtle presets are allowed (Spotify has no "no stills" rule). The Apple motion-visibility floor check ships later with Apple export.

## Architecture

```
/ (repo root)
  index.html, vite.config.ts, tsconfig.json, package.json
  src/
    engine/                  # framework-agnostic — NO React imports allowed here
      analysis/
        analyzer.ts          # decode audio (OfflineAudioContext) → per-frame FeatureTimeline
        features.ts          # smoothing, slew limiting, normalization, hard amplitude caps
      render/
        renderer.ts          # WebGL2 renderer: draws cover texture + effect passes for time t
        effects/             # one module per effect (see Effect set)
        shaders/             # GLSL (imported as strings via vite ?raw)
      loop.ts                # loop-segment math: feature crossfade + phase-periodic motion
      presets/
        schema.ts            # JSON preset schema (versioned)
        builtins.ts          # the calm preset family
      export/
        encoder.ts           # deterministic frame loop → WebCodecs VideoEncoder → MP4
        validator.ts         # Canvas spec + flash + seam checks
      types.ts
    app/                     # React shell
      App.tsx
      components/
        DropZone.tsx         # image + audio file intake (drag/drop + picker)
        PreviewCanvas.tsx    # live WebGL preview, plays audio synced to timeline
        SegmentPicker.tsx    # waveform strip; drag a 3–8 s loop window
        PresetPicker.tsx     # preset cards with hover-preview
        ControlPanel.tsx     # per-preset macro sliders (Amount / Speed / Response)
        ExportPanel.tsx      # export button, progress, download
        ValidatorReport.tsx  # pass/fail checklist rendered after export
      store.ts               # zustand
    main.tsx
  tests/                     # vitest unit + Playwright e2e
  docs/implementation-plan.md (this file)
```

## Key technical decisions

1. **Offline, deterministic analysis — not realtime AnalyserNode.** Decode the full track with `AudioContext.decodeAudioData`, then compute a `FeatureTimeline`: per-video-frame (30 fps) features — RMS, low/mid/high band energy, spectral centroid/flux — via FFT over the raw PCM. Determinism is a product promise ("same input, same output, every time"), and it decouples export from playback. Preview simply plays the audio and samples the same timeline.
2. **Seamless loop by construction, not by luck.** The user selects a 3–8 s window. The feature timeline for the window is loop-blended (last ~500 ms crossfaded into the first) and all autonomous motion (drift, breathing) uses phase-periodic functions of `t/duration`, so **frame N == frame 0 bit-for-bit**. First frame is the untouched cover art (future-proofs Apple's first-frame rule).
3. **Calm-by-design in the engine, not the UI.** `features.ts` applies slew limiting (max delta per frame) and hard amplitude caps before any effect sees a value — so no preset or slider combination can strobe. This is the "no-strobe guaranteed" claim, enforced structurally.
4. **Export = re-render, not capture.** A deterministic offline loop renders each frame at exact timestamps to the WebGL canvas, wraps it in a `VideoFrame`, feeds WebCodecs `VideoEncoder` (H.264 `avc1.42…`/`avc1.64…`, 1080×1920 @ 30 fps, ~8–12 Mbps), muxes with **`mp4-muxer`** (small, no wasm). No audio track (Canvas spec). Requires Chrome/Edge 94+, Safari 26+; Firefox 130+ has VideoEncoder (H.264 support to be feature-detected at runtime — show a friendly capability notice, never a crash).
5. **Validator as a first-class feature** (`export/validator.ts`), run on every export and shown as a pass checklist: 9:16 ratio; 720–1080 px tall; 3.0–8.0 s duration; MP4/H.264; no audio track; **seam check** (pixel-diff first vs. last rendered frame ≈ 0); **flash check** (luminance-delta analysis across frames, fail > 3 flashes/sec per WCAG 2.3.1). This checklist is the marketing wedge — make it visually prominent.
6. **Routing lives in the engine from day one, hidden in the UI.** Presets internally are `{routes: [{source: feature, target: effectParam, base, drive, smooth}]}`. Milestone 1 exposes only three macro sliders per preset; the later Pro routing-matrix UI edits the same structure — no engine rework.

## Effect set (calm family, milestone 1)

Each effect exposes `base` + `drive` (audio-modulated) parameters; all are loop-phase-aware:

1. **Breathe** — slow scale oscillation (Ken Burns-like), RMS-driven depth.
2. **Drift** — sub-pixel translation on a closed Lissajous path (returns to origin at loop end).
3. **Glow** — bloom pass whose intensity follows low-band energy (heavily slewed).
4. **Grain** — animated film grain, high-band-modulated amount.
5. **Ripple** — gentle displacement-map liquid motion, mid-band-driven.
6. **Vignette breathe** — vignette radius follows RMS.

Built-in presets combine these: *Still Water* (drift+vignette), *Ember* (glow+grain), *Tide* (ripple+breathe), *Dust* (grain+drift), *Pulse* (glow+breathe, the most visible one — Apple-safe candidate).

## Build order

1. **Scaffold** — Vite + React + TS + vitest + Playwright config; CI-less for now; `npm run dev/build/test/e2e`.
2. **Intake + static render** — DropZone, image → WebGL texture, cover displayed letterboxed in 9:16 stage.
3. **Analysis pipeline** — analyzer + features with unit tests (synthetic PCM fixtures: silence, sine, click train → assert smoothing/caps).
4. **Effects + presets** — renderer passes, the six effects, preset schema + built-ins, live preview with audio playback.
5. **Loop segment picker + loop math** — waveform strip UI; unit-test that motion state at t=0 equals t=duration.
6. **Export + validator** — encoder, mp4-muxer, progress UI, download; validator checklist; determinism test (two exports of same input → identical frame hashes).
7. **Polish** — preset hover-previews, capability detection notice, README with screenshots, deploy static build (Netlify/GitHub Pages) as the shareable demo.

## Dependencies (all client-side, no server)

`react`, `react-dom`, `zustand`, `mp4-muxer` — runtime. `vite`, `typescript`, `vitest`, `@playwright/test` — dev. No CSS framework needed at this size; hand-rolled dark UI (aesthetic matters — the app is the brand).

## Verification

- **Unit (vitest):** feature smoothing/slew caps, loop-blend math (state(0) == state(duration)), validator rules against crafted good/bad inputs.
- **E2E (Playwright, pre-installed Chromium):** load app → upload fixture PNG + short WAV → pick segment → export → assert a downloaded MP4 exists; parse it (mp4-muxer output via `mp4box`-style box walk or re-decode with VideoDecoder in the page) to assert 1080×1920, 30 fps, duration in 3–8 s, zero audio tracks.
- **Determinism check:** export twice in the e2e run, compare per-frame hashes.
- **Manual:** upload a real MP4 to Spotify for Artists as the final acceptance test (owner action).

## Explicitly out of scope for milestone 1

Apple Motion Art export (incl. motion-visibility floor check), watermarking/free-tier limits, payments/accounts, routing-matrix UI, preset sharing/community, Sounduz integration, mobile-Safari long-track hardening (feature-detect and message instead).
