# Engineering decisions

Short records of choices that shape the code. Newest at the bottom.

## ADR-001: CSS Modules with CSS variable tokens

**Context.** The UI needs a fully custom look on top of Radix primitives, with light, dark and accent themes switched at runtime.
**Decision.** CSS Modules per component. Every color, size, radius and duration is a CSS variable in `src/renderer/src/styles/tokens.css`; themes and accents swap variables through `data-theme` and `data-accent` on `<html>`. No Tailwind.
**Consequences.** Theme switches cost one attribute change and no re-render. Styles live next to their component. New colors must be added as tokens, not inline.

## ADR-002: GPL-3.0-or-later (replaced by ADR-067)

**Context.** The app ships FFmpeg builds that include x264 and x265, which makes the distribution GPL.
**Decision.** License Lumacut as GPL-3.0-or-later. List every bundled third-party component in `THIRD_PARTY_NOTICES.md` and ship FFmpeg's own license text next to the binaries.
**Consequences.** Every new dependency must be GPL-compatible (MIT, BSD, Apache-2.0, ISC, LGPL, MPL-2.0 are fine).

## ADR-003: Pinned FFmpeg builds with SHA-256 checks

**Context.** Export and import depend on FFmpeg and FFprobe. The system copy can't be relied on across distributions and OSes.
**Decision.** `scripts/fetch-binaries.mjs` downloads static GPL builds from BtbN/FFmpeg-Builds (release branch n8.1), pinned to one dated autobuild tag and one SHA-256 per target in `scripts/binaries.json`. A mismatch deletes the file and stops. Upstream deletes old autobuilds after a while, so `--repin` pins the newest build of the same branch, taking hashes from upstream's `checksums.sha256`; the resulting diff is reviewed like any code change. Packaged apps carry the binaries in `resources/bin`.
**Consequences.** Linux and Windows (x64, arm64) are covered. BtbN has no macOS builds; a macOS source is chosen in the release phase. Each package grows by about 100 MB compressed.

## ADR-004: Theme follows the system, dark surfaces are graphite

