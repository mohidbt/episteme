# Document Segmentation Reference

Split multi-document PDFs into logical sections. Useful for batch-scanned files, combined documents, or any PDF that contains multiple document types requiring different processing.

## SDK Usage

```python
from datalab_sdk import DatalabClient, SegmentOptions

client = DatalabClient()

result = client.segment("combined_documents.pdf", options=SegmentOptions(
    segmentation_schema={
        "sections": [
            {"name": "Invoice", "description": "Billing or payment document"},
            {"name": "Contract", "description": "Legal agreement or terms"},
            {"name": "Receipt", "description": "Proof of purchase or payment"}
        ]
    },
    mode="balanced"
))

for segment in result.segmentation_results:
    print(f"{segment['name']}: pages {segment['page_range']}")
```

### Async variant
```python
import asyncio
from datalab_sdk import AsyncDatalabClient, SegmentOptions

async def segment_async():
    client = AsyncDatalabClient()
    result = await client.segment("combined.pdf", options=SegmentOptions(
        segmentation_schema={
            "sections": [
                {"name": "Report", "description": "Analytical report"},
                {"name": "Appendix", "description": "Supporting materials"}
            ]
        }
    ))
    return result.segmentation_results

asyncio.run(segment_async())
```

## SegmentOptions Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `segmentation_schema` | dict | required | JSON defining expected section names and descriptions |
| `checkpoint_id` | str | None | Reuse a prior conversion's parsed state |
| `mode` | str | `"fast"` | `"fast"`, `"balanced"`, or `"accurate"` |
| `save_checkpoint` | bool | `False` | Save parsed state for subsequent operations |
| `max_pages` | int | None | Limit pages to process |
| `page_range` | str | None | Specific pages, e.g. `"0-5"` (0-indexed) |
| `skip_cache` | bool | `False` | Force re-processing |
| `webhook_url` | str | None | URL for completion notification |

## Segmentation Result Fields

| Field | Type | Description |
|---|---|---|
| `segmentation_results` | list | Segments with `name`, `page_range`, and `confidence` |
| `success` | bool | Whether segmentation succeeded |
| `markdown` | str | Raw conversion output |
| `page_count` | int | Total pages processed |
| `cost_breakdown` | dict | Cost in cents |

### Result structure
```python
result.segmentation_results
# [
#     {"name": "Invoice", "pages": [0, 1, 2], "confidence": "high"},
#     {"name": "Contract", "pages": [3, 4, 5, 6], "confidence": "medium"},
#     {"name": "Receipt", "pages": [7], "confidence": "high"}
# ]
```

## Schema Design

The segmentation schema tells the model what document types to look for.

**Be specific in descriptions:**
```python
# Good — gives the model clear signals
{
    "sections": [
        {"name": "W2 Tax Form", "description": "IRS W-2 wage and tax statement"},
        {"name": "Pay Stub", "description": "Employer payroll summary with earnings and deductions"},
        {"name": "Bank Statement", "description": "Monthly bank account activity summary"}
    ]
}

# Bad — too vague
{
    "sections": [
        {"name": "Form", "description": "A form"},
        {"name": "Statement", "description": "A statement"}
    ]
}
```

**Auto-detection:** If you don't know what document types are in the PDF, you can use a broad schema and let the model identify them, or omit specific types for auto-detection.

## Segment → Extract Workflow

The most powerful pattern: segment a multi-doc PDF, then extract different data from each segment using targeted schemas.

```python
from datalab_sdk import DatalabClient, ConvertOptions, SegmentOptions, ExtractOptions

client = DatalabClient()

# Step 1: Convert with checkpoint
conv = client.convert("batch_scan.pdf", options=ConvertOptions(
    save_checkpoint=True,
    mode="balanced"
))

# Step 2: Segment using checkpoint
seg = client.segment("batch_scan.pdf", options=SegmentOptions(
    checkpoint_id=conv.checkpoint_id,
    segmentation_schema={
        "sections": [
            {"name": "Invoice", "description": "Billing document"},
            {"name": "Contract", "description": "Legal agreement"}
        ]
    }
))

# Step 3: Extract from each segment with a targeted schema
invoice_schema = {
    "type": "object",
    "properties": {
        "invoice_number": {"type": "string", "description": "Invoice ID"},
        "total": {"type": "number", "description": "Total amount due"}
    }
}

for segment in seg.segmentation_results:
    if segment["name"] == "Invoice":
        pages = segment["pages"]
        page_range = f"{min(pages)}-{max(pages)}"

        ext = client.extract("batch_scan.pdf", options=ExtractOptions(
            checkpoint_id=conv.checkpoint_id,
            page_schema=invoice_schema,
            page_range=page_range
        ))
        print(ext.extraction_schema_json)
```

## REST API

```
POST https://www.datalab.to/api/v1/segment
Content-Type: multipart/form-data
X-API-Key: your-key

file: <binary>
segmentation_schema: {"sections": [...]}
mode: balanced
```

Poll the returned `request_check_url` until `status == "complete"`.

## Gotchas

- **Schema is required**: You must define what sections to look for
- **Confidence levels**: Results include `"high"`, `"medium"`, or `"low"` confidence — use this to flag uncertain boundaries for review
- **Use checkpoints**: Always convert with `save_checkpoint=True` first if you'll also extract from segments — avoids re-parsing
- **`page_range` is 0-indexed**: `"0-4"` = first 5 pages
- **Results expire in 1 hour**
