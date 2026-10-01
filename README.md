# AI Shard Unlock Agent

Prototipe jaringan AI komunitas. `AIShardUnlock` menangani tahap unlock naratif,
sedangkan `ModelRegistry` mendaftarkan satu file model utuh melalui CID dan
hash. Neural network berjalan di node komunitas; blockchain menyimpan versi
model dan hash hasil inference, bukan bobot atau inference-nya.

Target jaringan: **opBNB mainnet** (chainId 204). Contract sudah live.

Alamat contract:

- `AIShardUnlock`: `0x8D34729c9802F388b88e18f34B23EEb8fA9B859b`
- `ModelRegistry`: `0x4e5C31b13082CB98A34552965E7A41e46F7a8070`
- `InferenceQuorum`: `0xddB258315896EAd66A0381953D2FEB172e0e4BEf`

Contract `InferenceQuorum` sebelumnya (`0x3165D784eb2Bb68d40c3350a643AFfC970054239`)
sudah diganti karena versi itu hanya membayar satu miner pemenang. Kontrak lama
tetap ada di chain dan tidak pernah dihapus.

## Project documents

- [License](LICENSE) — MIT.
- [Contributing](CONTRIBUTING.md) — setup test dan panduan kontribusi.
- [Security](SECURITY.md) — penanganan secret dan pelaporan kerentanan.

## Alur

```
Deployer ──addShard(cid, hash, difficulty, message)──► CONTRACT
                                                          │
Komunitas ──submitProof(shardId, nonce)──► validasi PoW ──┤
                                                          ▼
             emit ShardUnlocked(shardId, miner, message, cid, shardHash, nonce)
```

Tidak ada server, worker, maupun bot. Satu-satunya output adalah event on-chain.

## Struktur

```
ai-agent/
├── contracts/AIShardUnlock.sol   # unlock naratif dan event pesan
├── contracts/ModelRegistry.sol   # versi model + catatan inference
├── test/                         # unit contract + integrasi miner
├── scripts/
│   ├── deploy_contract.js        # deploy + cetak address & topic hash
│   ├── add_shards.js             # registrasi shard dari manifest.json
│   ├── add_demo_shard.js         # tambah satu challenge publik difficulty rendah
│   └── shard_pipeline.py         # split file -> sha256 -> IPFS -> manifest.json
│   ├── assemble_shards.py        # download CID Pinata -> verifikasi -> gabung GGUF
├── miner/                        # miner publik (bagikan ke komunitas)
├── node/                         # runner model GGUF lokal
└── hardhat.config.js
```

## Model dan inference

Model Qwen GGUF disimpan sebagai satu file di IPFS/storage. Contract hanya
mencatat CID, hash, format, quantization, dan runtime. Node komunitas mengunduh
file, memverifikasi hash, lalu menjalankan model melalui `llama.cpp`.

Urutannya:

```text
model GGUF → IPFS → ModelRegistry → node komunitas → inference → hash dicatat
```

`InferenceRecorded` membuktikan bahwa sebuah node mengirim hash pada versi
model aktif; event tersebut **bukan bukti kriptografis** bahwa inference benar.
Verifikasi multi-node/evaluator akan ditambahkan pada tahap berikutnya.

### Manifest dan registrasi model

Setelah model diunggah dan dipin di IPFS, salin `model/manifest.example.json`
menjadi `model/manifest.json`, lalu isi CID, SHA-256 file, lisensi, sumber, dan
versi runtime yang benar. File manifest lokal di-ignore Git.

Setelah registry dideploy dan tersimpan di `model-registry-deployment.json`:

```bash
npm run register:model:testnet
```

Registrasi tidak otomatis mengaktifkan model. Setelah metadata/CID/hash ditinjau,
aktifkan versi tersebut dengan:

```bash
ACTIVATE_MODEL=true npm run register:model:testnet
```

## Setup

```bash
npm install
cp .env.example .env      # isi PRIVATE_KEY (wallet ber-BNB), PINATA_JWT
npx hardhat test          # 8 test harus lulus
```

## Deploy percobaan ke BNB Smart Chain Testnet

Gunakan wallet khusus testnet yang berbeda dari wallet mainnet. Isi `TESTNET_PRIVATE_KEY` di `.env`, lalu kirim tBNB dari faucet BNB Smart Chain Testnet ke alamat wallet tersebut. Deploy percobaan dengan:

```bash
npm run deploy:testnet
```