**Context.** Editors spend hours looking at footage; a dark surround keeps attention on the picture. Some people still want light.
**Decision.** Default theme is "Match system", with Light and Dark options. Dark uses neutral graphite (#141518 to #26272c) with no tint, so it doesn't shift perceived color in footage. One accent at a time (amber by default, five more to pick from). Text colors hold 4.5:1 on panels in both themes.
**Consequences.** Accent tokens come in pairs: `--accent` for fills and `--accent-text` tuned per theme for text.

## ADR-005: One IPC contract, validated on both sides

**Context.** The renderer is sandboxed and must not reach the file system or processes directly.
**Decision.** `src/shared/ipc.ts` declares every channel with zod request and response schemas. The preload validates outgoing requests and incoming responses; the main process validates requests again, checks that the sender frame is the app's own page, and validates its own responses. Unknown channels are rejected in the preload.
**Consequences.** Adding a feature that needs the main process means adding one entry to the contract and one handler; TypeScript fails the build if a handler is missing.

## ADR-006: Unfinished workspaces stay out of release builds

**Context.** The product rule is "nothing fake": no dead buttons or placeholder screens in what people download.
**Decision.** `src/renderer/src/lib/features.ts` lists the finished workspaces. Development builds show every workspace; release builds show only the finished ones, and the workspace switcher hides itself while only one exists.
**Consequences.** Finishing a workspace means adding it to `BUILT_WORKSPACES` in the same change.

## ADR-007: Window chrome per platform

**Context.** The editor needs the full window height and a title bar that matches its surfaces.
**Decision.** macOS keeps native traffic lights (`hiddenInset`) and sidebar vibrancy. Windows and Linux use a frameless window with a custom title bar: draggable region, minimize, maximize/restore and close, double-click to maximize (handled by the app on Linux, natively on Windows). Windows gets Mica. Linux uses solid surfaces: translucency through the compositor is unreliable under Wayland and costs GPU time during playback.
**Consequences.** Window state changes (maximize) are pushed to the renderer as an event so the restore icon stays correct.

## ADR-008: Electron 44 line

**Context.** Electron 45.0.0 was published three days before the project started.
**Decision.** Start on the newest 44.x and move to 45 once it has a few patch releases.
**Consequences.** Recheck before the 1.0.0 release.

## ADR-009: Only main-process runtime libraries are dependencies

**Context.** electron-builder copies everything in `dependencies` into the package, but the renderer is already bundled by Vite.
**Decision.** Renderer libraries (React, Radix, Zustand, icons, fonts) are dev dependencies. `dependencies` holds only what the main process loads at runtime.
**Consequences.** Smaller packages. A library imported by main must be listed in `dependencies`, or the packaged app fails to start; the packaged-app smoke check catches this.

## ADR-010: Placeholder app icon

**Context.** Packages need an icon to show in app grids, and no brand mark exists yet.
**Decision.** A plain placeholder: an "L" on a graphite square crossed by an amber playhead line, in `resources/icons/icon.svg`.
**Consequences.** Replace `icon.svg` and regenerate the PNGs when a real mark exists.

## ADR-011: Clip positions in whole frames, edits overwrite

**Context.** Cuts must land on exact frames, and float seconds drift after many edits.
**Decision.** Clip `start`, `duration` and `sourceIn` are integers counted in the sequence's frame rate. Placing, moving or trimming a clip overwrites whatever it lands on: covered clips are removed, partly covered ones are trimmed, and a clip dropped into the middle of another splits it. Ids for any split-off halves are part of the command, so replaying a command gives the same result. Because positions are in frames, the frame rate can only change while a sequence is empty.
**Consequences.** Ripple, roll, slip, slide and magnetic mode (P2) are new commands on the same model. Variable frame rate sources are conformed to the sequence rate at export.

## ADR-012: Undo by diffing, not hand-written inverses

**Context.** Every edit must be undoable, including batches produced by the AI tools later, and hand-written inverse functions are easy to get wrong.
**Decision.** Commands only describe how to apply themselves. After a command runs (inside Immer), `inverseOf` compares the project before and after, using Immer's structural sharing to find changed clips, media and sequence settings, and builds a restore command from the old values. A `batch` command is one undo step.
**Consequences.** New command types get undo for free as long as their changes live in media, clips or sequence settings. Anything new that becomes part of the project must be added to `inverseOf`.

## ADR-013: Preview with media elements first

**Context.** The target preview is WebCodecs decoding into a WebGL2 compositor. That is needed for effects, multiple video layers and color work (P3, P4), but not for cutting a single video track.
**Decision.** For now the viewer drives one `<video>`, one `<img>` and one `<audio>` element from a single clock (`performance.now()` while playing). Each element is pointed at the clip under the playhead and re-seeked when it drifts more than 120 ms. Media reaches the page through the `lumacut-media://` scheme, which supports byte ranges and only serves files that were imported or belong to an opened project, plus cached thumbnails.
**Consequences.** Codecs Chromium can't decode (ProRes, DNxHR, some HEVC) don't preview yet; proxies (P2) and the WebCodecs path (P3) fix that. Cuts between clips can show a brief stall while the element seeks.

## ADR-014: Export through one FFmpeg filter graph

**Context.** Preview and export should share one render graph, which doesn't exist until the compositor lands.
**Decision.** Until then, export builds a single FFmpeg command: one input per clip (seeked with `-ss`/`-t`, which is frame-accurate when re-encoding), each conformed to the sequence size, frame rate and 48 kHz stereo, gaps filled with black and silence, joined with `concat`, and audio-track clips delayed into place and mixed with `amix`. Output is H.264 (x264, CRF 18) with AAC in MP4. Progress comes from `-progress pipe:1`.
**Consequences.** Export matches the cut exactly but can't include effects; when the compositor exists, export switches to rendering its frames and piping them to FFmpeg.

## ADR-015: The first video sets the sequence format

**Context.** New sequences start at 1920×1080, 30 fps, which rescales and conforms footage that doesn't match.
**Decision.** When the first video goes into an empty sequence, the sequence takes that video's size and frame rate, in the same undo step. The inspector shows sequence size presets (16:9, 9:16, 1:1, 4:5, 21:9) and frame rates; the rate is locked once clips exist.
**Consequences.** A 4K 29.97 fps clip makes a 4K 29.97 fps sequence. People who want a vertical cut pick 9:16 in the inspector.

## ADR-016: Project format version 2, linked picture and sound

**Context.** J and L cuts, separate audio edits and audio-only tracks need a clip's sound to be its own clip.
**Decision.** Video clips no longer play sound. Placing media with sound creates a picture clip and a sound clip that share a `linkId`; linked clips select, move, trim, split and change speed together unless Alt is held or linked selection is off. Version-1 projects are migrated: each video clip with sound gets a linked clip on a new audio track. Tracks gained lock, mute, solo, hide and height; clips gained speed, reverse, ramp, interpolation, group and multicam angle; sequences gained markers, in/out points, magnetic mode and target tracks.
**Consequences.** Drops pair tracks by number (V2 with A2, creating it if needed) so a clip's sound never lands on unrelated audio.

## ADR-017: Undo restores whole objects

**Context.** P2 added many commands that touch tracks, markers and settings, not just clips.
**Decision.** The inverse of any command is `restore`: the previous version of every sequence and media item that changed. Immer shares untouched data between versions, so this costs references, not copies. Split-off clips get ids derived from the clip they came from (`clp_x~1`), so replaying a command on the same project gives the same ids.
**Consequences.** New command types need no undo code. Switching the open sequence is a view change and doesn't enter the history.

## ADR-018: Magnetic mode keeps V1 gapless

**Context.** People coming from Final Cut expect the main track to close up on its own.
**Decision.** With magnetic mode on, V1 clips always sit back to back. Removing, trimming or changing the speed of a V1 clip closes the gap; dropping or moving onto V1 inserts at the nearest boundary between clips; clips linked to a V1 clip move with it. Other tracks behave as in classic mode.
**Consequences.** Linked clips that move with V1 can overwrite what they land on in their own tracks, the same as a manual move.

## ADR-019: Speed, ramps and reverse

**Context.** Speed changes must look the same in the viewer and the export.
**Decision.** A clip's source position is the area under its speed curve: constant speed, or a ramp of straight segments between points. Reverse reads the same range backwards; speed 0 holds one frame. The viewer sets the media element's playback rate to the speed under the playhead and seeks for reverse and holds. Export cuts ramped clips into fifth-of-a-second pieces of constant speed and uses `setpts`, `reverse`, `atempo` and `areverse`; frame blending and optical flow use FFmpeg's `minterpolate` on slowed clips.
**Consequences.** Reverse holds a clip's frames in memory during export, so very long reversed clips use a lot of RAM. Interpolation only shows in the export.

## ADR-020: Nested sequences and multicam as sequence items

**Context.** Compound clips, nested sequences and multicam all put one sequence inside another.
**Decision.** Every sequence has an item in the media list (`kind: 'sequence'`). Placing it creates clips that point at the sequence. Compound clips move the selected clips into a new sequence; multicam clips are sequences with one video and audio track per angle, lined up by cross-correlating the files' loudness envelopes (100 per second, up to two minutes apart), and the clip's `angle` picks which video track shows. The viewer resolves nesting recursively to find the picture and sounds under the playhead; export builds nested sequences into the same FFmpeg graph. Nesting a sequence inside itself is refused.
**Consequences.** Other angles of a multicam sequence start muted. Sync by sound needs every angle to have audio; otherwise angles line up at their starts.

## ADR-021: Proxies are a local cache

**Context.** 4K and codecs Chromium can't decode (ProRes, DNxHR) don't play smoothly or at all.
**Decision.** Proxies are 720p H.264 files with a keyframe every half second, made in a background queue and stored in `~/.cache/Lumacut/proxies`, named by a hash of the original's path, size and modified time. They are not part of the project file. The viewer plays them when they exist and proxies are on; export always reads the originals. By default, media Chromium can't play gets a proxy on import.
**Consequences.** Moving a project to another computer means proxies are rebuilt there. Deleting the cache is always safe.

## ADR-022: Autosave and crash recovery

**Context.** An editor that loses an evening of work is not usable.
**Decision.** While a project has unsaved changes, a copy is written every minute to the app data folder's `autosave/`, keeping the last ten per project. A `running.lock` file marks an unclean exit; on the next start, autosaves newer than their project file are offered for restore. Saving or discarding a project removes its autosaves. File > Restore an earlier version lists them at any time.
**Consequences.** Restored work counts as unsaved until saved over the original.

## ADR-023: One WebGL2 compositor for viewer and export

**Context.** Effects, masks, titles, blend modes and transitions must look the same in the viewer and in the exported file.
**Decision.** `buildScene` (pure TypeScript) turns a frame into an ordered list of layers, transitions and adjustment layers with every keyframe already evaluated. `Compositor` (WebGL2) draws that list: each picture is uploaded and converted once to premultiplied, bottom-up form; source-space effects run as shader passes; the picture is placed with its crop, mask and transform; frame-space effects (drop shadow, outline) follow; layers are combined with the W3C blend formulas. The viewer feeds it browser-decoded video elements; export feeds it frames decoded by FFmpeg. Masks and titles are drawn with Canvas 2D and uploaded as textures.
**Consequences.** A golden-frame test renders a scene through the export path and compares it with stored frames, and compares the viewer's canvas with the exported frame. WebGPU can replace the backend later without touching the scene model.

## ADR-024: Two export paths

**Context.** Rendering every frame through the GPU and reading it back costs time that plain cuts don't need.
**Decision.** `needsCompositor` checks whether a sequence (including nested ones) uses any transform, effect, mask, blend mode, generator or transition. If not, export uses the FFmpeg-only graph (ADR-014). Otherwise a hidden window runs the compositor: one FFmpeg decoder per visible clip streams raw RGBA frames through `lumacut-media://decode/<token>`, the window composites each frame and sends it to an FFmpeg encoder over stdin, with back-pressure, while the encoder mixes the sound from the clips as before.
**Consequences.** Exports with effects are slower, especially at 4K, where each frame is read back from the GPU. Profiling and a YUV readback are planned for the performance pass.

## ADR-025: Color matrices for decoding and encoding

**Context.** Raw RGB from FFmpeg must match what Chromium shows, and exported files must be tagged so players decode them right.
**Decision.** Decoders convert with Rec. 709 for pictures 720 lines or taller and Rec. 601 below, full-range output. The encoder converts RGBA to limited-range Rec. 709 YUV and tags the stream `bt709`.
**Consequences.** Files tagged with other matrices (HDR, wide gamut) are not handled yet; the color-managed pipeline in P4 replaces this rule. Superseded in part by ADR-028.

## ADR-026: Effect sizes in frame pixels; stabilization by placement

**Context.** A blur radius should look the same whether a clip is 4K, 720p or scaled down in a picture-in-picture.
**Decision.** Pixel parameters are measured in full-size sequence pixels and converted to source pixels with the clip's fit and scale. Stabilization measures frame-to-frame motion (block matching on a 480-pixel-wide copy, median shift and least-squares rotation), smooths the path, and applies the difference as an extra move, turn and zoom on the clip's placement rather than warping pixels.
**Consequences.** Stabilizing never resamples twice. Rolling-shutter wobble and perspective shake aren't corrected.

## ADR-027: Point tracking first

**Context.** The spec asks for point and planar tracking.
**Decision.** Point tracking follows a patch with normalized cross-correlation, a velocity prediction and a slowly refreshed template. It keys a mask to follow the point, and other clips can copy that motion into their position (titles that ride along with something filmed). Planar tracking, which also follows scale, rotation and perspective, comes later. Tracking and stabilizing require clips at 100% speed, playing forward, because analysis reads the file directly.
**Consequences.** Objects that turn or change size a lot need keyframe fixes after tracking.

## ADR-028: Color management through FFmpeg zscale

**Context.** Footage arrives as Rec. 709, Display P3, Rec. 2020, PQ or HLG, and sequences can target any of them. Matching the viewer and export means one place that knows how to convert.
**Decision.** Probing records each file's primaries, transfer, matrix and range. Every sequence has a color space (Rec. 709, P3, Rec. 2020) and a dynamic range (SDR, PQ, HLG); choosing HDR sets Rec. 2020. When a source differs from the sequence, `colorChain` builds a zscale chain: linearize, change primaries, apply the target transfer. HDR to SDR tone maps with Hable; SDR placed in an HDR sequence maps reference white to 203 nits. The encoder tags the stream with the sequence's color, and HDR sequences export 10-bit HEVC.
**Consequences.** Conversions are tested against FFmpeg itself. Mastering display metadata (MaxCLL, MaxFALL) isn't written yet.

## ADR-029: Float compositing for HDR, SDR preview

**Context.** PQ and HLG values above SDR white are lost in an 8-bit pipeline.
**Decision.** HDR sequences decode to 16-bit RGBA, upload as half-float textures and composite in RGBA16F targets; readback returns 16-bit values to a 10-bit encoder. The viewer draws the same float result tone-mapped for an SDR display, and it plays HDR and wide-gamut sources through proxies that are already converted to the sequence's color.
**Consequences.** HDR export is slower than SDR. The viewer is an SDR preview of an HDR grade, not an HDR monitor; the scopes read the graded values before that tone map.

## ADR-030: Grades as a stack of layers

**Context.** Color tools need to combine primaries, curves, looks and isolated corrections without a node graph on day one.
**Decision.** A clip's grade is an ordered list of layers. Each layer is a primary (lift, gamma, gain, offset, exposure, contrast with pivot, saturation, temperature and tint), curves (RGB, and hue against hue, saturation and luma) or a LUT. Any layer can carry a qualifier (hue, saturation and luma range, softness, invert) and a mix. The compositor runs one shader pass per layer after the clip's effects. Copy and paste moves a whole stack between clips.
**Consequences.** Parallel and layer-mixer nodes aren't possible yet; the stack covers serial grading, which is what most edits need.

## ADR-031: Built-in looks are code, imported LUTs are .cube files

**Context.** Shipping LUT files means checking their licenses and storing binary blobs in the repository.
**Decision.** Built-in looks are small color functions in `src/engine/looks.ts`, baked to 33-point 3D LUTs when used. Users can import any `.cube` file; the project stores its path, and the parser accepts 1D and 3D tables with domain lines.
**Consequences.** Every bundled look is original work under the project license. A project that uses an imported LUT needs that file on the other computer, like any other media.

## ADR-032: Scopes on the GPU

**Context.** Scopes computed on the CPU for every frame block the interface at 4K.
**Decision.** The compositor keeps its last frame. A scope pass draws one point per sampled pixel into a float target with additive blending (waveform, RGB parade, vectorscope with Rec. 709 targets), and a log tone map turns counts into brightness. The histogram uses the same pass with points placed in 256 bins per channel, sampled on a grid up to 480 pixels wide. The result is drawn into a 2D canvas with labels.
**Consequences.** Scope accuracy is tested with test patterns: 50% gray lands on the 50 line, and 75% red lands on its vectorscope target, both within two pixels.

## ADR-033: Automatic corrections from frame statistics

**Context.** Auto white balance, auto exposure and shot matching should be predictable and undoable.
**Decision.** FFmpeg extracts one frame at the playhead; `frameStats` measures each channel's mean and spread and the 1st and 99th brightness percentiles. Auto balance sets per-channel gain so the average comes out gray (gray world); auto exposure stretches the percentiles to 3% and 95% with master gain and offset; match moves another clip's channel means and spreads onto this one (a Reinhard transfer in RGB). Each writes a normal primary layer through the command bus.
**Consequences.** A frame dominated by one color, a sunset for example, balances poorly; the result is an ordinary layer the user can adjust or delete.

## ADR-034: One sound engine, checked against FFmpeg

**Context.** The plan names Web Audio with AudioWorklet for playback and an OfflineAudioContext for mixdown. Mixing down in the renderer means decoding every file into memory, and it would put two different code paths behind the same effect.
**Decision.** Export mixes in FFmpeg, in the same command that encodes the picture, so long timelines stream from disk. Preview runs the effects in an AudioWorklet whose code (`src/audio/dsp.ts`) follows the FFmpeg filters export uses: RBJ biquads for the EQ, ports of `acompressor` and `agate`, a limiter that is the compressor with an instant attack, and a de-esser that splits at a Linkwitz-Riley crossover (`acrossover`) and compresses the top band. Unit tests run both on the same signal; they agree within 1% RMS. Reverb is a convolution with an impulse generated from a seed, written as a WAV file for FFmpeg's `afir` and loaded into a ConvolverNode for preview.
**Consequences.** Adding an effect means writing it twice and adding it to the comparison test. Inside a nested sequence, preview applies each clip's own level, pan and effects and the outer clip's level, but not the inner sequence's track and master settings; export applies all of them.

## ADR-035: Mix order and pan law

**Context.** Preview and export must agree on what happens in which order.
**Decision.** A clip's sound runs through its effects, then gain plus the keyframable volume (both in dB), then linear fades, then pan. A track runs through its effects, then its fader, then pan; the master does the same after the tracks are summed. Pan follows Web Audio's StereoPannerNode for stereo input, and export writes the same matrix with FFmpeg's `pan` filter. Mono files are sent to both sides at full level, as browsers play them, instead of FFmpeg's default 3 dB lower upmix. Volume keyframes become straight dB segments in a `volume` expression; eased keys are split into eight steps.
**Consequences.** Pan isn't keyframable yet. The loudness target lives on the sequence until the export dialog in P8.

## ADR-036: Loudness metering and normalization

**Context.** Exports must hit -14, -16 or -23 LUFS within 0.5 LU.
**Decision.** The meters use a BS.1770-4 meter written in TypeScript (K-weighting, 400 ms and 3 s windows, gated integrated loudness), tested against FFmpeg's `ebur128` to 0.1 LU. With a target set, export first runs an audio-only pass through FFmpeg's `loudnorm` to measure the mix, then applies the difference as one gain, with a -1 dBFS limiter only when that gain would push peaks over.
**Consequences.** Loudness range is kept as mixed; nothing is compressed to reach the target. AAC encoding moves the measured loudness by up to about 0.3 LU, which the tests allow for.

## ADR-037: Ducking from track roles

**Context.** Auto ducking needs to know which sound is speech and which is music.
**Decision.** Audio tracks get a role: dialogue, music or effects. Ducking reads the cached waveform peaks of the dialogue clips, marks where they pass -32 dBFS (holding through pauses under 0.4 s), and writes volume keyframes on every music clip: down by the chosen amount with 0.3 s ramps. It is one undoable change, and the keyframes stay editable.
**Consequences.** Level-based detection treats any loud sound on a dialogue track as speech; voice detection by a model can replace it in P6.

## ADR-038: Beat markers

**Context.** Cutting to music needs beat positions.
**Decision.** FFmpeg decodes the clip's range to mono; an onset curve from spectral flux gives the tempo by autocorrelation (60 to 200 BPM, weighted towards 120), and beats are placed one period apart and pulled to the strongest nearby onset. They become yellow markers; "Cut at markers" splits the clip and its linked clips at every marker inside it.
**Consequences.** Music that changes tempo drifts from the grid. Beats are found only on clips at normal speed, playing forward.

## ADR-039: Voiceover recording

**Context.** Recording straight into the timeline needs the microphone and a file that FFmpeg and the viewer both read.
**Decision.** MediaRecorder records Opus in WebM while the timeline plays from the playhead. The take is converted to a 48 kHz WAV file (the recorder's WebM has no duration in its header) in a `Recordings` folder next to the project, or in the app data folder for an unsaved project, then imported and placed on the targeted audio track in one undoable step. The microphone is the only permission the app grants, and only to its own pages, with echo cancellation, noise suppression and automatic gain turned off.
**Consequences.** Playback is heard while recording, so headphones avoid recording it again.

## ADR-040: Local AI runtime

**Context.** The plan names whisper.cpp for speech and ONNX Runtime for vision models. whisper.cpp publishes no Linux binaries, and the FFmpeg build Lumacut bundles is compiled without its whisper filter.
**Decision.** Speech and matting both run through Transformers.js on onnxruntime-node, on the CPU, inside an Electron utility process so the app stays responsive. Whisper models with word timestamps come as ONNX exports. Frames for matting are scaled by FFmpeg and turned into tensors directly, because the image helpers go through sharp, which crashes inside Electron on Linux. Native modules are unpacked from the app archive, and the ONNX Runtime binaries for other platforms are removed after packing.
**Consequences.** One runtime covers every model and every platform. No GPU acceleration yet; Whisper base transcribes about five times faster than real time on a laptop CPU.

## ADR-041: Model downloads

**Context.** Models are too large to bundle, and they must be trustworthy and usable offline.
**Decision.** `src/shared/models.json` lists each model's files, pinned to a commit, with SHA-256 and size. Settings > AI models downloads a model on request; each file is written next to its final name and renamed into place only after its checksum matches. Remote model loading is switched off in the runtime, so once a model is present nothing reaches the network. `pnpm fetch:models` fills the same folder.
**Consequences.** Updating a model means changing the catalog. The e2e test transcribes with the network cut off.

## ADR-042: Captions as a sequence track

**Context.** Captions need word timing (karaoke, editing by text), styling, burn-in and sidecar files.
**Decision.** Each sequence has one caption track: cues in sequence frames, each with its timed words, plus a style (template, size, colours, height, capitals) and a switch for showing them. The scene builder adds the current cue as the top layer, so the viewer and exports draw it the same way; turning the switch on burns captions into exports. SRT, WebVTT and ASS are written and read by `src/engine/captions.ts`; ASS keeps the style and the karaoke timing.
**Consequences.** Captions don't follow ordinary clip moves; taking time out (editing by text, removing silences) moves them. A second caption track for translations comes with P7.

## ADR-043: From transcript to timeline

**Context.** Transcription is slow compared with editing, and the same file often appears in several clips.
**Decision.** Whole files are transcribed once per model and language, and the result is cached by file. Words are placed where each clip plays them, using dialogue tracks when any are marked, otherwise every audible audio track. Editing by text takes the chosen words' time out of every track, in one undoable step.
**Consequences.** Clips at changed speed or playing backwards are left out of the transcript.

## ADR-044: Processed copies for voice cleanup and background removal

**Context.** Both effects are too heavy to run live in the viewer.
**Decision.** They make a new file and point the clip at it, in one undoable step. Voice cleanup runs FFmpeg's `arnndn` with the RNNoise speech model to a WAV file. Background removal runs MODNet on every frame and writes a VP9 WebM with an alpha plane. Files go in a `Processed` folder next to the project. Media with alpha is decoded with libvpx (FFmpeg's own VP9 decoder drops alpha), never gets a proxy, and sends exports through the compositor.
**Consequences.** Processing takes time once, then plays like any other file. The original stays in the media list.

## ADR-045: Silences, filler words and scene changes

**Context.** These are common cleanup jobs that don't need a model.
**Decision.** Silences come from FFmpeg's `silencedetect` over the sequence's mix, with 0.12 s left either side of each cut; filler words come from the caption words. Both are listed for review, with a checkbox per stretch, before anything is removed. Scene changes come from FFmpeg's `scdet` and split the clip and its linked clips.
**Consequences.** Filler words are only found after transcription, and only common English ones.

## ADR-046: One tool set for the copilot and MCP

**Context.** AI edits must be ordinary, reviewable, undoable edits, whichever AI makes them.
**Decision.** `src/ai/tools.ts` defines every tool once, with a zod schema that also gives the JSON Schema sent to models. Read tools describe the project in seconds and track names; edit tools build the same engine commands the editor uses and apply them to a working copy. Slow work (transcription, silence detection, frames, colour statistics) goes through injected services, so the tools are tested without Electron. Bad arguments and impossible edits come back as text for the model to correct, not as failures.
**Consequences.** A new editor feature becomes available to AI by adding one tool. The tools cover what the plan lists, plus removing silences and filler words and rewriting caption text (used for corrections and translation).

## ADR-047: Copilot runs in the main process, edits land in the editor

**Context.** API keys must not reach the renderer, and an AI change must be seen before it lands.
**Decision.** The agent loop runs in the main process with the project snapshot the editor sends. It returns the commands it collected and the resulting project; the editor shows a diff (a small timeline with added, changed and removed clips, plus length, caption, marker and setting changes) and applies everything as one batch, so it undoes in one step. In automatic mode it applies without the review. Requests made per project are logged in the app data folder and listed in the copilot's History tab.
**Consequences.** If the project changes while the copilot works, its commands are applied to the newer project and may fail; the editor says so and nothing is changed.

## ADR-048: Providers through two adapters

**Context.** The plan lists Anthropic, OpenAI, Gemini, OpenRouter, Mistral, Ollama, LM Studio and any OpenAI-compatible endpoint.
**Decision.** Anthropic uses the official SDK and the Messages API: the default model is `claude-opus-5-5`, full assistant turns (thinking blocks included) go back unchanged, each turn's tool results go back in one message, and requests to models that support it opt into server-side refusal fallbacks (`fallbacks: "default"`). Every other provider speaks OpenAI-style chat completions with tools, so one adapter covers them, with preset addresses. Keys are stored with Electron safeStorage in the system keyring, never in settings, projects or logs; the renderer only learns whether one is set.
**Consequences.** Requests aren't streamed yet; the panel shows each tool call as it happens instead. Without a keyring on Linux, keys are only obfuscated, and Settings says so.

## ADR-049: Local-only mode and what is sent

**Context.** Users must be able to keep everything on their computer, and see what leaves it.
**Decision.** Local-only mode allows only providers whose address is on this computer (Ollama, LM Studio, or a local address); it blocks requests, model lists and connection tests to anything else. Local models, captions and cleanup keep working. The copilot shows where requests go, the first request's text and an estimated token count, and notes that tool results (timeline data, captions, frames when asked for) are sent as the model works.
**Consequences.** The token estimate is characters divided by four, a rough guide.

## ADR-050: The MCP server

**Context.** Other AI tools should be able to read and edit the open project.
**Decision.** When turned on, a JSON-RPC server answers MCP's Streamable HTTP transport (JSON responses only) at `127.0.0.1` with a random bearer token, rejects other origins, and offers the same tool set. Edit calls go to the editor, which shows the review dialog (or applies them in automatic mode) and answers once the user decides. Clients that only launch commands use a small stdio bridge: the app binary in Node mode running `mcp-stdio.js`, which forwards each line to the running app. Settings copies a ready Claude Code command and a stdio config.
**Consequences.** No server-to-client streaming or notifications; tools are listed once per session.

## ADR-051: Export options, presets and codecs

**Context.** Exports need platform presets, professional codecs, alpha, GIF, audio only and image sequences, from one model the interface and the encoder share.
**Decision.** `src/shared/export.ts` describes an export (container, video and audio codec, size, frame rate, quality, fit, range, hardware, alpha, smart copy) and the presets, each a set of these options. `src/media/encode.ts` turns them into FFmpeg arguments for both export paths: scaling with fit (bars) or fill (crop), frame rate, the pixel format each codec needs, and per-codec quality settings. GIF uses a palette pass; PNG writes numbered frames into a folder; alpha uses ProRes 4444, VP9 or PNG, and the compositor hands over straight alpha for those. HDR sequences always get a 10-bit codec with HDR tags (HEVC unless AV1 or ProRes is chosen) and always encode in software, which writes the HDR metadata reliably. The last options are remembered, and the title bar's Export button uses them.
**Consequences.** Every format is checked by a unit test that runs FFmpeg and reads the result back with ffprobe.

## ADR-052: Hardware encoders and the export queue

**Context.** Hardware encoders are much faster, but being listed by FFmpeg doesn't mean the GPU or driver is there.
**Decision.** On first use, each candidate (NVENC, Quick Sync, AMF, VideoToolbox, VAAPI) encodes three frames; the first that works per codec is used. Exports wait in a queue in the main process and run one at a time in the background, with their progress in the Export workspace; a queued export can be cancelled before it starts.
**Consequences.** Detection costs a second or two once per session.

## ADR-053: Smart render

**Context.** Re-encoding a clip that hasn't changed loses quality and time.
**Decision.** When the sequence is one clip and its own sound, untouched, from the start of the file, at the file's size and rate, and the export's codec matches the file's, the streams are copied. Anything else (a trim that doesn't start at the beginning, an effect, a level change, captions) encodes as usual.
**Consequences.** Copying cut points that fall between keyframes isn't attempted; those segments are re-encoded with the rest.

