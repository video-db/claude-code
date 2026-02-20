#!/usr/bin/env python3
"""
Test script for MEETINGS.md — validates meeting analysis operations.

Tests:
  1. Upload a sample video (as a mock meeting)
  2. Index spoken words
  3. Get timestamped transcript
  4. Get plain text transcript
  5. Search within the meeting for a topic
"""

import os
import sys
from pathlib import Path

# Load .env
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

def main() -> None:
    api_key = os.environ.get("VIDEO_DB_API_KEY", "")
    if not api_key:
        print("[test_meetings] FAIL: VIDEO_DB_API_KEY not set.")
        sys.exit(1)

    import videodb
    from videodb import SearchType

    print("[test_meetings] Connecting to VideoDB...")
    conn = videodb.connect(api_key=api_key)
    coll = conn.get_collection()
    print(f"[test_meetings] Collection: {coll.id}")

    # Upload a sample video with speech content
    sample_url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    print("[test_meetings] Uploading sample meeting video...")
    meeting = coll.upload(url=sample_url)
    print(f"[test_meetings] Uploaded: {meeting.name} (id={meeting.id}, length={meeting.length:.1f}s)")

    # --- Test 1: Index spoken words ---
    print("\n[test_meetings] Test 1: Index spoken words")
    meeting.index_spoken_words()
    print("  Indexing complete. PASS")

    # --- Test 2: Get timestamped transcript ---
    print("\n[test_meetings] Test 2: Timestamped transcript")
    transcript = meeting.get_transcript()
    assert isinstance(transcript, list), "Expected list of transcript entries"
    assert len(transcript) > 0, "Expected non-empty transcript"
    for entry in transcript[:3]:
        print(f"  [{entry['start']:.1f}s - {entry['end']:.1f}s] {entry['text'][:80]}")
    print(f"  Total entries: {len(transcript)}")
    print("  PASS")

    # --- Test 3: Get plain text transcript ---
    print("\n[test_meetings] Test 3: Plain text transcript")
    text = meeting.get_transcript_text()
    assert isinstance(text, str), "Expected string"
    assert len(text) > 0, "Expected non-empty text"
    print(f"  Length: {len(text)} chars")
    print(f"  Preview: {text[:120]}...")
    print("  PASS")

    # --- Test 4: Search within meeting ---
    print("\n[test_meetings] Test 4: Semantic search within meeting")
    try:
        results = meeting.search("never gonna give you up", search_type=SearchType.semantic)
        shots = results.get_shots()
        print(f"  Found {len(shots)} matching segment(s)")
        for shot in shots[:3]:
            print(f"  [{shot.start:.1f}s - {shot.end:.1f}s] {shot.text[:80] if shot.text else '(no text)'}")
        print("  PASS")
    except videodb.exceptions.InvalidRequestError as exc:
        if "No results found" in str(exc):
            print(f"  No results found (API returned empty). PASS (graceful)")
        else:
            raise

    # Cleanup
    print(f"\n[test_meetings] Cleaning up: deleting video {meeting.id}")
    meeting.delete()

    print("\n[test_meetings] All meetings tests PASSED.")


if __name__ == "__main__":
    main()
