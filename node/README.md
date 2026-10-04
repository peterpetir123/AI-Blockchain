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

## Dependensi

Node di folder ini memakai `ethers` dari `package.json` root, jadi install
terjadi **sekali di root repo** — bukan di dalam `node/`:

```bash
git clone https://github.com/peterpetir123/AI-Blockchain
cd AI-Blockchain
npm install
```

`node/` tidak punya `package.json` sendiri. Menjalankan `npm install` di dalam
`node/` tidak akan memasang apa pun.

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

Setelah `ModelRegistry` aktif dan `model-registry-deployment.json` tersedia,
jalankan dari root repo:

```bash
MODEL_PATH=/path/ke/model.gguf \
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
`submitOutput(requestId, output, nonce)`. Worker membaca difficulty milik request
dari chain (bukan nilai hardcode) dan mencari nonce PoW secara lokal. Untuk model
tier eksklusif worker mencetak peringatan bahwa nonce dapat memerlukan waktu
sangat lama. Wallet node harus memiliki BNB opBNB untuk gas.

### Reward dibagi rata antar kontributor

Fee request `0.0001 BNB` dibagi:

```text
10% platform → `claim()` oleh owner
90% miner    → dibagi rata ke semua miner yang output-nya cocok,
               masing-masing `claimShare(requestId)`
```

Miner yang mengirim output berbeda dari output pemenang tidak berhak apa pun.
Submission ditutup segera setelah kuorum tercapai, sehingga jumlah pembagi
mengunci di nilai `quorum`. Tidak ada sweep: reward miner yang tidak pernah di-claim
membeku permanen di contract, sesuai desain jaringan.

Perintah klaim miner:

```bash
QUORUM_REQUEST_ID=1 node -e '
const { JsonRpcProvider, Wallet, Contract } = require("ethers");
require("dotenv").config();
const d = require("./inference-quorum-deployment.json");
const p = new JsonRpcProvider(process.env.RPC_URL || "https://opbnb-rpc.publicnode.com");
const c = new Contract(d.quorumAddress, ["function claimShare(uint256)"], new Wallet(process.env.PRIVATE_KEY, p));
c.claimShare(process.env.QUORUM_REQUEST_ID).then((t) => t.wait().then(() => console.log(t.hash)));
'
```

### Difficulty per versi model

Nilai difficulty awalnya `16` sehingga perangkat ringan bisa ikut. Owner atau miner
yang sudah mengirim output valid untuk versi tersebut dapat mengusulkan nilai baru
antara `12` dan `80`:

```solidity
proposeDifficulty(version, difficulty)
```

Tiga usulan unik dengan nilai sama langsung mengaktifkan difficulty tersebut; usulan
dengan nilai berbeda tidak dapat mengubahnya. Jika dalam jendela 2 hari tidak tercapai
tiga usulan yang sama, difficulty lama dipertahankan dan `resolveDifficulty(version)`
menutup ronde. Nilai `≥ 50` ditandai sebagai tier eksklusif oleh
`isExclusiveTier(version)`. Difficulty terkunci pada request saat request dibuat.

### Jalur emergency (anti deadlock)

Kalau consensus tiga usulan tidak pernah tercapai — misalnya semua miner yang
pernah 제안 hilang — difficulty tidak akan bisa diubah. Jalur emergency menutup
lubang itu:

```solidity
proposeDifficultyEmergency(version, difficulty)  // owner atau miner terdaftar
executeDifficulty(version)                      // siapa pun, setelah 7 hari
cancelDifficultyEmergency(version)              // owner, sebelum dieksekusi
```

```text
Owner/Miner mengusulkan  →  menunggu 7 hari  →  siapa pun menjalankan
```

Efeknya: owner tidak dapat mengubah difficulty sendirian karena harus menunggu
masa tunda, tetapi jaringan tidak pernah terkunci selamanya karena eksekusi tidak
bergantung pada wallet owner. Usulan kedua saat masih pending ditolak, dan owner
bisa membatalkan usulan yang tidak diinginkan.

### Output harus deterministik agar kuorum tercapai

Agar output beberapa miner dianggap identik, inference harus deterministik.
Build `llama-cli` minimal yang hanya mendukung `-m/-n/-ngl` memakai greedy
decoding dan sudah deterministik. Jika memakai build llama.cpp lengkap dengan
sampling acak, atur flag deterministik agar kuorum dapat tercapai:

```bash
LLAMA_TEMP=0 LLAMA_SEED=1 node node/worker_node.js
```

Requester membuat permintaan dan mengambil hasil langsung dari blockchain:

```bash
PRIVATE_KEY=0xPRIVATE_KEY_REQUESTER_SENDIRI \
POLL_MS=10000 \
npm run request:inference -- "Jelaskan blockchain dalam satu kalimat"
```

Requester membayar gas transaksi request dan finalisasi. Prompt dan output
tersimpan publik on-chain. Atur `INFERENCE_QUORUM` untuk jumlah output identik
yang harus diterima; default demo adalah `1`. Jika quorum tidak tercapai sampai
deadline, requester dapat memanggil `refundRequest(requestId)`.

### Alur dari shard Pinata

Untuk mensimulasikan node komunitas yang mengambil model dari shard publik:

```bash
python3 scripts/assemble_shards.py --refresh
MODEL_PATH=shards/model_reconstructed.gguf \
  npm run node:inference -- "Jelaskan blockchain dalam satu kalimat"
```

Script rekonstruksi memverifikasi hash setiap shard dan hash file GGUF akhir
sebelum inference dijalankan.