## ADR-054: Command palette and keymaps

**Context.** Every action should be reachable by name, and people coming from other editors want their own keys.
**Decision.** One registry lists every action with its label; the palette (Ctrl+K) searches it and shows each shortcut. Keymaps are a preset (Lumacut, Premiere Pro, Final Cut Pro, DaVinci Resolve) plus the user's changes; assigning a key takes it away from the action that had it. Arrow keys, Home, End, J, K, L and the angle numbers stay fixed. The Premiere Pro preset gives Ctrl+K to splitting, as in Premiere, and moves the palette to Ctrl+Shift+P.
**Consequences.** Menu accelerators in the native menu still show the default keys.

## ADR-055: Resizable workspaces and the media bin

**Context.** Panels need resizing, and larger projects need ways to find and keep media.
**Decision.** Each workspace grid is sized by CSS variables; separator handles change them by dragging or with arrow keys, and the sizes are saved per workspace. Panels don't move between places. The media list gets ratings, tags, a list view and built-in filters (kind, rated, unused, missing). Missing files are found when the project opens and when the window regains focus; they can be relinked one at a time or all at once by searching a folder, and Collect files copies every file into one folder and points the project at the copies.
**Consequences.** Hover scrubbing on thumbnails isn't done yet.

## ADR-056: Accessibility and performance checks

