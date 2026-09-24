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
