# API Quick Reference

## Authentication

All requests require the `X-API-Key` header:
```
X-API-Key: your-api-key
```

Get your key from: https://www.datalab.to/app/keys

## Base URL

```
https://www.datalab.to/api/v1
```

## Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/convert` | Convert document to markdown/HTML/JSON/chunks |
| `GET` | `/convert/{request_id}` | Poll conversion status |
| `POST` | `/extract` | Extract structured data with JSON schema |
| `POST` | `/segment` | Segment document into sections |
| `POST` | `/fill` | Fill forms in PDFs and images |
| `POST` | `/track-changes` | Extract tracked changes from DOCX |
| `POST` | `/custom-processor` | Run AI-powered custom processor |
| `POST` | `/marker/extraction/gen_schemas` | Auto-generate extraction schemas |
| `POST` | `/pipelines` | Create a pipeline |
| `PUT` | `/pipelines/{id}/save` | Save pipeline with name |
| `POST` | `/pipelines/{id}/run` | Execute pipeline on a document |
| `GET` | `/pipelines/executions/{id}` | Check pipeline execution status |
| `GET` | `/pipelines/executions/{id}/steps/{index}/result` | Get step result |

## Request Pattern

Every operation follows the same async pattern:

```
1. POST /api/v1/{endpoint}     → returns request_id or request_check_url
2. GET  {request_check_url}    → poll until status == "complete"
3. Read results from completed response
```

### Polling Example (Python requests)

```python
import requests
import time

API_KEY = "your-key"
HEADERS = {"X-API-Key": API_KEY}

# Submit
resp = requests.post("https://www.datalab.to/api/v1/convert",
    headers=HEADERS,
    files={"file": open("doc.pdf", "rb")},
    data={"output_format": "markdown"})
check_url = resp.json()["request_check_url"]

# Poll
for _ in range(300):
    result = requests.get(check_url, headers=HEADERS).json()
    if result["status"] == "complete":
        print(result["markdown"])
        break
    time.sleep(2)
```

## File Input

Two options:
- **`file`**: Upload binary file via multipart form data
- **`file_url`**: Pass a publicly accessible URL (no auth headers forwarded)

## Supported File Types

| Category | Formats |
|---|---|
| Documents | PDF, DOCX, DOC, ODT |
| Spreadsheets | XLSX, XLS, XLSM, XLTX, CSV, ODS |
| Presentations | PPTX, PPT, ODP |
| Web/Publishing | HTML, EPUB |
| Images | PNG, JPEG/JPG, WebP, GIF, TIFF |

Detect MIME types in Python with the `filetype` library when file extensions are unreliable.

## Limits

| Limit | Value | When exceeded |
|---|---|---|
| Max file size | 200 MB | HTTP 413 |
| Max pages per request | 7,000 | HTTP 400 |
| Requests per minute | 400 | HTTP 429 (auto-retry in SDK) |
| Concurrent requests | 400 | HTTP 429 |
| Pages in flight | 5,000 | `success: false` in result (not HTTP 429) |

**Pages in flight** is different from request limits — it measures active pages being processed across all your requests at once, not per-minute volume. Always check the `success` field in results.

Enterprise customers can negotiate higher limits — contact support@datalab.to.

## Result Retention

Results are deleted from Datalab servers **1 hour after processing completes**. Always retrieve results promptly.

## Common Response Fields

All endpoints return these fields when complete:

| Field | Type | Description |
|---|---|---|
| `status` | str | `"processing"` or `"complete"` |
| `success` | bool | Whether the operation succeeded |
| `page_count` | int | Pages processed |
| `cost_breakdown` | dict | Cost in cents |
| `checkpoint_id` | str | If `save_checkpoint` was true |

## Error Handling

| HTTP Code | Type | Retryable | Action |
|---|---|---|---|
| 400 | `invalid_request_error` | No | Check parameters, file type, schema |
| 401 | `authentication_error` | No | Verify `X-API-Key` at datalab.to/app/keys |
| 403 | `permission_error` | No | Check subscription/billing at datalab.to/app/billing |
| 404 | `not_found_error` | No | Result expired (1h TTL) or wrong request ID |
| 413 | `request_too_large` | No | File exceeds 200 MB |
| 429 | `rate_limit_error` | **Yes** | Backoff and retry (SDK auto-retries) |
| 500 | `api_error` | **Yes** | Retry with exponential backoff |
| 529 | `overloaded_error` | **Yes** | Temporary overload — retry after delay |

The SDK auto-retries 429 and 500 with exponential backoff. For REST, implement your own retry logic for retryable codes.

For detailed troubleshooting, see `references/errors-and-troubleshooting.md`.

## Security

- **Never hardcode API keys** — use `DATALAB_API_KEY` env var (SDK reads it automatically)
- **Rotate keys** via dashboard — create the new key before revoking the old one
- **Results auto-delete** 1 hour after processing — retrieve promptly
- **Webhook endpoints** must use HTTPS; verify signatures with `X-Webhook-Signature` (HMAC-SHA256)
- **Minimize data exposure** — use `page_range` to send only the pages you need

## SDK vs REST

The Python SDK (`datalab-python-sdk`) wraps all REST endpoints and handles polling automatically. Prefer the SDK unless you need fine-grained control over the HTTP layer.

```python
# SDK — handles polling, retries, and result parsing
from datalab_sdk import DatalabClient
client = DatalabClient()
result = client.convert("doc.pdf")

# REST — manual polling required
import requests
resp = requests.post(url, headers=headers, files=files, data=data)
# ... poll loop ...
```
