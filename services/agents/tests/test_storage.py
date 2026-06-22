"""Unit tests for lib.storage download helpers (GSD-135).

_download_sync must translate a boto3 "object not found" ClientError into the
structured SourcePdfMissing exception so routers can map it to a 404; any other
ClientError must propagate unchanged.
"""
import os
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

os.environ.setdefault("S3_BUCKET", "test-bucket")
os.environ.setdefault("S3_ENDPOINT", "http://localhost:9000")
os.environ.setdefault("S3_ACCESS_KEY", "k")
os.environ.setdefault("S3_SECRET_KEY", "s")

import lib.storage as storage  # noqa: E402


def _client_raising(code: str) -> MagicMock:
    client = MagicMock()
    err = ClientError({"Error": {"Code": code}}, "GetObject")
    client.download_file.side_effect = err
    return client


@pytest.mark.parametrize("code", ["404", "NoSuchKey", "NotFound"])
def test_download_sync_maps_missing_to_source_pdf_missing(code):
    with patch.object(storage, "_client", return_value=_client_raising(code)):
        with pytest.raises(storage.SourcePdfMissing):
            storage._download_sync("paper/source.pdf", "/tmp/out.pdf")


def test_download_sync_propagates_other_client_errors():
    with patch.object(storage, "_client", return_value=_client_raising("AccessDenied")):
        with pytest.raises(ClientError):
            storage._download_sync("paper/source.pdf", "/tmp/out.pdf")