**Context.** The plan asks for no critical accessibility problems and smooth 4K scrubbing with proxies.
**Decision.** An e2e test runs axe-core (WCAG 2.1 A and AA) in every workspace in light and dark and fails on any serious or critical finding; axe is injected into the window because Electron can't open the extra page its Playwright helper needs. The fixes it led to: workspace tabs control a real tab panel, list items mark selection with `aria-current`, and two light-mode text colours were darkened. A second test steps a 4K timeline frame by frame through its proxy and checks how long each step takes to show the right picture (median 29 ms, 90th percentile 81 ms on the development laptop).
**Consequences.** The checks cover what is on screen in each workspace, not every dialog.

## ADR-057: Onboarding

**Context.** A first start should say what Lumacut does with your data and let people pick familiar keys, without a tour.
**Decision.** One sheet on the first start: three plain facts (local by default, everything undoes, Ctrl+K finds commands), a choice of shortcut style, and two ways to begin (import media, or an empty project).
**Consequences.** Nothing else is shown on later starts.

## ADR-058: macOS FFmpeg and per-architecture Mac builds

**Context.** The FFmpeg builds used so far (BtbN) have no macOS version, and a universal Mac app would need both architectures' FFmpeg merged into one binary.
**Decision.** macOS uses the static GPL builds of FFmpeg 8.1.2 from ffmpeg.martin-riedl.de, one zip per program, pinned by URL and SHA-256 in `scripts/binaries.json` like the others. Mac packages are built separately for Apple silicon and Intel instead of as one universal app, so each carries only its own FFmpeg.
**Consequences.** Two Mac downloads instead of one, each about half the size. `--repin` updates only the BtbN builds; the Mac pins are updated by hand.

