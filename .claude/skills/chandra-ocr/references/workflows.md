# Workflows Reference

Patterns for batch processing, pipelines, and handling long documents.

## Batch Processing

### Async SDK (recommended)

Process multiple files concurrently using `AsyncDatalabClient`:

```python
import asyncio
import glob
from datalab_sdk import AsyncDatalabClient, ConvertOptions

async def convert_batch(file_paths):
    client = AsyncDatalabClient()
    tasks = [
        client.convert(fp, options=ConvertOptions(mode="balanced"))
        for fp in file_paths
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    for fp, result in zip(file_paths, results):
        if isinstance(result, Exception):
            print(f"FAILED {fp}: {result}")
        elif result.success:
            print(f"OK {fp}: {result.page_count} pages, score={result.parse_quality_score}")
        else:
            print(f"FAILED {fp}: conversion unsuccessful")

    return results

files = glob.glob("./documents/*.pdf")
results = asyncio.run(convert_batch(files))
```

### CLI Batch

```bash
datalab convert ./documents/ \
    --output_format markdown \
    --max_concurrent 10 \
    --extensions pdf,docx
```

### REST API with Threading

```python
import requests
from requests.adapters import HTTPAdapter, Retry
from concurrent.futures import ThreadPoolExecutor
import time

API_KEY = "your-key"
BASE = "https://www.datalab.to/api/v1"

session = requests.Session()
session.mount("https://", HTTPAdapter(max_retries=Retry(
    total=5,
    backoff_factor=4,
    status_forcelist=[429]
)))

def convert_file(file_path):
    # Submit
    resp = session.post(f"{BASE}/convert", headers={"X-API-Key": API_KEY},
        files={"file": open(file_path, "rb")},
        data={"output_format": "markdown", "mode": "balanced"})
    check_url = resp.json()["request_check_url"]

    # Poll
    for _ in range(300):
        result = session.get(check_url, headers={"X-API-Key": API_KEY}).json()
        if result["status"] == "complete":
            return result
        time.sleep(2)
    raise TimeoutError(f"Timed out: {file_path}")

with ThreadPoolExecutor(max_workers=10) as pool:
    futures = {pool.submit(convert_file, f): f for f in files}
```

### Rate Limits

| Limit | Value | When exceeded |
|---|---|---|
| Requests per minute | 400 | HTTP 429 |
| Concurrent requests | 400 | HTTP 429 |
| Pages in flight | 5,000 | `success: false` in result |

**Best practices:**
- Start with 5-10 workers, scale up if no 429s
- Use exponential backoff with `backoff_factor=4`
- Write results incrementally (don't accumulate in memory for large batches)
- Always check the `success` field — page-in-flight limits return `success: false`, not HTTP 429
- For troubleshooting batch failures, see `references/errors-and-troubleshooting.md`

---

## Handling Long Documents (50+ pages)

Three strategies, from simplest to most sophisticated:

### Strategy 1: Page Range Restriction

When you know which pages you need:

```python
result = client.extract("long_report.pdf", options=ExtractOptions(
    page_schema=schema,
    page_range="0-5",  # only first 6 pages
    mode="balanced"
))
```

Charges only for pages processed. Best when the target content is in a known location (e.g., summary on page 1, financials on pages 45-50).

### Strategy 2: TOC-Based Segmentation

Extract the table of contents first, then process each section:

```python
from datalab_sdk import DatalabClient, ConvertOptions, ExtractOptions

client = DatalabClient()

# Step 1: Extract TOC from first few pages
toc_schema = {
    "type": "object",
    "properties": {
        "sections": {
            "type": "array",
            "description": "Table of contents entries",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Section title"},
                    "start_page": {"type": "number", "description": "Starting page number"}
                }
            }
        }
    }
}

toc_result = client.extract("report.pdf", options=ExtractOptions(
    page_schema=toc_schema,
    page_range="0-6",
    save_checkpoint=True,
    mode="balanced"
))
toc = toc_result.extraction_schema_json
checkpoint = toc_result.checkpoint_id

# Step 2: Process each section with targeted schema
for section in toc["sections"]:
    start = section["start_page"] - 1  # convert to 0-indexed
    section_result = client.extract("report.pdf", options=ExtractOptions(
        checkpoint_id=checkpoint,
        page_schema=section_specific_schema,
        page_range=f"{start}-{start + 10}"
    ))
```

### Strategy 3: Auto Segmentation

When there's no clear TOC:

```python
from datalab_sdk import SegmentOptions

seg_result = client.segment("long_doc.pdf", options=SegmentOptions(
    segmentation_schema={
        "sections": [
            {"name": "Introduction", "description": "Opening and background"},
            {"name": "Analysis", "description": "Core analysis and findings"},
            {"name": "Conclusion", "description": "Summary and recommendations"}
        ]
    },
    save_checkpoint=True,
    mode="balanced"
))

# Process each segment independently
for seg in seg_result.segmentation_results:
    pages = seg["pages"]
    page_range = f"{min(pages)}-{max(pages)}"
    # Extract with targeted schema for this segment type...
```

---

## Pipelines

Chain multiple processors into versioned, reusable workflows.

### Processor Types

| Type | Role | Position |
|---|---|---|
| `convert` | Transform document to structured format | Always first |
| `segment` | Split into logical sections | After convert |
| `extract` | Pull structured data via schema | Terminal (last) |
| `custom` | Run AI-powered custom logic | Middle |

**Valid chains:**
- `convert → extract`
- `convert → segment → extract`
- `convert → custom → extract`
- `convert → segment → custom → extract`

### Pipeline Lifecycle

`draft` → `saved` → `published`

- **Draft**: Auto-saved as you edit, not listed
- **Saved**: Named, appears in listings
- **Published**: Immutable snapshot for production. Editing creates a new draft

### Create and Run a Pipeline

```python
import requests

API_KEY = "your-key"
BASE = "https://www.datalab.to/api/v1"
headers = {"X-API-Key": API_KEY, "Content-Type": "application/json"}

# Step 1: Create pipeline
pipeline = requests.post(f"{BASE}/pipelines", headers=headers, json={
    "steps": [
        {"type": "convert", "config": {"output_format": "markdown", "mode": "balanced"}},
        {"type": "extract", "config": {"page_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Document title"},
                "key_findings": {"type": "array", "items": {"type": "string"},
                    "description": "Main findings or conclusions"}
            }
        }}}
    ]
}).json()
pipeline_id = pipeline["id"]

# Step 2: Save
requests.put(f"{BASE}/pipelines/{pipeline_id}/save", headers=headers,
    json={"name": "report-extractor"})

# Step 3: Run against a document
execution = requests.post(f"{BASE}/pipelines/{pipeline_id}/run", headers=headers,
    files={"file": open("report.pdf", "rb")}).json()
exec_id = execution["execution_id"]

# Step 4: Poll for completion
import time
while True:
    status = requests.get(f"{BASE}/pipelines/executions/{exec_id}",
        headers=headers).json()
    if status["status"] == "complete":
        break
    time.sleep(2)

# Step 5: Get results per step
for i in range(len(pipeline["steps"])):
    step_result = requests.get(
        f"{BASE}/pipelines/executions/{exec_id}/steps/{i}/result",
        headers=headers).json()
    print(f"Step {i}: {step_result}")
```

### Pipeline Key Points

- Each processor's output feeds into the next via checkpoints — no manual checkpoint passing needed
- Published pipelines are immutable — safe for production use
- Pipelines can be rerun on different documents without reconfiguration
- Use the Forge UI at datalab.to for visual pipeline building
