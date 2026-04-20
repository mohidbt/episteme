# Document Conversion Reference

Convert PDFs, images, DOCX, and spreadsheets into markdown, HTML, JSON, or chunks.

## SDK Usage

```python
from datalab_sdk import DatalabClient, ConvertOptions

client = DatalabClient()
result = client.convert(
    "document.pdf",                    # or file_url="https://..."
    options=ConvertOptions(...),       # optional
    save_output="./output_dir",        # optional, saves files to disk
    max_polls=300,                     # polling attempts (default 300)
    poll_interval=1                    # seconds between polls (default 1)
)
```

### Async variant
```python
import asyncio
from datalab_sdk import AsyncDatalabClient, ConvertOptions

async def convert_async():
    client = AsyncDatalabClient()
    result = await client.convert("document.pdf", options=ConvertOptions(
        output_format="markdown",
        mode="balanced"
    ))
    print(result.markdown)

asyncio.run(convert_async())
```

## ConvertOptions Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `output_format` | str | `"markdown"` | `"markdown"`, `"html"`, `"json"`, or `"chunks"` |
| `mode` | str | `"fast"` | `"fast"`, `"balanced"`, or `"accurate"` |
| `paginate` | bool | `False` | Add page delimiter markers in output |
| `max_pages` | int | None | Limit number of pages to process |
| `page_range` | str | None | Specific pages, e.g. `"0-5"` (0-indexed, inclusive) |
| `disable_image_extraction` | bool | `False` | Skip extracting images |
| `disable_image_captions` | bool | `False` | Skip generating image captions |
| `track_changes` | bool | `False` | Extract tracked changes from DOCX files |
| `chart_understanding` | bool | `False` | Extract data from charts |
| `extract_links` | bool | `False` | Preserve hyperlinks in output |
| `save_checkpoint` | bool | `False` | Save parsed state for reuse with extract/segment |

## ConversionResult Fields

| Field | Type | Description |
|---|---|---|
| `success` | bool | Whether conversion succeeded |
| `markdown` | str | Markdown output (when format is markdown) |
| `html` | str | HTML output (when format is html) |
| `json` | dict | JSON output (when format is json) |
| `chunks` | list | Chunked output (when format is chunks) |
| `page_count` | int | Number of pages processed |
| `parse_quality_score` | float | Quality rating 0-5. Below 3 = consider retrying with higher mode |
| `images` | dict | Extracted images as base64-encoded strings, keyed by ID |
| `cost_breakdown` | dict | Cost in cents |
| `checkpoint_id` | str | Reusable ID for extract/segment (only if `save_checkpoint=True`) |

### Saving output to disk
```python
result.save_output("./output")
# Creates: output/document.md (or .html/.json), output/images/
```

## REST API

**Submit:**
```
POST https://www.datalab.to/api/v1/convert
Content-Type: multipart/form-data
X-API-Key: your-key

file: <binary>
output_format: markdown
mode: balanced
```

**Poll:**
```
GET https://www.datalab.to/api/v1/convert/{request_id}
X-API-Key: your-key
```

Response includes `status` field: `"processing"` or `"complete"`.

## CLI Usage

```bash
# Basic conversion
datalab convert document.pdf --output_format markdown

# With options
datalab convert document.pdf --output_format html --mode accurate --paginate

# Batch (entire directory)
datalab convert ./documents/ --max_concurrent 10 --extensions pdf,docx
```

## Output Format Guide

| Format | Best for | Notes |
|---|---|---|
| `markdown` | LLM consumption, text analysis | Default. Clean, readable |
| `html` | Preserving visual structure | Retains formatting, tables |
| `json` | Programmatic access to structure | Block-level document tree |
| `chunks` | RAG / vector DB ingestion | Pre-chunked for embedding |

## Quality Gate Pattern

Use `parse_quality_score` to auto-retry with higher accuracy:

```python
result = client.convert("complex.pdf", options=ConvertOptions(mode="fast"))

if result.parse_quality_score < 3:
    result = client.convert("complex.pdf", options=ConvertOptions(mode="accurate"))
```

## Gotchas

- **File size limit**: 200 MB per file, up to 7,000 pages
- **Results expire**: Datalab deletes results 1 hour after processing completes
- **`page_range` is 0-indexed**: First page is `"0"`, not `"1"`
- **`file_url` must be public**: Private/authenticated URLs won't work — use `file_path` for local files
- **`"fast"` mode struggles with**: Multi-column layouts, complex tables, handwritten text — use `"balanced"` or `"accurate"`
- **Images are base64**: Access via `result.images` dict, not as files (unless you call `save_output`)
