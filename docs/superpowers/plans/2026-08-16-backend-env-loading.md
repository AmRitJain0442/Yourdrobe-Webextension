# Backend `.env` Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load private YouCam keys automatically from `backend/.env` while preserving process-environment precedence.

**Architecture:** `YouCamClient.from_environment()` loads the backend-local file immediately before reading `YOUCAM_API_KEYS`. `python-dotenv` performs the standard parsing with `override=False`; the existing client retains all key normalization and failover behavior.

**Tech Stack:** Python 3, `python-dotenv`, `unittest`, PowerShell, Git

## Global Constraints

- The real `backend/.env` remains ignored and must never be staged or printed.
- A shell-provided `YOUCAM_API_KEYS` value overrides the file value.
- No key parsing, ordering, deduplication, failover, or redaction behavior changes.
- No guided capture, provider category, settings UI, secret manager, or deployment system is added.
- Use one implementation micro-commit after the already committed design and plan commits.

---

### Task 1: Load the backend-local environment file

**Files:**
- Create locally, ignored: `backend/.env`
- Create: `backend/.env.example`
- Modify: `backend/requirements.txt`
- Modify: `backend/app/youcam.py`
- Modify: `backend/tests/test_youcam.py`
- Modify: `README.md`

**Interfaces:**
- Consumes: `YOUCAM_API_KEYS` as a comma-separated string.
- Produces: `YouCamClient.from_environment() -> YouCamClient`, with process variables taking precedence over `backend/.env`.

- [ ] **Step 1: Write failing environment-file tests**

Add imports and two real-behavior tests using a temporary `.env` path:

```python
from pathlib import Path
from tempfile import TemporaryDirectory

import app.youcam as youcam

def test_reads_keys_from_backend_env_file(self) -> None:
    with TemporaryDirectory() as directory:
        env_file = Path(directory) / ".env"
        env_file.write_text("YOUCAM_API_KEYS=file-one,file-two\n", encoding="utf-8")
        with patch.object(youcam, "ENV_FILE", env_file), patch.dict(os.environ, {}, clear=False):
            os.environ.pop("YOUCAM_API_KEYS", None)
            client = YouCamClient.from_environment()
    self.assertEqual(client.key_count, 2)

def test_process_environment_overrides_backend_env_file(self) -> None:
    with TemporaryDirectory() as directory:
        env_file = Path(directory) / ".env"
        env_file.write_text("YOUCAM_API_KEYS=file-one,file-two\n", encoding="utf-8")
        with patch.object(youcam, "ENV_FILE", env_file), patch.dict(
            os.environ, {"YOUCAM_API_KEYS": "shell-only"}
        ):
            client = YouCamClient.from_environment()
    self.assertEqual(client.key_count, 1)
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
$env:PYTHONPATH='backend'
backend\.venv\Scripts\python.exe -m unittest backend.tests.test_youcam.YouCamClientTest.test_reads_keys_from_backend_env_file backend.tests.test_youcam.YouCamClientTest.test_process_environment_overrides_backend_env_file -v
```

Expected: both tests fail because `app.youcam.ENV_FILE` and automatic `.env` loading do not exist.

- [ ] **Step 3: Add the minimal loader**

Add `python-dotenv>=1,<2` to `backend/requirements.txt`, then add:

```python
from pathlib import Path

from dotenv import load_dotenv

ENV_FILE = Path(__file__).resolve().parents[1] / ".env"

@classmethod
def from_environment(cls) -> "YouCamClient":
    load_dotenv(ENV_FILE, override=False)
    return cls.from_value(os.getenv("YOUCAM_API_KEYS", ""))
```

- [ ] **Step 4: Add safe configuration files and documentation**

Create the ignored `backend/.env` with:

```dotenv
YOUCAM_API_KEYS=
```

Create committed `backend/.env.example` with:

```dotenv
YOUCAM_API_KEYS=first-api-key,second-api-key
```

Update README live-mode setup to copy/edit `backend/.env`, start Uvicorn normally, and state that a PowerShell environment variable remains an optional higher-priority override.

- [ ] **Step 5: Install the locked dependency and verify GREEN**

Run:

```powershell
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
$env:PYTHONPATH='backend'
backend\.venv\Scripts\python.exe -m unittest backend.tests.test_youcam -v
```

Expected: all YouCam tests pass, including the two new tests.

- [ ] **Step 6: Run the complete verification gate**

Run:

```powershell
$env:PYTHONPATH='backend'
backend\.venv\Scripts\python.exe -m unittest backend.tests.test_youcam backend.tests.test_api -v
npm.cmd --prefix extension test
npm.cmd --prefix extension run build
git check-ignore backend/.env
git diff --check
git status --short --branch
```

Expected: all tests and build pass; `git check-ignore` prints `backend/.env`; no real key appears in the diff or status.

- [ ] **Step 7: Commit and push**

```powershell
git add README.md backend/.env.example backend/requirements.txt backend/app/youcam.py backend/tests/test_youcam.py
git commit -m "feat: load backend env file"
git push origin feature/hackathon-slice
```

Verify the remote branch hash matches local `HEAD`. Do not stage `backend/.env`.
