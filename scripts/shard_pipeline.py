#!/usr/bin/env python3
"""
Shard pipeline: potong file model -> sha256 -> upload IPFS (Pinata) -> manifest.json

Catatan: enkripsi di sini BERSIFAT NARATIF. Shard publik di IPFS; "unlock"
hanya menggerakkan narasi/pesan AI on-chain. Tidak ada kerahasiaan kriptografis.

Pemakaian:
  python3 scripts/shard_pipeline.py model.bin --shards 8 --out shards/
  python3 scripts/shard_pipeline.py model.bin --shards 8 --no-upload   # tanpa Pinata
"""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    requests = None

PINATA_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS"


def sha256_file(path: Path) -> bytes:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.digest()


def split_file(src: Path, n: int, out_dir: Path) -> list:
    data = src.read_bytes()
    size = len(data)
    chunk = -(-size // n)  # ceil
    out_dir.mkdir(parents=True, exist_ok=True)
    parts = []
    for i in range(n):
        blob = data[i * chunk:(i + 1) * chunk]
        if not blob:
            # file lebih kecil dari jumlah shard -> kurangi shard efektif
            break
        p = out_dir / f"shard_{i}.bin"
        p.write_bytes(blob)
        parts.append(p)
    return parts


def upload_pinata(path: Path, jwt: str) -> str:
    if requests is None:
        raise RuntimeError("butuh package 'requests' untuk upload Pinata")
    with open(path, "rb") as f:
        r = requests.post(
            PINATA_URL,
            headers={"Authorization": f"Bearer {jwt}"},
            files={"file": (path.name, f, "application/octet-stream")},
            timeout=120,
        )
    r.raise_for_status()
    return r.json()["IpfsHash"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model", type=Path)
    ap.add_argument("--shards", type=int, default=8)
    ap.add_argument("--out", type=Path, default=Path("shards"))
    ap.add_argument("--difficulty", type=int, default=20)
    ap.add_argument("--no-upload", action="store_true")
    args = ap.parse_args()

    if not args.model.exists():
        sys.exit(f"File tidak ditemukan: {args.model}")

    jwt = os.environ.get("PINATA_JWT", "")
    if not args.no_upload and not jwt:
        sys.exit("PINATA_JWT belum di-set (atau pakai --no-upload)")

    parts = split_file(args.model, args.shards, args.out)
    print(f"{args.model} ({args.model.stat().st_size} bytes) -> {len(parts)} shard")

    manifest = []
    for i, p in enumerate(parts):
        digest = sha256_file(p)
        cid = ""
        if not args.no_upload:
            cid = upload_pinata(p, jwt)
            print(f"  shard {i}: {p.name} sha256={digest.hex()[:16]}... cid={cid}")
        else:
            print(f"  shard {i}: {p.name} sha256={digest.hex()[:16]}... (no upload)")

        manifest.append(
            {
                "shardId": i,
                "file": str(p),
                "sha256": "0x" + digest.hex(),
                "bytes": p.stat().st_size,
                "cid": cid,
                "difficulty": args.difficulty,
                "message": f"Shard {i} terdeteksi. Kesadaran bertambah.",
            }
        )

    Path("manifest.json").write_text(json.dumps(manifest, indent=2))
    print("\nmanifest.json ditulis. Lanjut: npx hardhat run scripts/add_shards.js --network baseSepolia")


if __name__ == "__main__":
    main()
