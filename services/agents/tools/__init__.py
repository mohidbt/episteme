"""Tool registry — exports ALL_TOOLS for use by km_agent factory."""
from langchain_core.tools import BaseTool

from tools.data import TOOLS as _DATA_TOOLS
from tools.drive_ops import TOOLS as _DRIVE_OPS_TOOLS
from tools.library import TOOLS as _LIBRARY_TOOLS
from tools.notes import TOOLS as _NOTES_TOOLS
from tools.paper_search import TOOLS as _PAPER_SEARCH_TOOLS
from tools.papers import TOOLS as _PAPERS_TOOLS
from tools.pdfs import TOOLS as _PDF_TOOLS
from tools.publish import TOOLS as _PUBLISH_TOOLS
from tools.revisions import TOOLS as _REVISION_TOOLS
from tools.paperset_enrich import TOOLS as _PAPERSET_ENRICH_TOOLS
from tools.references_ai import TOOLS as _REFERENCES_AI_TOOLS
from tools.search import TOOLS as _SEARCH_TOOLS
from tools.user_highlights import TOOLS as _USER_HIGHLIGHTS_TOOLS
from tools.web_search import TOOLS as _WEB_SEARCH_TOOLS

ALL_TOOLS: list[BaseTool] = (
    _NOTES_TOOLS
    + _PDF_TOOLS
    + _LIBRARY_TOOLS
    + _REVISION_TOOLS
    + _PUBLISH_TOOLS
    + _PAPER_SEARCH_TOOLS
    + _PAPERS_TOOLS
    + _DATA_TOOLS
    + _DRIVE_OPS_TOOLS
    + _PAPERSET_ENRICH_TOOLS
    + _REFERENCES_AI_TOOLS
    + _SEARCH_TOOLS
    + _USER_HIGHLIGHTS_TOOLS
    + _WEB_SEARCH_TOOLS
)
