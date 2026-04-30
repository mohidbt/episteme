"""Tool registry — exports ALL_TOOLS for use by km_agent factory."""
from langchain_core.tools import BaseTool

from tools.library import TOOLS as _LIBRARY_TOOLS
from tools.notes import TOOLS as _NOTES_TOOLS
from tools.paper_search import TOOLS as _PAPER_SEARCH_TOOLS
from tools.pdfs import TOOLS as _PDF_TOOLS
from tools.publish import TOOLS as _PUBLISH_TOOLS
from tools.revisions import TOOLS as _REVISION_TOOLS
from tools.web_search import TOOLS as _WEB_SEARCH_TOOLS

ALL_TOOLS: list[BaseTool] = (
    _NOTES_TOOLS
    + _PDF_TOOLS
    + _LIBRARY_TOOLS
    + _REVISION_TOOLS
    + _PUBLISH_TOOLS
    + _PAPER_SEARCH_TOOLS
    + _WEB_SEARCH_TOOLS
)
