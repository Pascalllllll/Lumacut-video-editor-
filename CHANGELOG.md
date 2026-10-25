# Changelog

All notable changes to Lumacut are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Lumacut is now licensed under the PolyForm Noncommercial License 1.0.0 instead of GPL-3.0-or-later. Version 1.0.0 stays available under the GPL.

## [1.0.0] - 2026-10-25

### Added

- A start screen with your recent projects and a button to continue the last one.
- A short guided tour after the welcome sheet, also under Help.
- Optional sign-in with Google, which only shows your name and picture; nothing is synced and every feature works without it.
- Double-clicking a `.lumacut` file opens it, in the Lumacut that is already running if there is one.
- Files dropped anywhere on the window are imported.
- A new app icon.
- Windows packages for x64 and Arm: an installer and a portable app.
- macOS packages for Apple silicon and Intel.
- A Flatpak for Linux.
- Update checks with a choice in Settings: install new versions by themselves, only say they exist, or never check. AppImage and the Windows installer update themselves; other packages link to the release.
- A What's new sheet after each update, also under Help.
- Export workspace with presets for YouTube, Shorts, TikTok, Reels, X, LinkedIn and Vimeo, a ProRes master, small HEVC files, animated GIF, audio only and PNG image sequences.
- Codecs: H.264, HEVC, AV1, ProRes, DNxHR and VP9; transparency with ProRes 4444, VP9 and PNG; sizes up to 8K with fit or fill; any frame rate.
- Hardware encoding with NVENC, Quick Sync, AMF, VideoToolbox or VAAPI when the computer has it.
- An export queue that runs in the background while you edit; export the whole sequence, the in-to-out range or the selected clips.
- Untouched clips are copied rather than re-encoded.
- Command palette (Ctrl+K) for every command.
- Shortcut presets for Premiere Pro, Final Cut Pro and DaVinci Resolve, and any command's keys can be changed.
- Resizable panels, remembered per workspace.
- Media ratings, tags, a list view and filters; relinking of moved files, one at a time or from a folder; collecting all media into one folder.
- Export a clip's grade as a .cube LUT.
- A welcome sheet on the first start.
- Copilot: ask for an edit in plain words, review the change on a small timeline, and apply it as one step that undoes with Ctrl+Z.
- Works with Anthropic, OpenAI, Google Gemini, OpenRouter, Mistral, Ollama, LM Studio and other OpenAI-compatible servers. Keys are kept in the system keyring.
- Local-only mode, a view of what is sent and roughly how many tokens, and a history of copilot requests per project.
- A local MCP server so other AI tools can read the timeline and propose edits, which wait for your review.
- Captions workspace: captions from speech with local Whisper models, with word timing.
- Caption styles (clean, boxed, bold, karaoke), shown in the viewer and burned into exports.
- Import and export captions as SRT, WebVTT and ASS.
- Edit by text: remove words from the transcript and the matching video goes with them.
- Find and remove silences and filler words, after reviewing each one.
- Cut a clip at its scene changes.
- Clean up voice and remove backgrounds from video, both on this computer.
- Settings > AI models: download, check and delete local models. Everything works offline once they are downloaded.
- Audio workspace with a mixer: a fader, pan, mute, solo and meter per track, and a master with momentary, short-term and integrated loudness.
- Sound settings for each clip: gain, volume keyframes, pan, and fades you can drag from the clip's top corners.
- Sound effects on clips, tracks and the master: EQ, compressor, limiter, noise gate, de-esser and reverb.
- Loudness on export: bring the mix to -14, -16 or -23 LUFS, and measure the mix at any time.
- Duck music under dialogue, using track roles.
- Beat markers from music, and cutting a clip at markers.
- Voiceover recording onto the targeted audio track.
- Color workspace with the viewer, scopes, a clip strip and the grade panel.
- Grades built from layers: color wheels for lift, gamma, gain and offset, exposure, contrast, saturation, temperature and tint; RGB curves and hue curves; LUTs.
- Limit any grade layer to a range of colors, with a view that shows what is selected.
- Eight built-in looks and import of `.cube` LUT files.
- Waveform, RGB parade, vectorscope and histogram.
- Auto balance, auto exposure, matching one clip's color to another, and copy and paste of grades.
- Color management: sequences in Rec. 709, P3 or Rec. 2020, footage converted on the way in, and files tagged correctly on export.
- HDR sequences in PQ or HLG, exported as 10-bit HEVC; HDR footage tone-mapped in SDR sequences.
- Effects: blur, directional and zoom blur, sharpen, glow, vignette, film grain, color fringing, pixelate, posterize, mirror, wave, bulge, lens correction, chroma key, luma key, drop shadow, outline, brightness and contrast, and stabilize.
- Keyframes on every transform, effect and mask value, with easing and a curve editor for custom timing.
- Transform, crop, opacity and 18 blend modes; ready-made picture-in-picture and split-screen layouts; move, resize and turn clips by dragging in the viewer.
- Masks: rectangle, ellipse and pen shapes, drawn on the picture, with feather, expansion, invert and add, subtract or intersect.
- Transitions: cross dissolve, dips, wipes, slides, pushes, zooms, blur, glitch, light leak and iris, with adjustable length and easing. Ctrl+D adds a cross dissolve at the nearest cut.
- Titles with font, weight, size, spacing, solid or gradient fill, outline, shadow, background box and letter, word or line animations; seven starting templates.
- Solid color clips and adjustment layers that apply their effects to everything below.
- Tracking: a mask can follow something in the picture, and titles can follow a tracked mask.
- Effect presets: save a clip's effects to a file and load them onto other clips.
- A viewer drawn on the GPU, with automatic lighter previews for sequences taller than 1200 lines.
- Exports include every effect, title and transition, and match what the viewer shows.
- Any number of video and audio tracks, each with lock, hide or mute, solo, target and adjustable height. Higher video tracks cover lower ones.
- Picture and sound from one file are linked and edit together; hold Alt or turn off linked selection to edit one.
- Editing tools: select (V), blade (C), ripple (B), roll (N), slip (Y), slide (U) and rate stretch (R). Shift+Delete deletes and closes the gap.
- Magnetic timeline (Shift+M): clips on V1 stay together with no gaps.
- Source viewer: double-click media to view it, set in and out marks, then insert (,), overwrite (.), replace (Shift+R) or fit to fill (Shift+F). Timeline in and out points (I, O, X), lift (;) and extract (').
- Markers with names, notes and colors (M).
- J, K and L shuttle playback, and jumping between cuts with the up and down arrows.
- Speed changes, reverse, hold frame, speed ramps with a curve editor, and frame blending or optical flow for slow motion in exports.
- Compound clips (Alt+G), several sequences per project with tabs, and nesting one sequence inside another.
- Multicam clips that line up angles by their sound; press 1 to 9 to cut between angles.
- Proxies for smooth playback, made automatically for formats the viewer can't play, or on request.
- Autosave every minute, an offer to restore unsaved work after a crash, and File > Restore an earlier version.
- Zoom to fit (Shift+Z), snapping toggle (Shift+S), groups (Ctrl+G) and link or unlink (Ctrl+L).
- Phone recordings with uneven frame timing are detected and conformed on export.
- Import video, audio and image files with the Import button, Ctrl+I, or by dropping them on the media list or the timeline.
- Media list with thumbnails, durations and search.
- Timeline with a video track and an audio track: drag clips in, move them, trim either edge, split at the playhead (S), delete, and zoom with Ctrl and the scroll wheel. Clips snap to each other and to the playhead.
- Undo and redo for every edit (Ctrl+Z, Ctrl+Shift+Z).
- Viewer with play, pause, frame stepping and timecode. Arrow keys step one frame, Shift+arrow one second.
- Inspector showing clip and media details, and sequence size and frame rate. The first video you add sets the sequence to its size and frame rate.
- Save and open projects as `.lumacut` files. Lumacut asks before closing or replacing a project with unsaved changes.
- Export the timeline to an H.264 MP4 with progress, time remaining, cancel, and Show in folder.
- App window with a custom title bar and a menu holding every command.
- Settings for theme (match system, light, dark), accent color and interface size from 90% to 150%.
- Linux packages: `.deb`, `.rpm`, AppImage and `.tar.gz`, with `.lumacut` files opening in Lumacut.

### Fixed

- Changing one setting no longer resets the others to their defaults.
- Keyboard shortcuts no longer change the timeline while a dialog is open.

### Security

- Only Lumacut's own window can use the app's internal functions; other local files can't take its place.
- Projects whose media point at web addresses, and project files too large to be real, are refused.
- Media shown in the window can never run as a page, and Electron features Lumacut doesn't use are switched off in the app itself.
- Exports requested by other AI tools never replace an existing file.