## ADR-059: Updates

**Context.** People should get fixes without hunting for them, but checking contacts a server, and some packages are owned by the system's package manager.
**Decision.** Settings > Updates offers three choices: install new versions by themselves, only say they exist (the default), or never check. A check asks GitHub for the newest release 10 seconds after starting and every 6 hours. The AppImage and the Windows installer update through electron-updater from the release's `latest*.yml` files; deb, rpm, tar.gz, Flatpak, the portable exe and macOS only show the new version with a link, because their own installer or package manager owns the files, and an unsigned Mac app can't replace itself. Development builds and tests never check.
**Consequences.** Checking reveals the computer's IP address to GitHub, which the setting explains. macOS will update itself once the builds are signed.

## ADR-060: What's new from CHANGELOG.md

**Context.** After an update, people should see what changed without a separate notes file to maintain.
**Decision.** CHANGELOG.md ships with the app. On the first start of a version that has a section there, a sheet lists that section; closing it records the version. People who just finished the welcome sheet skip it. Help > What's new opens it again.
**Consequences.** Changelog lines are user-facing text and follow the writing rules.

## ADR-061: Release workflow

**Context.** A tag should produce every package with checksums, without anything run by hand.
**Decision.** `.github/workflows/release.yml` runs on tags `v*`: it checks the tag against package.json and CHANGELOG.md and runs the unit checks, builds Linux (x64, and arm64 cross-built on the same runner), the Flatpak, Windows and macOS on their own runners, then creates the GitHub Release with every file, `SHA256SUMS.txt`, the updater's `latest*.yml` files and the matching CHANGELOG section as notes. Signing and notarization run only when their secrets exist. The repository is assumed to be `Pascalllllll/Lumacut-video-editor-`, following the owner's other projects.
**Consequences.** The arm64 Linux packages are cross-built and not started in CI.