BNB Smart Chain Testnet memakai chain ID `97`; opBNB mainnet memakai `204`. Jangan masukkan private key ke repository. `deployment.json` menyimpan hasil deploy lokal dan di-ignore Git.

Deploy registry model ke testnet:

```bash
npm run deploy:registry:testnet
```

## Alur kerja

```bash
# 1. Pecah model jadi shard + hash (+ upload IPFS bila PINATA_JWT diisi)
python3 scripts/shard_pipeline.py model.bin --shards 8 --difficulty 20

# 2. Deploy contract
npx hardhat run scripts/deploy_contract.js --network opbnb

# 3. Daftarkan shard
npx hardhat run scripts/add_shards.js --network opbnb

# 4. Rekonstruksi model dari CID Pinata dan verifikasi hash
python3 scripts/assemble_shards.py --refresh

# 5. Komunitas mining
cd miner && npm install
export PRIVATE_KEY=<private-key-miner-lokal>
node mine.js --contract <CONTRACT_ADDRESS>

# 6. Jalankan inference dari model hasil rekonstruksi
cd ..
MODEL_PATH=shards/model_reconstructed.gguf npm run node:inference -- "Jelaskan blockchain dalam satu kalimat"
```

### Demo mining publik

Contract demo yang sudah live:

```text
AIShardUnlock: 0x8D34729c9802F388b88e18f34B23EEb8fA9B859b
Demo shard   : 9
Difficulty   : 16
```

Perintah lengkap untuk peserta ada di [`miner/README.md`](miner/README.md).
Peserta membutuhkan Node.js, `npm install`, wallet sendiri, dan sedikit BNB
opBNB untuk gas. Mining dilakukan lokal; hanya transaksi proof yang masuk
blockchain.

Contract `InferenceQuorum` memakai fee `0.0001 BNB` per request: 10% untuk
platform dan 90% dibagi rata ke semua miner yang output-nya cocok dengan
output pemenang. Miner mengambil `claimShare(requestId)`; platform memakai
`claim()`. Proof miner terikat ke request, output, address miner, dan nonce.
Tidak ada sweep, sehingga reward miner yang tidak pernah di-claim membeku
permanen. Difficulty Proof default `16` dan dapat diubah lewat usulan on-chain
(3 usulan unik dengan nilai sama mengaktifkannya); nilai `≥ 50` ditandai tier
eksklusif.

Shard `8` sudah dibuka saat uji end-to-end. Shard `9` adalah challenge publik
yang sedang tersedia dan masih terkunci.

`assemble_shards.py` mengunduh setiap CID melalui gateway Pinata, memeriksa
SHA-256 setiap shard, menggabungkannya berdasarkan `shardId`, lalu memeriksa
hash model akhir terhadap metadata model.

## Aturan proof

Proof valid bila:

```
keccak256(abi.encodePacked(shardId, nonce)) < 2^256 >> difficulty
```

`2^difficulty` = rata-rata jumlah nonce yang harus dicoba. `difficulty 20` ≈ 1 juta.

## Batasan yang disengaja

- **Governance bisa macet bila pengusul hilang.** Perubahan difficulty memerlukan
  tiga usulan unik dari owner atau miner yang sudah mengirim output valid untuk
  versi model tersebut. Jika jaringan masih kecil dan sebagian miner hilang,
  tidak akan ada tiga pengusul dan difficulty tidak dapat diubah lagi. Saat ini
  belum ada jalan keluar yang di-emergency-kan; menambahkannya butuh redeemploy.
- **Belum ada anti-sybil.** Satu orang bisa mengirim banyak output dari banyak
  wallet lalu ikut mengusulkan difficulty. Yang menutup ini adalah stake yang
  hilang ketika miner mengirim claim palsu, dan itu belum ada.
- **Enkripsi shard bersifat naratif.** Shard dipublikasikan di IPFS; "unlock"
  menggerakkan narasi/pesan AI on-chain, **bukan** membuka rahasia kriptografis.
  Jangan mengklaim model ini rahasia.
- Tidak ada anti-sybil bawaan: satu wallet bisa menyapu semua shard. Tambahkan
  time-gate atau batas per-address bila perlu.
- Pesan AI disimpan sebagai event log, bukan storage — murah, tapi hanya bisa
  dibaca lewat `eth_getLogs`, bukan `view`.

## Output tunggal: blockchain

Pesan AI dibaca dari event `ShardUnlocked` di explorer opBNB:

```
https://opbnb.bscscan.com/address/<CONTRACT_ADDRESS>#events
```
