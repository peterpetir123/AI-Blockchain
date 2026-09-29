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

## Worker node tanpa server

Worker ini hanya membaca blockchain melalui RPC, menjalankan model secara lokal,
dan mengirim output kembali ke contract. Tidak ada HTTP server atau database.

```bash
QUORUM_DEPLOYMENT=inference-quorum-deployment.json \
MODEL_PATH=shards/model_reconstructed.gguf \
PRIVATE_KEY=0xPRIVATE_KEY_WALLET_NODE_SENDIRI \
START_BLOCK=BLOCK_SEBELUM_REQUEST \
POLL_MS=15000 \
MAX_TOKENS=128 \
node node/worker_node.js
```

Worker membaca `RequestCreated` dengan `eth_getLogs` per rentang blok. Setiap
request yang cocok dengan model aktif dijalankan lokal, lalu output dikirim ke
`submitOutput`. Wallet node harus memiliki BNB opBNB untuk gas.

Requester membuat permintaan dan mengambil hasil langsung dari blockchain:

```bash
PRIVATE_KEY=0xPRIVATE_KEY_REQUESTER_SENDIRI \
POLL_MS=10000 \
npm run request:inference -- "Jelaskan blockchain dalam satu kalimat"
```

Requester membayar gas transaksi request dan finalisasi. Prompt dan output
tersimpan publik on-chain. Atur `INFERENCE_QUORUM` untuk jumlah output identik
yang harus diterima; default demo adalah `1`.

### Alur dari shard Pinata

Untuk mensimulasikan node komunitas yang mengambil model dari shard publik:

```bash
python3 scripts/assemble_shards.py --refresh
MODEL_PATH=shards/model_reconstructed.gguf \
  npm run node:inference -- "Jelaskan blockchain dalam satu kalimat"
```

Script rekonstruksi memverifikasi hash setiap shard dan hash file GGUF akhir
sebelum inference dijalankan.
