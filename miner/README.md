# AI Shard Miner

Mencari nonce untuk membuka shard AI di contract `AIShardUnlock` (opBNB).
Nonce dicari **lokal**; hanya transaksi final yang dikirim ke jaringan.

## Syarat
- Node.js 18+
- Wallet dengan sedikit **BNB** untuk gas (di opBNB ~0.00000002 BNB per tx)

## Pakai
```bash
npm install
export PRIVATE_KEY=0x...            # wallet kamu
node mine.js --contract 0xCONTRACT   # sapu semua shard terkunci
node mine.js --contract 0xCONTRACT --shard 2   # hanya shard tertentu
node mine.js --selftest              # cek logika tanpa jaringan
```

## Demo publik opBNB

Demo ini tidak memberi reward. Miner hanya menemukan nonce valid dan mengirim
satu transaksi unlock; siapa yang lebih dulu mengirim proof valid akan membuka
shard tersebut.

```bash
git clone <URL_REPO_PUBLIK> ai-agent
cd ai-agent/miner
npm install
npm run selftest

export PRIVATE_KEY=0xPRIVATE_KEY_WALLET_MINER_SENDIRI
export RPC_URL=https://opbnb-rpc.publicnode.com
node mine.js \
  --contract 0x8D34729c9802F388b88e18f34B23EEb8fA9B859b \
  --shard 9
```

Wallet miner harus punya sedikit BNB asli di opBNB untuk gas. Jangan pernah
memakai private key deployer atau membagikan private key ke orang lain.

Jika shard 8 sudah dibuka miner lain, program akan gagal/menemukan status
sudah terbuka. Itu normal untuk challenge kompetitif.

Shard `8` sudah dibuka pada transaksi uji. Challenge publik aktif adalah shard
`9`; siapa yang lebih dulu mengirim proof valid akan membukanya.

Env opsional: `RPC_URL` (default `https://opbnb-rpc.publicnode.com`),
`CONTRACT_ADDRESS` (biar tak perlu `--contract`).

## Cara kerja
Proof valid bila:

```
keccak256(abi.encodePacked(shardId, nonce)) < 2^256 >> difficulty
```

Semakin tinggi `difficulty`, semakin banyak nonce dicoba (2^difficulty rata-rata).
`difficulty 20` ≈ 1 juta percobaan; naikkan/rendahkan sesuai keinginan pembuat shard.

## Catatan
Enkripsi shard bersifat **naratif** — shard publik di IPFS. Unlock di sini
menggerakkan narasi/pesan AI on-chain, bukan membuka rahasia kriptografis.
