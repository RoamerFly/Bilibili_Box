# Third-Party Notices

## FFmpeg and FFprobe

Release builds of Bilibili Box include `ffmpeg` and `ffprobe` as separate executable tools in the `env/` directory. Bilibili Box invokes these tools as external processes for media merging and conversion; they are not linked into the Rust executable.

The packaged FFmpeg tools are built with GPL-enabled features and are distributed under the applicable FFmpeg and linked-library licenses. The MIT license for Bilibili Box does not replace the licenses of these bundled tools.

Runtime sources used by the GitHub Release workflow:

- Windows x64: [gyan.dev FFmpeg Builds](https://www.gyan.dev/ffmpeg/builds/), FFmpeg 8.1.1 GPLv3 static essentials archive.
- Linux x64: [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds), FFmpeg 7.1 GPL static archive.
- macOS x64 and arm64: [Martin Riedl's FFmpeg Build Server](https://ffmpeg.martin-riedl.de/), FFmpeg 8.1.1 static release executables.

FFmpeg source code and licensing information are available from:

- [FFmpeg project](https://ffmpeg.org/)
- [FFmpeg legal information](https://ffmpeg.org/legal.html)
- [FFmpeg source downloads](https://ffmpeg.org/download.html#get-sources)

Users may replace the bundled executables with compatible `ffmpeg` and `ffprobe` builds in the application `env/` directory.

## Local SenseVoice ASR runtime

The local transcription feature uses the official `sherpa-onnx` shared native
runtime (version 1.13.4) and ONNX Runtime libraries. These native libraries are
included in the platform portable/installer bundles beside the application
executable where required by the platform loader; they are not statically
linked into the BiliBox executable.

- sherpa-onnx source and license: [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (the upstream project is Apache-2.0 licensed).
- ONNX Runtime source and license: [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) (the upstream project is MIT licensed).
- Native runtime release: [sherpa-onnx v1.13.4](https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.13.4).

The SenseVoice int8 model is **not bundled by default**. It is downloaded only
after the user explicitly starts the model download, from the fixed official
release URL below, and verified with the pinned SHA-256 before installation:

`https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2`

SHA-256: `7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e`

The model archive's own `LICENSE` file contains only a referral to the
[FunASR license](https://github.com/modelscope/FunASR?tab=readme-ov-file#license),
not a standalone license text. The current upstream FunASR repository license
is MIT, but model users and redistributors must follow the upstream/model terms
and verify them before redistribution; the application does not silently
download or redistribute this model.
