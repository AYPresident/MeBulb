# OCR engine (vendored)

- `tesseract-core-simd-lstm.wasm.js`: Tesseract OCR compiled to WebAssembly, from
  [naptha/tesseract.js-core](https://github.com/naptha/tesseract.js-core) 7.0.0 (Apache 2.0).
- `eng.traineddata`: English LSTM model from [tesseract-ocr/tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) (Apache 2.0).
- `ocr-worker.js`: MeBulb's own worker that drives the engine (no network access).

Both run entirely on the user's computer; nothing is uploaded.
