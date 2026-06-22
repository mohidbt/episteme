"""S3/MinIO download helpers for the agents service.

PDF readers (pypdf/pdfplumber via Chandra OCR, outline, and auto-highlight)
require a local file path. Papers in KM live in S3-compatible object storage,
so we download to a tempfile before reading and clean up afterwards.

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
from botocore.exceptions import ClientError


class SourcePdfMissing(Exception):
    """Raised when an object key cannot be downloaded because it is absent.

    Lets routers map a genuinely-missing source.pdf to a structured 404
    (`source_pdf_missing`) instead of leaking a raw boto3 ClientError as a 500.
    """


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
    try:
        _client().download_file(os.environ["S3_BUCKET"], key, dest)
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in {"404", "NoSuchKey", "NotFound"}:
            raise SourcePdfMissing(key) from exc
        raise


def _exists_sync(key: str) -> bool:
    try:
        _client().head_object(Bucket=os.environ["S3_BUCKET"], Key=key)
        return True
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in {"404", "NoSuchKey", "NotFound"}:
            return False
        raise


def paperSourceKey(paper_id: str) -> str:
    """Canonical object key for a paper source PDF."""
    return f"{paper_id}/source.pdf"


async def object_exists(key: str) -> bool:
    """Check whether an object key exists in S3-compatible storage."""
    return await asyncio.to_thread(_exists_sync, key)


@asynccontextmanager
async def download_to_tempfile(key: str, suffix: str = ".pdf"):
    """Download S3 object at `key` to a tempfile; yield path; delete on exit.

    Local-path passthrough: when ``key`` is an absolute path that exists on
    disk, yield it as-is and skip both the S3 download and the unlink.
    Gated behind ``EPISTEME_PDF_LOCAL_TEST=1`` so production NEVER accepts a
    local path even if a caller passed one in (the HMAC-authed pdf routes
    accept arbitrary file_path strings). Set this env var only in tests.
    """
    # Test-only local-path passthrough. Gated behind EPISTEME_PDF_LOCAL_TEST=1
    # so production NEVER accepts a local path even if a caller passed one in
    # (the HMAC-authed pdf routes accept arbitrary file_path strings).
    if (
        os.environ.get("EPISTEME_PDF_LOCAL_TEST") == "1"
        and key.startswith("/")
        and Path(key).is_file()
    ):
        yield key
        return
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
