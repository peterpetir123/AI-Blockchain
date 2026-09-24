# AI Shard Unlock Agent

Agent AI yang hidup **sepenuhnya on-chain**. Modelnya dipecah jadi shard;
tiap shard terbuka lewat proof-of-work, dan saat terbuka contract memancarkan
pesan AI permanen yang bisa dibaca siapa pun dari event log blockchain.

Jaringan: **opBNB mainnet** (chainId 204, gas ~0.001 gwei).

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
├── contracts/AIShardUnlock.sol   # contract inti
├── test/                         # unit + integrasi miner<->contract
├── scripts/
│   ├── deploy_contract.js        # deploy + cetak address & topic hash
│   ├── add_shards.js             # registrasi shard dari manifest.json
│   └── shard_pipeline.py         # split file -> sha256 -> IPFS -> manifest.json
├── miner/                        # miner publik (bagikan ke komunitas)
└── hardhat.config.js
```

## Setup

```bash
npm install
cp .env.example .env      # isi PRIVATE_KEY (wallet ber-BNB), PINATA_JWT
npx hardhat test          # 8 test harus lulus
```

## Alur kerja

```bash
# 1. Pecah model jadi shard + hash (+ upload IPFS bila PINATA_JWT diisi)
python3 scripts/shard_pipeline.py model.bin --shards 8 --difficulty 20

# 2. Deploy contract
npx hardhat run scripts/deploy_contract.js --network opbnb

# 3. Daftarkan shard
npx hardhat run scripts/add_shards.js --network opbnb

# 4. Komunitas mining
cd miner && npm install
PRIVATE_KEY=0x... node mine.js --contract 0xCONTRACT
```

## Aturan proof

Proof valid bila:

```
keccak256(abi.encodePacked(shardId, nonce)) < 2^256 >> difficulty
```

`2^difficulty` = rata-rata jumlah nonce yang harus dicoba. `difficulty 20` ≈ 1 juta.

## Batasan yang disengaja

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
