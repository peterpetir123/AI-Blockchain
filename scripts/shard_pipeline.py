#!/usr/bin/env python3
"""
Shard pipeline: split the model file -> sha256 -> IPFS upload (Pinata) -> manifest.json

Note: the encryption here is NARRATIVE. Shards are public on IPFS; the "unlock"
only drives an on-chain narrative/message. There is no cryptographic secrecy.

Usage:
  python3 scripts/shard_pipeline.py model.bin --shards 8 --out shards/
  python3 scripts/shard_pipeline.py model.bin --shards 8 --no-upload   # without Pinata
"""
import argparse
import hashlib
import json
import os
import sys
import time
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
            # file smaller than the shard count -> reduce the effective shard count
            break
        p = out_dir / f"shard_{i}.bin"
        p.write_bytes(blob)
        parts.append(p)
    return parts


def upload_pinata(path: Path, jwt: str, attempts: int = 4) -> str:
    """Upload a single file to Pinata. Retries because slow connections often time out."""
    if requests is None:
        raise RuntimeError("the 'requests' package is required for Pinata upload")

    last_err = None
    for attempt in range(1, attempts + 1):
        try:
            with open(path, "rb") as f:
                r = requests.post(
                    PINATA_URL,
                    headers={"Authorization": f"Bearer {jwt}"},
                    files={"file": (path.name, f, "application/octet-stream")},
                    # (connect, read) - large read because the file is ~50 MB
                    timeout=(30, 900),
                )
            r.raise_for_status()
            return r.json()["IpfsHash"]
        except Exception as e:  # noqa: BLE001 - retry all network errors
            last_err = e
            wait = 5 * attempt
            print(f"  upload failed (attempt {attempt}/{attempts}): {e}")
            print(f"  retrying in {wait}s...")
            time.sleep(wait)

    raise RuntimeError(f"Pinata upload failed after {attempts} attempts: {last_err}")


def load_existing_manifest() -> dict:
    """Read an existing manifest.json (if any) to resume uploading from where it left off."""
    p = Path("manifest.json")
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text())
    except (json.JSONDecodeError, OSError):
        return {}
    return {item["shardId"]: item for item in data if "shardId" in item}


def save_manifest(manifest: list) -> None:
    Path("manifest.json").write_text(json.dumps(manifest, indent=2))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model", type=Path)
    ap.add_argument("--shards", type=int, default=8)
    ap.add_argument("--out", type=Path, default=Path("shards"))
    ap.add_argument("--difficulty", type=int, default=20)
    ap.add_argument("--no-upload", action="store_true")
    args = ap.parse_args()

    if not args.model.exists():
        sys.exit(f"File not found: {args.model}")

    jwt = os.environ.get("PINATA_JWT", "")
    if not args.no_upload and not jwt:
        sys.exit("PINATA_JWT is not set (or use --no-upload)")

    parts = split_file(args.model, args.shards, args.out)
    print(f"{args.model} ({args.model.stat().st_size} bytes) -> {len(parts)} shard")

    existing = load_existing_manifest()
    if existing:
        print(f"resuming: {sum(1 for i in existing.values() if i.get('cid'))} shards already have a CID")

    manifest = []
    for i, p in enumerate(parts):
        digest = sha256_file(p)
        prev = existing.get(i, {})
        cid = prev.get("cid", "")

        if not args.no_upload and not cid:
            cid = upload_pinata(p, jwt)
            print(f"  shard {i}: {p.name} sha256={digest.hex()[:16]}... cid={cid}")
        elif cid:
            print(f"  shard {i}: {p.name} sha256={digest.hex()[:16]}... cid={cid} (skipped, already present)")
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
        # save each shard so progress is not lost when an upload times out
        save_manifest(manifest)

    print("\nmanifest.json written. Next: npx hardhat run scripts/add_shards.js --network opbnb")


if __name__ == "__main__":
    main()
