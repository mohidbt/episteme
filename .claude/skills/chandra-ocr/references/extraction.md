# Structured Extraction Reference

Extract structured data from documents using JSON schemas. Define the fields you need, and Datalab parses the document to populate them.

## SDK Usage

```python
from datalab_sdk import DatalabClient, ExtractOptions

client = DatalabClient()

schema = {
    "type": "object",
    "properties": {
        "invoice_number": {"type": "string", "description": "The invoice ID or number"},
        "date": {"type": "string", "description": "Invoice date in YYYY-MM-DD format"},
        "line_items": {
            "type": "array",
            "description": "List of items on the invoice",
            "items": {
                "type": "object",
                "properties": {
                    "description": {"type": "string"},
                    "quantity": {"type": "number"},
                    "unit_price": {"type": "number"}
                }
            }
        },
        "total_amount": {"type": "number", "description": "Total amount due in USD"}
    }
}

result = client.extract("invoice.pdf", options=ExtractOptions(
    page_schema=schema,
    mode="balanced"
))

data = result.extraction_schema_json
print(data["invoice_number"])
print(data["line_items"])
```

### Async variant
```python
import asyncio
from datalab_sdk import AsyncDatalabClient, ExtractOptions

async def extract_async():
    client = AsyncDatalabClient()
    result = await client.extract("invoice.pdf", options=ExtractOptions(
        page_schema=schema,
        mode="balanced"
    ))
    return result.extraction_schema_json

asyncio.run(extract_async())
```

## ExtractOptions Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page_schema` | dict | None | JSON schema defining fields to extract (required unless using `schema_id`) |
| `schema_id` | str | None | ID of a saved schema (alternative to `page_schema`) |
| `checkpoint_id` | str | None | Reuse a prior conversion's parsed state |
| `mode` | str | `"fast"` | `"fast"`, `"balanced"`, or `"accurate"` |
| `output_format` | str | `"markdown"` | Format for the raw conversion output alongside extraction |
| `max_pages` | int | None | Limit pages to process |
| `page_range` | str | None | Specific pages, e.g. `"0-5"` (0-indexed) |
| `save_checkpoint` | bool | `False` | Save parsed state for subsequent operations |
| `webhook_url` | str | None | URL for completion notification |

## Extraction Result Fields

| Field | Type | Description |
|---|---|---|
| `extraction_schema_json` | dict | The extracted data matching your schema |
| `success` | bool | Whether extraction succeeded |
| `markdown` | str | Raw conversion output |
| `page_count` | int | Pages processed |
| `cost_breakdown` | dict | Cost in cents |

## Schema Design Best Practices

Good schemas produce better extraction. These patterns matter:

**Use descriptive field names:**
```json
{"invoice_number": {"type": "string"}}
```
Not: `{"id": {"type": "string"}}` — too ambiguous.

**Always include `description` fields:**
```json
{
    "total": {
        "type": "number",
        "description": "The final total amount due, after tax and discounts, in USD"
    }
}
```
Descriptions give the model context about what to look for and how to format it.

**Use correct types:**
- `"number"` for amounts, quantities, percentages
- `"string"` for text, dates, IDs
- `"array"` for repeating items (line items, rows)
- `"boolean"` for yes/no fields

**Keep schemas flat when possible:**
Deeply nested schemas reduce accuracy. If you can flatten, do it.

**Use arrays for repeating data:**
```json
{
    "line_items": {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "description": {"type": "string"},
                "amount": {"type": "number"}
            }
        }
    }
}
```

## Confidence Scoring (Beta)

Extraction results include per-field confidence scores on a 1-5 scale. These are auto-calculated and help identify fields where the model is uncertain.

Use confidence scores to flag results for human review when scores fall below your threshold.

## Citation Tracking

Extracted values can include block IDs referencing their source location in the document. This is useful for audit trails and verification — you can trace each extracted value back to the exact block in the parsed document.

## Auto-Generate Schemas

Don't know what fields to extract? Let Datalab suggest schemas:

```
POST https://www.datalab.to/api/v1/marker/extraction/gen_schemas
```

This analyzes the document and returns three schema suggestions at different complexity levels. Useful for exploring unfamiliar document types.

## REST API

**Submit:**
```
POST https://www.datalab.to/api/v1/extract
Content-Type: multipart/form-data
X-API-Key: your-key

file: <binary>
page_schema: {"type":"object","properties":{...}}
mode: balanced
```

**Poll:** Same pattern as conversion — check the returned `request_check_url` until `status == "complete"`.

## Checkpoint Reuse Pattern

If you already converted the document, skip re-parsing:

```python
# Convert first
conv_result = client.convert("report.pdf", options=ConvertOptions(save_checkpoint=True))

# Extract using checkpoint — much faster, no re-parsing cost
ext_result = client.extract("report.pdf", options=ExtractOptions(
    checkpoint_id=conv_result.checkpoint_id,
    page_schema=schema
))
```

## Saved Schemas

Store extraction schemas in Datalab and reference them by ID instead of sending the full JSON every time. Useful for standardized document types across a team.

### Create a Saved Schema

```python
from datalab_sdk import DatalabClient

client = DatalabClient()
schema = client.create_schema(
    name="invoice-v1",
    schema={
        "type": "object",
        "properties": {
            "invoice_number": {"type": "string", "description": "Invoice ID"},
            "total_amount": {"type": "number", "description": "Total due in USD"}
        }
    }
)
schema_id = schema["id"]  # e.g. "sch_k8Hx9mP2nQ4v"
```

### Extract Using a Saved Schema

```python
result = client.extract("invoice.pdf", options=ExtractOptions(
    schema_id="sch_k8Hx9mP2nQ4v",
    schema_version=1,  # pin to specific version
    mode="balanced"
))
```

**`page_schema` and `schema_id` are mutually exclusive** — provide exactly one or the API returns 400.

### Schema Versioning

Updating a schema creates a new version. Always pin `schema_version` alongside `schema_id` in production to ensure consistent results:

```python
# Update schema (creates version 2)
client.update_schema(schema_id, schema={...}, create_version=True)

# Old code still uses version 1 — unaffected
result = client.extract("doc.pdf", options=ExtractOptions(
    schema_id=schema_id,
    schema_version=1
))
```

### Other Operations

```python
# List all schemas
schemas = client.list_schemas()              # excludes archived
schemas = client.list_schemas(include_archived=True)

# Get a specific schema
schema = client.get_schema(schema_id)

# Archive (soft-delete — removes from default listing)
client.archive_schema(schema_id)
```

## Gotchas

- **Schema is required**: You must provide either `page_schema` or `schema_id` — not both, not neither
- **Flat > nested**: Deeply nested schemas reduce accuracy — flatten where possible
- **Descriptions matter a lot**: Vague or missing descriptions lead to wrong extractions
- **`page_range` is 0-indexed**: `"0-2"` = first 3 pages
- **Large docs**: For 50+ page documents, use page ranges or segmentation to target relevant sections. See `references/workflows.md` for long document strategies
- **Results expire in 1 hour**: Retrieve extracted data promptly
- **Pin schema versions**: If using `schema_id` in production, always include `schema_version` to prevent breakage when schemas are updated
