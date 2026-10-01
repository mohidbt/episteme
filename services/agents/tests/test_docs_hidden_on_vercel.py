import importlib

import pytest
from fastapi.testclient import TestClient

import app as app_module


@pytest.fixture
def deployed_app(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    importlib.reload(app_module)
    yield app_module.app
    monkeypatch.delenv("VERCEL")
    importlib.reload(app_module)


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_api_docs_are_not_served_on_vercel(deployed_app, path):
    assert TestClient(deployed_app).get(path).status_code == 404


def test_openapi_still_served_off_vercel():
    assert TestClient(app_module.app).get("/openapi.json").status_code == 200
