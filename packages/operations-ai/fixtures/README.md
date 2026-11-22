# Fixtures

- `speech-en.mp3`: 11 seconds of John F. Kennedy's 1961 inaugural address, a public domain recording, as whisper.cpp ships it in `samples/jfk.mp3` (MIT). Read only by the integration test.
- `audio.m4a`, `video.mp4`, `silent-portrait.mp4`: the fixtures of `@eclair-js/operations-audio`.
- `silence.m4a`: 3 seconds of digital silence, made with `ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 3`.
- `fake-whisper-cli.mjs` and `whisper-full.json`: a stand-in for whisper.cpp and a full JSON transcript in its format, so the tests never need a model.
