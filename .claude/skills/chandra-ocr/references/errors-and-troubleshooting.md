# Errors and Troubleshooting

Read this when Datalab operations fail or produce unexpected results.

## SDK Exception Hierarchy

The Python SDK maps HTTP errors to typed exceptions. Codes 429 and 500 are auto-retried with exponential backoff.

```python
from datalab_sdk import DatalabClient

client = DatalabClient()
try:
    result = client.convert("doc.pdf")
except DatalabAPIError as e:
    # Covers all API errors (400, 401, 403, 404, 413, 529)
    print(f"API error {e.status_code}: {e.message}")
except DatalabFileError as e:
    # File not found, unreadable, or wrong format
    print(f"File error: {e}")
except DatalabTimeoutError as e:
    # Polling timed out waiting for result
    print(f"Timeout: {e}")
except DatalabValidationError as e:
    # Invalid parameters (bad schema, invalid mode, etc.)
    print(f"Validation: {e}")
```

## Authentication Issues

**401 — Invalid API Key**
- Verify key at https://www.datalab.to/app/keys
- Check the key is set correctly: `echo $DATALAB_API_KEY`
- SDK reads `DATALAB_API_KEY` env var automatically — don't pass it to the constructor

**403 — Permission / Subscription**
- **No active subscription**: Upgrade at datalab.to/pricing
- **Expired subscription**: Check billing at datalab.to/app/billing
- **Failed payment**: Update payment method
- **Wrong team key**: Request IDs are team-scoped — use the same API key for submission and retrieval

## Rate Limiting

**429 — Request Rate Limit**
- Default: 400 requests per minute, 400 concurrent
- SDK auto-retries with exponential backoff
- For REST: implement retry with `backoff_factor=4`
- Spread requests rather than bursting

**Pages in Flight Limit (not HTTP 429)**
- Max 5,000 pages being processed at once across all requests
- Returns `"success": false` in the result payload, not an HTTP error
- **Always check the `success` field** — don't just check HTTP status
- Wait for in-flight pages to complete before submitting more

```python
# Correct pattern: check success field
result = client.convert("big_doc.pdf")
if not result.success:
    print("Processing failed — likely page concurrency limit")
    # Wait and retry
```

## File-Related Errors

**400 — Unsupported File Type**
- Accepted: PDF, DOCX, DOC, ODT, XLSX, XLS, XLSM, XLTX, CSV, ODS, PPTX, PPT, ODP, HTML, EPUB, PNG, JPEG, WebP, GIF, TIFF
- Verify actual content matches extension (a `.pdf` that's really HTML will fail)

**413 — File Too Large**
- Max file size: 200 MB
- Max pages per request: 7,000
- Use `page_range` to process specific sections of large documents

**400 — Page Count Exceeded**
- For documents with 7,000+ pages, process in chunks using `page_range`

## Result Expiration

**404 — Result Not Found**
- Results auto-delete **1 hour** after processing completes
- Retrieve results immediately after completion
- For async workflows, use webhooks (`webhook_url` parameter) to get notified the moment processing finishes

## Processing Quality Issues

**Low parse quality on scanned documents**
- Check `parse_quality_score` (0-5 scale). Below 3 = poor quality
- Switch to `mode="accurate"` for scanned/photographed documents
- `"fast"` mode skips OCR enhancement — use `"balanced"` or `"accurate"` for scans

**Extraction returning wrong or empty values**
- Add `description` fields to your schema — they significantly improve accuracy
- Keep schemas flat (avoid deep nesting)
- Use specific field names (`invoice_number` not `id`)
- For complex layouts, use `mode="accurate"`

**Segmentation with low confidence**
- Add specific descriptions to segmentation schema sections
- Vague descriptions like "Other content" produce poor results
- Check `confidence` field in results and flag low-confidence segments for review

## Webhook Issues

- Endpoint must be HTTPS and publicly reachable
- Verify signatures using `X-Webhook-Signature` header (HMAC-SHA256)
- 4xx responses from your endpoint are **not retried** — ensure your endpoint returns 200
- Use `request_id` for deduplication in case of webhook retries
- Test with webhook.site before production deployment

## Debugging Checklist

When something fails:

1. **Check `success` field** — not just HTTP status code
2. **Check `parse_quality_score`** — below 3 means try `mode="accurate"`
3. **Check error response body** — `detail` field has specifics
4. **Check rate limits** — are you hitting 429s? Check concurrent request count
5. **Check file** — is it a supported type? Under 200 MB? Under 7,000 pages?
6. **Check result age** — is it more than 1 hour old? Results are auto-deleted
7. **Check API key** — is it valid and does it have an active subscription?
