# How many engines

Measured on an Apple M2 Max (12 cores, 96 GB), Supertonic 3 on CPU through
onnxruntime-node, the same 1,360-character passage per engine, voice M5, 8 steps.
An engine holds about 560 MB after loading and about 860 MB after a long chapter.

| engines × threads | audio made | wall time | speed vs real time | chars / s |
| ----------------- | ---------- | --------- | ------------------ | --------- |
| 1 × 1             | 104 s      | 60 s      | 1.7×               | 26        |
| 1 × 2             | 104 s      | 31 s      | 3.4×               | 51        |
| 1 × 4             | 104 s      | 28 s      | 3.7×               | 55        |
| 1 × 12            | 104 s      | 55 s      | 1.9×               | 28        |
| 3 × 4             | 311 s      | 64 s      | 4.9×               | 73        |
| 6 × 2             | 622 s      | 83 s      | 7.5×               | 112       |
| 12 × 1            | 1,244 s    | 124 s     | 10.0×              | 151       |
| 12 × 2            | 1,244 s    | 140 s     | 8.9×               | 133       |
| 18 × 1            | 1,867 s    | 6,654 s   | 0.3×               | 4         |

What it says: a second thread helps an engine a little, more threads hurt it,
and many single-threaded engines scale almost linearly up to the core count —
then fall off a cliff. So `sizeEngines()` in build/tts.mjs runs one
single-threaded engine per core the runtime reports, capped by memory at a
gigabyte each after two of headroom. `--workers N` overrides; `TTS_THREADS`
sets the threads per engine.
