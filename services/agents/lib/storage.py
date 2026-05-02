"""S3/MinIO download helper for Chandra OCR.

Datalab SDK requires a local file path (`Path(file_path).exists()` check).
Papers in KM live in S3-compatible object storage, so we download to a
tempfile before invoking Chandra and clean up afterwards.

Env vars (mirror apps/km/.env):
  S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY
"""
from __future__ import annotations

import asyncio
import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

import boto3
from botocore.client import Config


def _client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ["S3_ENDPOINT"],
        aws_access_key_id=os.environ["S3_ACCESS_KEY"],
        aws_secret_access_key=os.environ["S3_SECRET_KEY"],
        config=Config(signature_version="s3v4"),
        region_name="us-east-1",
    )


def _download_sync(key: str, dest: str) -> None:
    _client().download_file(os.environ["S3_BUCKET"], key, dest)


@asynccontextmanager
async def download_to_tempfile(key: str, suffix: str = ".pdf"):
    """Download S3 object at `key` to a tempfile; yield path; delete on exit."""
    fd, path = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    try:
        await asyncio.to_thread(_download_sync, key, path)
        yield path
    finally:
        try:
            Path(path).unlink(missing_ok=True)
        except OSError:
            pass
