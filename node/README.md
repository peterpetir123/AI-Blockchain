# Local AI Node

Node lokal pertama untuk menjalankan model GGUF. Node ini belum membaca
blockchain atau mengirim transaksi; tujuan tahap ini hanya memastikan model
benar-benar dapat dijalankan di komputer komunitas.

## Runtime

Pasang `llama.cpp` dari sumber resminya sehingga tersedia executable `llama-cli`.
Verifikasi:

```bash
llama-cli --version
```

## Jalankan model

```bash
MODEL_PATH=/path/to/model.gguf \
node node/run_inference.js "Jelaskan apa itu blockchain secara singkat"
```

Jumlah token default adalah 128. Ubah jika perlu:

```bash
MAX_TOKENS=256 MODEL_PATH=/path/to/model.gguf \
node node/run_inference.js "Tulis satu kalimat dalam bahasa Indonesia"
```

Jika executable memiliki nama atau lokasi lain:

```bash
LLAMA_CLI=/path/to/llama-cli MODEL_PATH=/path/to/model.gguf \
node node/run_inference.js "Halo"
```

Model harus berupa file GGUF yang sumber, lisensi, dan hash-nya terdokumentasi.

## Jalankan inference dengan registry on-chain

Setelah `ModelRegistry` aktif dan `model-registry-deployment.json` tersedia:

```bash
cd /home/hengkerprotzy/coding/ai-agent
MODEL_PATH=/home/hengkerprotzy/models/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf \
npm run node:inference -- "Jelaskan blockchain dalam satu kalimat"
```

Node akan memeriksa versi model aktif, CID, dan SHA-256 sebelum menjalankan
inference. Setelah output dibuat, node mengirim hash prompt dan output melalui
`InferenceRecorded` ke registry. Isi prompt/jawaban tidak disimpan on-chain.

### Alur dari shard Pinata

Untuk mensimulasikan node komunitas yang mengambil model dari shard publik:

```bash
python3 scripts/assemble_shards.py --refresh
MODEL_PATH=shards/model_reconstructed.gguf \
  npm run node:inference -- "Jelaskan blockchain dalam satu kalimat"
```

Script rekonstruksi memverifikasi hash setiap shard dan hash file GGUF akhir
sebelum inference dijalankan.