## ADR-062: Start screen and opening files from the system

**Context.** People come back to the same few projects, and double-clicking a `.lumacut` file should open it.
**Decision.** Lumacut keeps the last twelve projects opened or saved in `recent.json`. On launch, if there are any and the setting is on, a start screen offers to continue the last one, open another, start new or import; any workspace tab leaves it, and File > Start screen brings it back. Only one Lumacut runs per user: a project file given at launch, by a second launch or by macOS's open-file event goes to the running window. Files dropped outside the media list and the timeline are imported (or opened, for a project).
**Consequences.** Projects are listed by path; a moved project shows as not found until it is opened from its new place.

## ADR-063: Guided tour

**Context.** The welcome sheet explains principles, not where things are.
**Decision.** The welcome sheet ends with "Take the tour" or "Skip the tour". The tour is seven short steps that light up a part of the Edit workspace each, with Back, Next and Skip, arrow keys and Escape. Help > Take the tour runs it again. Shortcuts that edit the timeline are ignored while any dialog, sheet or the tour is open.
**Consequences.** The tour describes the Edit workspace only.

## ADR-064: Optional Google sign-in

**Context.** The owner wanted a sign-in option, while everything stays free and offline.
**Decision.** Settings > Account offers "Sign in with Google" only in builds made with a Google OAuth client ("Desktop app" type) given as `LUMACUT_GOOGLE_CLIENT_ID` and `LUMACUT_GOOGLE_CLIENT_SECRET` at build time. The flow is OAuth 2.0 for installed apps with PKCE: the system browser signs in and Google redirects to a one-time server on 127.0.0.1 that checks the state value and ignores anything else. Lumacut asks only for `openid email profile`, reads the name, email address and picture (fetched only from Google's picture hosts, at most 256 KB), revokes the access token straight away and keeps those three things in `account.json` (owner-only permissions). Nothing depends on being signed in. A desktop client's secret can't be kept secret in a shipped app; Google's documentation treats it as public for this client type, and PKCE protects the exchange.
**Consequences.** Without the build-time client, the Account section is absent rather than broken. There is no sync, because there is no server.

## ADR-065: Security hardening

**Context.** A review of what reaches Lumacut from outside: project files from other people, media files, AI providers, MCP clients, the update feed and the window itself.
**Decision.**

- Only Lumacut's own `index.html` is trusted for IPC and navigation; before, any `file://` page was. Every web contents refuses navigation and redirects elsewhere, webviews and new windows are refused, and links go to the system browser only for http and https.
- Media paths must be full local paths, never URLs, so a shared project can't make FFmpeg reach the network. Project files over 256 MB, or whose `project.json` claims more than 512 MB, are refused, and nothing else in the archive is unpacked.
- The media protocol serves only imported files and the app's own caches, with `nosniff` and a sandboxing CSP, so an SVG or HTML file can't run as a page. The window's CSP also forbids frames and forms.
- Electron fuses turn off `NODE_OPTIONS`, inspector arguments and loading the app from outside its archive, turn on cookie encryption and archive integrity checks (Windows, macOS). Run-as-Node stays on for the MCP stdio bridge.
- Exports requested over MCP never replace an existing file. Release and CI workflows pin every action to a commit and don't keep the checkout's credentials; build secrets are given only to the build steps.
  **Consequences.** `tests/e2e/security.spec.ts` covers the window, the media protocol and the project checks.

## ADR-066: App icon

**Context.** The first icon was a letter on a dark square and read as a placeholder.
**Decision.** A picture of what the app is for: a landscape frame above three clips on a timeline, crossed by the amber playhead. `resources/icons/icon.svg` is the source; the PNG sizes are rendered from it.
**Consequences.** None.

## ADR-067: PolyForm Noncommercial instead of GPL

**Context.** Lumacut is original work by one author, and the author wants to keep others from selling it or rebranding it commercially. GPL-3.0 allows both. ADR-002 assumed the bundled FFmpeg forced the GPL, but FFmpeg runs as a separate program, so it doesn't decide the license of Lumacut's own code.
**Decision.** License Lumacut under the PolyForm Noncommercial License 1.0.0, replacing ADR-002. FFmpeg and FFprobe keep shipping as unmodified GPL builds with their license text and source offer, as before. Versions up to 1.0.0 stay available under GPL-3.0-or-later.
**Consequences.** Lumacut is source-available, not open source. Dependencies no longer need to be GPL-compatible, but anything bundled must allow redistribution, and GPL components must stay separate programs rather than being linked into the app. Contributions are accepted under the project license with permission to relicense.
