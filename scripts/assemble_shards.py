#!/usr/bin/env python3
"""Download shard CIDs from Pinata's shared gateway and rebuild the GGUF file."""

import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


GATEWAY = "https://gateway.pinata.cloud/ipfs/{}"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return "0x" + digest.hexdigest()


def download(cid: str, destination: Path, attempts: int = 4) -> None:
    url = GATEWAY.format(cid)
    for attempt in range(1, attempts + 1):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "quorix-ai-shard-assembler/1.0"})
            with urllib.request.urlopen(request, timeout=900) as response, destination.open("wb") as output:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    output.write(chunk)
            return
        except (OSError, urllib.error.URLError) as error:
            if destination.exists():
                destination.unlink()
            if attempt == attempts:
                raise RuntimeError(f"gagal mengunduh {cid}: {error}") from error
            wait = attempt * 5
            print(f"  download failed ({attempt}/{attempts}), retrying in {wait}s")
            time.sleep(wait)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=Path("manifest.json"))
    parser.add_argument("--out", type=Path, default=Path("shards/model_reconstructed.gguf"))
    parser.add_argument("--refresh", action="store_true", help="download again even if the shard file already exists")
    args = parser.parse_args()

    if not args.manifest.exists():
        sys.exit(f"Manifest not found: {args.manifest}")

    manifest = json.loads(args.manifest.read_text())
    if not isinstance(manifest, list) or not manifest:
        sys.exit("manifest.json must be a non-empty shard list")
    manifest = sorted(manifest, key=lambda item: item["shardId"])
    args.out.parent.mkdir(parents=True, exist_ok=True)

    verified_paths = []
    for item in manifest:
        shard_id = item["shardId"]
        cid = item.get("cid", "")
        expected = item["sha256"].lower()
        if not cid:
            sys.exit(f"Shard {shard_id} has no CID")

        path = args.out.parent / f"downloaded_shard_{shard_id}.bin"
        if args.refresh or not path.exists():
            print(f"Shard {shard_id}: downloading from Pinata ({cid})")
            download(cid, path)
        else:
            print(f"Shard {shard_id}: reusing the existing download")

        actual = sha256_file(path).lower()
        if actual != expected:
            path.unlink(missing_ok=True)
            raise RuntimeError(f"shard {shard_id} hash mismatch: local {actual}, manifest {expected}")
        if path.stat().st_size != item["bytes"]:
            raise RuntimeError(f"shard {shard_id} size mismatch")
        print(f"  OK sha256={actual} bytes={path.stat().st_size}")
        verified_paths.append(path)

    temporary = args.out.with_suffix(args.out.suffix + ".tmp")
    with temporary.open("wb") as output:
        for path in verified_paths:
            with path.open("rb") as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    output.write(chunk)
    temporary.replace(args.out)

    final_hash = sha256_file(args.out).lower()
    print(f"\nFile hasil: {args.out}")
    print(f"Ukuran   : {args.out.stat().st_size} bytes")
    print(f"SHA-256  : {final_hash}")
    print("Reconstruction complete.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, json.JSONDecodeError, KeyError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
