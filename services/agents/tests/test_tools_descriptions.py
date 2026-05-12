"""Tests that tool descriptions contain required precondition language (Phase 1.9e T7+)."""
from tools.data import csv_write_cell


def test_csv_write_cell_description_states_precondition():
    """csv_write_cell description must mention read_paper precondition."""
    desc = csv_write_cell.description
    assert "read_paper" in desc
    assert "MUST" in desc
    assert "precondition" in desc.lower()
