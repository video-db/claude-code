---
name: videodb
description: Process videos using VideoDB Python SDK. Upload local files, URLs, or YouTube videos. Transcode, add subtitles, generate transcripts and thumbnails, search within videos, create video compilations, and capture real-time screen and audio with AI transcription and indexing. Use for Python projects working with video processing, video search, video editing, or real-time capture.
allowed-tools: Read Grep Glob Bash(python:*)
argument-hint: "[task description]"
---

# VideoDB Python SDK

## Prerequisites

Before using any VideoDB operations, ensure the environment is ready:

```bash
python scripts/setup_venv.py
python scripts/check_connection.py
```

If `videodb` is not installed or the virtual environment is missing, run `scripts/setup_venv.py` first. It will create a `.venv/` and install all dependencies from `requirements.txt`.

## Setup

### API Key

An API key from [VideoDB Console](https://console.videodb.io) is required.

```python
import videodb
from dotenv import load_dotenv

load_dotenv()  # loads VIDEO_DB_API_KEY from .env file

# Option 1: .env file (recommended)
# Copy .env.example to .env and fill in your key:
#   cp .env.example .env
# IMPORTANT: You must call load_dotenv() before videodb.connect()
# so the API key is available as an environment variable.
conn = videodb.connect()

# Option 2: Environment variable
# export VIDEO_DB_API_KEY="your-api-key"
conn = videodb.connect()

# Option 3: Pass directly
conn = videodb.connect(api_key="your-api-key")
```

> **Note:** The bundled scripts (e.g. `setup_venv.py`) load `.env` automatically, but when writing inline Python code you must call `load_dotenv()` yourself before `videodb.connect()`.

If the `VIDEO_DB_API_KEY` environment variable is not set and no key is passed, prompt the user for it.

### Connection Object

The connection object is the entry point to all VideoDB operations:

```python
conn = videodb.connect()
coll = conn.get_collection()  # default collection
```

## Quick Reference

### Upload Media

```python
# Upload from URL
video = coll.upload(url="https://example.com/video.mp4")

# Upload from YouTube
video = coll.upload(url="https://www.youtube.com/watch?v=VIDEO_ID")

# Upload local file
video = coll.upload(file_path="/path/to/video.mp4")

# Upload audio
audio = coll.upload(url="https://example.com/audio.mp3", media_type="audio")

# Upload image
image = coll.upload(url="https://example.com/image.jpg", media_type="image")
```

### Get Stream Link

```python
video = coll.get_video(video_id)
stream_url = video.generate_stream()
video.play()  # opens in browser
```

### Add Subtitles

```python
from videodb import SubtitleStyle

# Auto-generate subtitles from transcript
video.index_spoken_words()
stream_url = video.add_subtitle()

# With custom styling
stream_url = video.add_subtitle(style=SubtitleStyle(font_size=22))
```

### Transcripts

```python
# Generate transcript (must be done before text search)
video.index_spoken_words()

# Get transcript
transcript = video.get_transcript()
for entry in transcript:
    print(f"[{entry['start']:.1f}s - {entry['end']:.1f}s] {entry['text']}")

# Get full text
text = video.get_transcript_text()
```

### Thumbnails

```python
# Generate thumbnail at a specific timestamp
thumbnail = video.generate_thumbnail(time=10.5)
```

## Error Handling

```python
from videodb.exceptions import (
    AuthenticationError,   # Invalid or missing API key
    InvalidRequestError,   # Bad request parameters
    SearchError,           # Search operation failures
)

try:
    conn = videodb.connect()
except AuthenticationError:
    print("Check your VIDEO_DB_API_KEY")

try:
    video = coll.upload(url=url)
except InvalidRequestError as e:
    print(f"Upload failed: {e}")
```

## Search Inside Videos

Index and search video content by spoken words or visual scenes.

### Quick Start — Spoken Words

```python
video.index_spoken_words()
results = video.search("your query")

# Get a streamable HLS URL for the matching segments
stream_url = results.compile()

# Or open directly in the browser
results.play()
```

### Quick Start — Scene Search

```python
from videodb import SearchType, IndexType, SceneExtractionType

# Index scenes (returns an index ID)
scene_index_id = video.index_scenes(
    extraction_type=SceneExtractionType.shot_based,
    prompt="Describe the visual content in this scene.",
)

# Search using semantic search against the scene index
results = video.search(
    query="person writing on a whiteboard",
    search_type=SearchType.semantic,
    index_type=IndexType.scene,
    scene_index_id=scene_index_id,
)
stream_url = results.compile()
```

> Use `SearchType.semantic` with `index_type=IndexType.scene` for scene search. Pass `scene_index_id` to target a specific index. `SearchType.scene` exists but may not be available on all plans.

See [SEARCH.md](SEARCH.md) for the complete search and indexing guide.

## Generative Media

Create AI-generated images, videos, music, sound effects, voice, and text content.

### Quick Start

```python
image = coll.generate_image(
    prompt="a sunset over mountains",
    aspect_ratio="16:9",
)
```

See [GENERATIVE.md](GENERATIVE.md) for the complete AI generation guide.

## Collections

Organize media at scale using collections.

```python
# List all collections
collections = conn.get_collections()

# Create a new collection
coll = conn.create_collection(name="My Project", description="Project videos")

# Get specific collection
coll = conn.get_collection(collection_id)

# List videos in collection
videos = coll.get_videos()
```

See [REFERENCE.md](REFERENCE.md#collections) for complete collection management.

## Timeline Editing

Compose videos from multiple clips, add text/image/audio overlays, and trim segments — all non-destructive.

### Quick Start

```python
from videodb.timeline import Timeline
from videodb.asset import VideoAsset, TextAsset, TextStyle

timeline = Timeline(conn)
timeline.add_inline(VideoAsset(asset_id=video.id, start=10, end=30))
timeline.add_overlay(0, TextAsset(text="The End", duration=3, style=TextStyle(fontsize=36)))
stream_url = timeline.generate_stream()
```

See [EDITOR.md](EDITOR.md) for the complete timeline editing guide.

## Meeting Recording Analysis

Process meeting recordings to extract transcripts, generate summaries, identify action items and decisions.

### Quick Start

```python
meeting.index_spoken_words()
text = meeting.get_transcript_text()

result = coll.generate_text(
    prompt=f"Summarize this meeting with action items and decisions:\n{text}",
    model_name="pro",
)
print(result["output"])
```

See [MEETINGS.md](MEETINGS.md) for the complete meeting recording guide.

## Real-Time Streams

Generate streamable HLS URLs from videos, timelines, and search results for live playback.

### Quick Start

```python
stream_url = video.generate_stream()     # from a video
stream_url = timeline.generate_stream()  # from a timeline composition
stream_url = results.compile()           # from search results

# All return HLS (.m3u8) URLs playable in VLC or any HLS-compatible player.
```

See [RTSTREAM.md](RTSTREAM.md) for the complete real-time streams guide.

## Real-Time Capture

Capture screen, microphone, and system audio in real-time with AI transcription and indexing.

### Quick Start

```python
# Backend: create session
session = conn.create_capture_session(
    end_user_id="user-123",
    collection_id="default",
    callback_url="https://your-server.com/webhook",
)
token = conn.generate_client_token()
```

```python
# Client: start capture
from videodb.capture import CaptureClient
client = CaptureClient(client_token=token)
await client.request_permission("microphone")
await client.request_permission("screen_capture")
channels = await client.list_channels()
await client.start_session(capture_session_id=session.id, channels=channels.all())
```

See [CAPTURE.md](CAPTURE.md) for the complete capture guide.

## Next Steps

For advanced features, see:
- [SEARCH.md](SEARCH.md) - Search and indexing (semantic, keyword, scene-based)
- [EDITOR.md](EDITOR.md) - Timeline editing (overlays, trim, multi-clip composition)
- [MEETINGS.md](MEETINGS.md) - Meeting analysis (transcripts, summaries, action items)
- [RTSTREAM.md](RTSTREAM.md) - Real-time streams (HLS, dynamic composition, playback)
- [CAPTURE.md](CAPTURE.md) - Real-time capture (screen, audio, AI pipelines)
- [GENERATIVE.md](GENERATIVE.md) - AI-generated media (images, video, audio, voice)
- [REFERENCE.md](REFERENCE.md) - Complete API reference
- [USE_CASES.md](USE_CASES.md) - End-to-end workflow examples
