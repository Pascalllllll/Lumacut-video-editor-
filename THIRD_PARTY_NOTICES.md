# Third-party notices

Lumacut is licensed under GPL-3.0-or-later (see `LICENSE`). It includes or downloads the following components.

## Bundled with the app

| Component                                                                     | License                   | Source                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FFmpeg and FFprobe (static GPL builds, includes x264, x265, SVT-AV1 and more) | GPL-3.0-or-later          | https://ffmpeg.org, builds from https://github.com/BtbN/FFmpeg-Builds (Linux, Windows) and https://ffmpeg.martin-riedl.de (macOS). Full license text ships as `bin/FFMPEG_LICENSE.txt`. |
| Electron                                                                      | MIT                       | https://github.com/electron/electron                                                                                                                                                    |
| Chromium (inside Electron)                                                    | BSD-3-Clause and others   | https://www.chromium.org. Electron ships `LICENSES.chromium.html`.                                                                                                                      |
| Inter typeface                                                                | SIL Open Font License 1.1 | https://rsms.me/inter                                                                                                                                                                   |

## Compiled into the app

| Component           | License |
| ------------------- | ------- |
| React, React DOM    | MIT     |
| Radix UI primitives | MIT     |
| Zustand             | MIT     |
| Immer               | MIT     |
| Zod                 | MIT     |
| Lucide icons        | ISC     |

## Loaded at run time

| Component                                        | License           | Source                                                 |
| ------------------------------------------------ | ----------------- | ------------------------------------------------------ |
| Anthropic TypeScript SDK                         | Apache-2.0        | https://github.com/anthropics/anthropic-sdk-typescript |
| Transformers.js                                  | Apache-2.0        | https://github.com/huggingface/transformers.js         |
| ONNX Runtime (onnxruntime-node, onnxruntime-web) | MIT               | https://github.com/microsoft/onnxruntime               |
| sharp                                            | Apache-2.0        | https://github.com/lovell/sharp                        |
| libvips (inside sharp)                           | LGPL-3.0-or-later | https://github.com/libvips/libvips                     |
| electron-updater                                 | MIT               | https://github.com/electron-userland/electron-builder  |

## Models downloaded on request

None of these ship with Lumacut. Settings > AI models downloads them, pinned to a commit and checked by SHA-256.

| Model                                    | License                                   | Source                                                                  |
| ---------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| Whisper base and small (word timestamps) | MIT                                       | OpenAI Whisper, ONNX exports from https://huggingface.co/onnx-community |
| MODNet portrait matting                  | Apache-2.0                                | https://huggingface.co/Xenova/modnet                                    |
| RNNoise model somnolent-hogwash          | Not subject to copyright (per its author) | https://github.com/GregorR/rnnoise-models                               |

## Test material

`tests/fixtures/jfk.wav` is an excerpt of John F. Kennedy's 1961 inaugural address, a work of the US government in the public domain, as distributed in the whisper.cpp samples.

The FFmpeg source code for the exact build is available from the FFmpeg project at the commit named in the build's file name (for example `n8.1.3-24-g92611900bb`), and on request. The macOS builds are FFmpeg 8.1.2, whose source is https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz; their configuration is listed at https://ffmpeg.martin-riedl.de.
