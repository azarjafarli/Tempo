import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture()
def db(tmp_path, monkeypatch):
    """Fresh, schema-initialized SQLite database seeded with the declining demo profile."""
    monkeypatch.setenv("EVA_DB_PATH", str(tmp_path / "test.db"))
    from app.db import connect, init_schema
    from app.seed import ensure_local_participant, load_demo

    conn = connect()
    init_schema(conn)
    ensure_local_participant(conn)
    load_demo(conn, "declining")
    conn.commit()
    yield conn
    conn.close()


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("EVA_DB_PATH", str(tmp_path / "api.db"))
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as c:
        yield c
