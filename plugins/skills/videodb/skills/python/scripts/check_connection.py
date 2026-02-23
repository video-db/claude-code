#!/usr/bin/env python3
"""
Connection verification script for VideoDB Python Skill.

Verifies that the API key is valid and a connection to VideoDB can be established.
Outputs a clear success or error message.

Usage:
  python scripts/check_connection.py
"""

import os
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    # Fallback: manually parse .env if python-dotenv is not yet installed
    _env_file = Path(__file__).resolve().parent.parent / ".env"
    if _env_file.is_file():
        for _line in _env_file.read_text().splitlines():
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _key, _, _val = _line.partition("=")
                os.environ.setdefault(_key.strip(), _val.strip())


def main() -> None:
    api_key = os.environ.get("VIDEO_DB_API_KEY", "")
    if not api_key:
        print("[check_connection] FAIL: VIDEO_DB_API_KEY is not set.")
        print("  Set it with: export VIDEO_DB_API_KEY=\"your-api-key\"")
        print("  Get a key from: https://console.videodb.io")
        sys.exit(1)

    try:
        import videodb
    except ImportError:
        print("[check_connection] FAIL: videodb is not installed.")
        print("  Run: python scripts/setup_venv.py")
        sys.exit(1)

    try:
        conn = videodb.connect(api_key=api_key)
        coll = conn.get_collection()
        videos = coll.get_videos()
        print(f"[check_connection] SUCCESS: Connected to VideoDB.")
        print(f"  Default collection: {coll.id}")
        print(f"  Videos in collection: {len(videos)}")
    except videodb.exceptions.AuthenticationError:
        print("[check_connection] FAIL: Authentication failed. Check your API key.")
        sys.exit(1)
    except Exception as exc:
        print(f"[check_connection] FAIL: Connection error: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
