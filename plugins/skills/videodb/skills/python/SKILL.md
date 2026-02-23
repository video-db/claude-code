---
name: python
description: Process videos with the VideoDB Python SDK. Use for upload, transcript, subtitle, search, editing, and real-time capture workflows.
allowed-tools: Read Grep Glob Bash(python:*)
argument-hint: "[task description]"
---

# VideoDB Python Skill

Use this skill for VideoDB Python SDK workflows: upload, transcript, subtitle, search, timeline editing, generative media, and real-time capture.

## Setup

Run setup from the plugin root using absolute paths so it works regardless of current directory:

```bash
python "${CLAUDE_PLUGIN_ROOT}/skills/python/scripts/setup_venv.py"
python "${CLAUDE_PLUGIN_ROOT}/skills/python/scripts/check_connection.py"
```

## API Key

An API key from https://console.videodb.io is required.

```python
import videodb
from dotenv import load_dotenv

load_dotenv()
conn = videodb.connect()
coll = conn.get_collection()
```

If `VIDEO_DB_API_KEY` is not set and no key is passed to `videodb.connect()`, ask the user for it.

## Quick Reference

### Upload media

```python
# URL
video = coll.upload(url="https://example.com/video.mp4")

# YouTube
video = coll.upload(url="https://www.youtube.com/watch?v=VIDEO_ID")

# Local file
video = coll.upload(file_path="/path/to/video.mp4")
```

### Transcript + subtitle

```python
video.index_spoken_words()
text = video.get_transcript_text()
stream_url = video.add_subtitle()
```

### Search inside videos

```python
video.index_spoken_words()
results = video.search("product demo")
stream_url = results.compile()
```

### Scene search

```python
from videodb import SearchType, IndexType, SceneExtractionType

scene_index_id = video.index_scenes(
    extraction_type=SceneExtractionType.shot_based,
    prompt="Describe the visual content in this scene.",
)

results = video.search(
    query="person writing on a whiteboard",
    search_type=SearchType.semantic,
    index_type=IndexType.scene,
    scene_index_id=scene_index_id,
)
stream_url = results.compile()
```

### Timeline editing

```python
from videodb.timeline import Timeline
from videodb.asset import VideoAsset, TextAsset, TextStyle

timeline = Timeline(conn)
timeline.add_inline(VideoAsset(asset_id=video.id, start=10, end=30))
timeline.add_overlay(0, TextAsset(text="The End", duration=3, style=TextStyle(fontsize=36)))
stream_url = timeline.generate_stream()
```

### Generative media

```python
image = coll.generate_image(
    prompt="a sunset over mountains",
    aspect_ratio="16:9",
)
```

## Error handling

```python
from videodb.exceptions import AuthenticationError, InvalidRequestError

try:
    conn = videodb.connect()
except AuthenticationError:
    print("Check your VIDEO_DB_API_KEY")

try:
    video = coll.upload(url="https://example.com/video.mp4")
except InvalidRequestError as e:
    print(f"Upload failed: {e}")
```

## Additional docs in this plugin

- `${CLAUDE_PLUGIN_ROOT}/skills/python/REFERENCE.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/python/SEARCH.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/python/EDITOR.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/python/GENERATIVE.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/python/MEETINGS.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/python/RTSTREAM.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/python/CAPTURE.md`
