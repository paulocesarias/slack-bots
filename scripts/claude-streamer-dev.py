#!/usr/bin/env python3
"""
Claude Slack Streamer - Streams Claude CLI output to Slack with real-time progress updates.

Usage:
    SLACK_TOKEN=xoxb-... python3 claude-streamer.py <channel> <thread_ts> <message_ts> <session_id> <base64_message> [base64_files_json]

    The Slack token MUST be passed via the SLACK_TOKEN environment variable (not as argument)
    to prevent token exposure in process listings.

Features:
    - Real-time progress updates (Editing file..., Creating file..., Running command...)
    - Silently counts read operations (no spam)
    - Summary of actions taken (Done: read 3 file(s), edited 1 file(s))
    - Session persistence for conversation continuity
    - Image support (png, jpg, jpeg, gif, webp)
    - PDF support
"""

import sys
import json
import subprocess
import requests
import base64
import os
import tempfile
import shutil
import stat
import logging
import time
import re
from logging.handlers import RotatingFileHandler
from datetime import datetime

# Supported file types
IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.webp'}
PDF_EXTENSIONS = {'.pdf'}
SUPPORTED_EXTENSIONS = IMAGE_EXTENSIONS | PDF_EXTENSIONS

# File limits (security: prevent resource exhaustion)
MAX_FILE_SIZE_MB = 10  # Maximum file size in MB
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
MAX_FILE_COUNT = 5  # Maximum number of files per message

# Streaming text configuration
STREAM_UPDATE_INTERVAL_MS = 500  # Minimum time between Slack updates (rate limit protection)
STREAM_MIN_CHARS = 50  # Minimum new characters before updating
STREAM_TYPING_INDICATOR = "..."  # Simple ellipsis while streaming
SLACK_MAX_MESSAGE_LENGTH = 39000  # Slack's limit is 40000, leave buffer for safety

# Logging configuration
LOG_DIR = "/var/log/claude-streamer"
LOG_FILE = os.path.join(LOG_DIR, "claude-streamer.log")
LOG_MAX_BYTES = 10 * 1024 * 1024  # 10MB
LOG_BACKUP_COUNT = 5

# Setup logger
logger = logging.getLogger('claude-streamer')
logger.setLevel(logging.INFO)

# Only add handler if log directory exists and is writable
if os.path.exists(LOG_DIR) and os.access(LOG_DIR, os.W_OK):
    try:
        file_handler = RotatingFileHandler(
            LOG_FILE,
            maxBytes=LOG_MAX_BYTES,
            backupCount=LOG_BACKUP_COUNT
        )
        file_handler.setFormatter(logging.Formatter(
            '%(asctime)s [%(levelname)s] %(message)s'
        ))
        logger.addHandler(file_handler)
    except Exception as e:
        print(f"Warning: Could not setup file logging: {e}", file=sys.stderr)

def log_event(level, message, channel=None, session=None, **extra):
    """Log an event with optional context."""
    context_parts = []
    if channel:
        context_parts.append(f"channel={channel}")
    if session:
        context_parts.append(f"session={session[:8]}...")  # Truncate UUID for readability
    for k, v in extra.items():
        context_parts.append(f"{k}={v}")

    context = " ".join(context_parts)
    full_message = f"{context} {message}" if context else message

    if level == "info":
        logger.info(full_message)
    elif level == "warning":
        logger.warning(full_message)
    elif level == "error":
        logger.error(full_message)

def send_slack(token, channel, thread_ts, text):
    """Send a message to Slack. Returns message timestamp if successful."""
    try:
        response = requests.post(
            "https://slack.com/api/chat.postMessage",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"channel": channel, "thread_ts": thread_ts, "text": text},
            timeout=10
        )
        data = response.json()
        if data.get("ok"):
            return data.get("ts")
    except Exception as e:
        print(f"Error sending to Slack: {e}", file=sys.stderr)
    return None

def update_slack_message(token, channel, ts, text, timeout=10):
    """Update an existing Slack message. Returns True if successful."""
    try:
        # Truncate if too long (Slack limit is 40000 chars)
        if len(text) > SLACK_MAX_MESSAGE_LENGTH:
            text = text[:SLACK_MAX_MESSAGE_LENGTH] + "\n\n_[Message truncated - exceeded Slack's 40KB limit]_"

        response = requests.post(
            "https://slack.com/api/chat.update",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"channel": channel, "ts": ts, "text": text},
            timeout=timeout
        )
        data = response.json()
        if not data.get("ok"):
            error = data.get("error", "unknown")
            print(f"Slack update error: {error} (ts={ts}, text_len={len(text)})", file=sys.stderr)
            return False
        return True
    except requests.exceptions.Timeout:
        print(f"Slack update timeout after {timeout}s (ts={ts}, text_len={len(text)})", file=sys.stderr)
        return False
    except Exception as e:
        print(f"Error updating Slack message: {e} (ts={ts}, text_len={len(text)})", file=sys.stderr)
        return False

def add_reaction(token, channel, timestamp, emoji):
    """Add a reaction to a message."""
    try:
        requests.post(
            "https://slack.com/api/reactions.add",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"channel": channel, "timestamp": timestamp, "name": emoji},
            timeout=10
        )
    except Exception as e:
        print(f"Error adding reaction: {e}", file=sys.stderr)

def remove_reaction(token, channel, timestamp, emoji):
    """Remove a reaction from a message."""
    try:
        requests.post(
            "https://slack.com/api/reactions.remove",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"channel": channel, "timestamp": timestamp, "name": emoji},
            timeout=10
        )
    except Exception as e:
        print(f"Error removing reaction: {e}", file=sys.stderr)

def get_file_size_from_slack(token, file_url):
    """Get file size using HEAD request before downloading."""
    try:
        response = requests.head(
            file_url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
            allow_redirects=True
        )
        if response.status_code == 200:
            content_length = response.headers.get('Content-Length')
            if content_length:
                return int(content_length)
    except Exception as e:
        print(f"Error getting file size: {e}", file=sys.stderr)
    return None

def download_slack_file(token, file_url, dest_path, max_size=MAX_FILE_SIZE_BYTES):
    """Download a file from Slack with size limit."""
    try:
        # Stream download to check size as we go
        response = requests.get(
            file_url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=60,
            stream=True
        )
        if response.status_code == 200:
            # Check Content-Length header if available
            content_length = response.headers.get('Content-Length')
            if content_length and int(content_length) > max_size:
                print(f"File too large: {int(content_length)} bytes (max: {max_size})", file=sys.stderr)
                return False, "exceeds_size_limit"

            # Download with size check
            downloaded_size = 0
            with open(dest_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    downloaded_size += len(chunk)
                    if downloaded_size > max_size:
                        print(f"File exceeded size limit during download: {downloaded_size} bytes", file=sys.stderr)
                        f.close()
                        os.remove(dest_path)
                        return False, "exceeds_size_limit"
                    f.write(chunk)
            return True, None
        else:
            print(f"Failed to download file: HTTP {response.status_code} - URL: {file_url[:100]} - Response: {response.text[:200]}", file=sys.stderr)
    except Exception as e:
        print(f"Error downloading file: {e}", file=sys.stderr)
    return False, "download_error"

def main():
    # Get Slack token from environment variable (security: not visible in ps aux)
    slack_token = os.environ.get('SLACK_TOKEN')
    if not slack_token:
        print("Error: SLACK_TOKEN environment variable is required", file=sys.stderr)
        print("Usage: SLACK_TOKEN=xoxb-... python3 claude-streamer.py <channel> <thread_ts> <message_ts> <session_id> <base64_message> [base64_files_json]")
        sys.exit(1)

    if len(sys.argv) < 6:
        print("Usage: SLACK_TOKEN=xoxb-... python3 claude-streamer.py <channel> <thread_ts> <message_ts> <session_id> <base64_message> [base64_files_json]")
        print("  SLACK_TOKEN      - Slack Bot OAuth token (xoxb-...) - via environment variable")
        print("  channel          - Slack channel ID")
        print("  thread_ts        - Thread timestamp for replies")
        print("  message_ts       - Original message timestamp (for reactions)")
        print("  session_id       - Claude session UUID for conversation continuity")
        print("  base64_message   - User message encoded in base64")
        print("  base64_files_json - Optional: JSON array of file objects [{url_private, name, mimetype}] encoded in base64")
        sys.exit(1)

    channel = sys.argv[1]
    thread_ts = sys.argv[2]
    message_ts = sys.argv[3]  # The actual message to react to
    session_id = sys.argv[4]

    # Decode and clean the message
    raw_message = base64.b64decode(sys.argv[5]).decode('utf-8')

    # Remove Slack mention patterns (e.g., <@U12345678>) since they add no meaning
    message = re.sub(r'<@[A-Z0-9]+>', '', raw_message).strip()

    # Log session start
    log_event("info", "Session started", channel=channel, session=session_id,
              message_length=len(message))

    # Parse optional files argument
    files = []
    if len(sys.argv) >= 7 and sys.argv[6]:
        try:
            files_json = base64.b64decode(sys.argv[6]).decode('utf-8')
            files = json.loads(files_json) if files_json else []
        except Exception as e:
            print(f"Error parsing files: {e}", file=sys.stderr)

    # Reaction emojis
    PROCESSING_EMOJI = "hourglass_flowing_sand"
    SUCCESS_EMOJI = "white_check_mark"
    ERROR_EMOJI = "x"

    # Add processing reaction to user's message
    add_reaction(slack_token, channel, message_ts, PROCESSING_EMOJI)

    # Create temp directory for downloaded files with secure permissions
    # Use user-specific runtime directory when available (more secure, RAM-based)
    uid = os.getuid()
    runtime_dir = f"/run/user/{uid}" if os.path.exists(f"/run/user/{uid}") else None
    temp_dir = tempfile.mkdtemp(prefix="claude_slack_", dir=runtime_dir)
    # Restrict permissions to owner only (rwx------)
    os.chmod(temp_dir, stat.S_IRWXU)
    downloaded_files = []

    try:
        # Filter to supported files only and check count limit
        supported_files = []
        for file_info in files:
            file_url = file_info.get('url_private') or file_info.get('url_private_download')
            file_name = file_info.get('name', 'file')
            mimetype = file_info.get('mimetype', '')
            file_size = file_info.get('size', 0)  # Slack provides file size in metadata

            if not file_url:
                continue

            # Check if it's a supported file type
            ext = os.path.splitext(file_name)[1].lower()
            is_image = ext in IMAGE_EXTENSIONS or mimetype.startswith('image/')
            is_pdf = ext in PDF_EXTENSIONS or mimetype == 'application/pdf'

            if is_image or is_pdf:
                supported_files.append({
                    'url': file_url,
                    'name': file_name,
                    'mimetype': mimetype,
                    'size': file_size,
                    'is_image': is_image
                })

        # Check file count limit
        if len(supported_files) > MAX_FILE_COUNT:
            send_slack(slack_token, channel, thread_ts,
                f"Too many files attached ({len(supported_files)}). Maximum is {MAX_FILE_COUNT} files per message. Processing first {MAX_FILE_COUNT} only.")
            supported_files = supported_files[:MAX_FILE_COUNT]

        # Download supported files (images and PDFs)
        for file_info in supported_files:
            file_url = file_info['url']
            file_name = file_info['name']
            file_size = file_info['size']
            is_image = file_info['is_image']
            file_type = "image" if is_image else "PDF"

            # Check file size from Slack metadata first (before downloading)
            if file_size and file_size > MAX_FILE_SIZE_BYTES:
                size_mb = file_size / (1024 * 1024)
                send_slack(slack_token, channel, thread_ts,
                    f"Skipped {file_type} `{file_name}`: {size_mb:.1f}MB exceeds {MAX_FILE_SIZE_MB}MB limit")
                continue

            dest_path = os.path.join(temp_dir, file_name)
            success, error = download_slack_file(slack_token, file_url, dest_path)
            if success:
                downloaded_files.append({
                    'path': dest_path,
                    'name': file_name,
                    'type': 'image' if is_image else 'pdf'
                })
                send_slack(slack_token, channel, thread_ts, f"Downloaded {file_type}: `{file_name}`")
                log_event("info", f"File downloaded: {file_name}", channel=channel, session=session_id,
                          file_type=file_type)
            elif error == "exceeds_size_limit":
                send_slack(slack_token, channel, thread_ts,
                    f"Skipped {file_type} `{file_name}`: exceeds {MAX_FILE_SIZE_MB}MB limit")
                log_event("warning", f"File rejected (size limit): {file_name}", channel=channel, session=session_id)
            else:
                send_slack(slack_token, channel, thread_ts, f"Failed to download {file_type}: `{file_name}`")
                log_event("error", f"File download failed: {file_name}", channel=channel, session=session_id)

        # Build the message with file references
        # If files were downloaded, prepend instructions to read them
        full_message = message
        if downloaded_files:
            file_instructions = []
            for f in downloaded_files:
                file_instructions.append(f"- {f['type'].upper()}: {f['path']}")

            files_text = "\n".join(file_instructions)
            if message:
                full_message = f"""The user has attached the following file(s). Please read and analyze them as part of your response:

{files_text}

User's message: {message}"""
            else:
                # No text message, just files - ask Claude to analyze them
                full_message = f"""The user has attached the following file(s). Please read and analyze them:

{files_text}"""

        # Validate that we have a meaningful message to send
        # Check for empty, whitespace-only, or effectively empty content
        if not full_message or not full_message.strip():
            # User just mentioned the bot without a message - give them a friendly prompt
            send_slack(slack_token, channel, thread_ts, "Hey! How can I help you? Just type your question or request after mentioning me.")
            remove_reaction(slack_token, channel, message_ts, PROCESSING_EMOJI)
            add_reaction(slack_token, channel, message_ts, SUCCESS_EMOJI)  # Not an error, just a prompt
            log_event("info", "Empty message - sent help prompt", channel=channel, session=session_id,
                      raw_length=len(raw_message) if 'raw_message' in dir() else 0)
            return

        # Build Claude command
        # Try --session-id first (for new sessions), fall back to --resume (for existing sessions)
        def build_cmd(use_session_id=True):
            c = [
                "claude",
                "--output-format", "stream-json",
                "--verbose",
                "-p", full_message,
            ]
            if use_session_id:
                c.extend(["--session-id", session_id])
            else:
                c.extend(["--resume", session_id])
            c.append("--dangerously-skip-permissions")
            if downloaded_files:
                c.extend(["--add-dir", temp_dir])
            return c

        # Track start time for duration calculation if result event is missing
        start_time = time.time()

        # Try --session-id first, if it fails with "already in use", switch to --resume
        cmd = build_cmd(use_session_id=True)
        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

        # Peek at first line to check for session error
        first_line = process.stdout.readline()
        if first_line and "already in use" in first_line:
            # Session exists, use --resume instead
            process.kill()
            process.wait()
            cmd = build_cmd(use_session_id=False)
            process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            first_line = None  # Don't process this line again

        # Track actions
        edits = 0
        writes = 0
        reads = 0
        commands = 0
        globs = 0
        greps = 0
        web_fetches = 0
        web_searches = 0
        tasks = 0
        mcp_calls = 0
        final_result = ""
        result_stats = {}  # Will capture cost, duration, tokens from result event
        reported_files = set()  # Avoid duplicate reports
        reported_actions = set()  # Avoid duplicate action reports
        error_lines = []  # Capture non-JSON output for debugging

        # Streaming text state
        streaming_text = ""  # Accumulated text from assistant messages
        streaming_msg_ts = None  # Slack message ts for updates
        last_stream_update = 0  # Timestamp of last Slack update
        last_streamed_len = 0  # Length of text at last update

        # Track continuation messages for very long responses
        continuation_count = 0

        # Track all messages for long responses (list of ts values)
        all_message_ts_list = []

        # Helper function to update streaming message in Slack
        def update_stream_if_needed(force=False):
            nonlocal streaming_msg_ts, last_stream_update, last_streamed_len, streaming_text, continuation_count, all_message_ts_list
            now = time.time() * 1000  # Current time in ms

            # Check if we should update
            new_chars = len(streaming_text) - last_streamed_len
            time_elapsed = now - last_stream_update

            should_update = force or (
                new_chars >= STREAM_MIN_CHARS and
                time_elapsed >= STREAM_UPDATE_INTERVAL_MS
            )

            if not should_update or not streaming_text:
                return True  # Nothing to do is success

            # Add typing indicator if not final update
            display_text = streaming_text + (STREAM_TYPING_INDICATOR if not force else "")

            # Use longer timeout for final updates (force=True)
            update_timeout = 30 if force else 10

            # Check if message is getting too long for Slack
            # Use a safe cutoff point to avoid splitting mid-word
            SAFE_CUTOFF = SLACK_MAX_MESSAGE_LENGTH - 200  # Extra buffer for continuation text

            if len(display_text) > SLACK_MAX_MESSAGE_LENGTH:
                # Find a good break point (end of line or space) near the safe cutoff
                break_point = SAFE_CUTOFF
                # Try to find a newline near the break point
                newline_pos = streaming_text.rfind('\n', SAFE_CUTOFF - 500, SAFE_CUTOFF)
                if newline_pos > 0:
                    break_point = newline_pos
                else:
                    # Try to find a space
                    space_pos = streaming_text.rfind(' ', SAFE_CUTOFF - 100, SAFE_CUTOFF)
                    if space_pos > 0:
                        break_point = space_pos

                # Finalize current message and start a new one
                if streaming_msg_ts:
                    finalized_text = streaming_text[:break_point] + "\n\n_[Continued in next message...]_"
                    update_slack_message(slack_token, channel, streaming_msg_ts, finalized_text, timeout=update_timeout)
                    all_message_ts_list.append(streaming_msg_ts)

                # Keep the remainder for the continuation
                remainder = streaming_text[break_point:].lstrip()  # Remove leading whitespace from continuation

                # Reset for continuation
                continuation_count += 1
                streaming_text = f"_[Continuation {continuation_count}]_\n\n" + remainder
                streaming_msg_ts = None
                last_streamed_len = 0

                # Recalculate display_text with new streaming_text
                display_text = streaming_text + (STREAM_TYPING_INDICATOR if not force else "")

            update_success = False
            if streaming_msg_ts:
                # Update existing message
                update_success = update_slack_message(slack_token, channel, streaming_msg_ts, display_text, timeout=update_timeout)
                if not update_success and force:
                    # Final update failed on existing message - log for debugging
                    print(f"Final update failed for ts={streaming_msg_ts}, text_len={len(display_text)}", file=sys.stderr)
            else:
                # Create new streaming message
                new_ts = send_slack(slack_token, channel, thread_ts, display_text)
                if new_ts:
                    streaming_msg_ts = new_ts
                    update_success = True
                else:
                    print(f"Failed to create new streaming message, text_len={len(display_text)}", file=sys.stderr)

            last_stream_update = now
            last_streamed_len = len(streaming_text)
            return update_success

        # Helper function to process a single line
        def process_line(line):
            nonlocal edits, writes, reads, commands, globs, greps, web_fetches, web_searches, tasks, mcp_calls, final_result, result_stats
            nonlocal streaming_text
            line = line.strip()
            if not line:
                return

            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                error_lines.append(line)
                return

            # Handle assistant messages (both tool_use and text)
            if data.get("type") == "assistant" and "message" in data:
                content = data["message"].get("content", [])

                # Extract text content for streaming
                for item in content:
                    if item.get("type") == "text":
                        text_chunk = item.get("text", "")
                        if text_chunk:
                            streaming_text += text_chunk
                            update_stream_if_needed()
                for item in content:
                    if item.get("type") == "tool_use":
                        tool_name = item.get("name", "")
                        tool_input = item.get("input", {})

                        if tool_name == "Edit":
                            edits += 1
                            file_path = tool_input.get("file_path", "")
                            if file_path:
                                filename = file_path.split("/")[-1]
                                if filename not in reported_files:
                                    reported_files.add(filename)
                                    # Append to streaming text
                                    streaming_text += f"\n_Editing `{filename}`..._\n"
                                    update_stream_if_needed(force=True)
                                    log_event("info", f"Tool: Edit {filename}", channel=channel, session=session_id)

                        elif tool_name == "Write":
                            writes += 1
                            file_path = tool_input.get("file_path", "")
                            if file_path:
                                filename = file_path.split("/")[-1]
                                if filename not in reported_files:
                                    reported_files.add(filename)
                                    # Append to streaming text
                                    streaming_text += f"\n_Creating `{filename}`..._\n"
                                    update_stream_if_needed(force=True)
                                    log_event("info", f"Tool: Write {filename}", channel=channel, session=session_id)

                        elif tool_name == "Read":
                            reads += 1
                            # Log reads but don't spam (already silent in Slack)
                            log_event("info", f"Tool: Read", channel=channel, session=session_id)

                        elif tool_name == "Bash":
                            cmd_str = tool_input.get("command", "")
                            skip_prefixes = ("cat ", "head ", "tail ", "ls ", "pwd", "echo ", "grep ", "find ", "source ")
                            if cmd_str and not cmd_str.startswith(skip_prefixes):
                                commands += 1
                                display_cmd = cmd_str[:50] + "..." if len(cmd_str) > 50 else cmd_str
                                # Append to streaming text
                                streaming_text += f"\n_Running `{display_cmd}`..._\n"
                                update_stream_if_needed(force=True)
                                log_event("info", f"Tool: Bash {display_cmd}", channel=channel, session=session_id)

                        elif tool_name == "Glob":
                            globs += 1
                            pattern = tool_input.get("pattern", "")
                            if pattern and "glob" not in reported_actions:
                                reported_actions.add("glob")
                                send_slack(slack_token, channel, thread_ts, f"Searching for files `{pattern}`...")
                                log_event("info", f"Tool: Glob {pattern}", channel=channel, session=session_id)

                        elif tool_name == "Grep":
                            greps += 1
                            pattern = tool_input.get("pattern", "")
                            if pattern and "grep" not in reported_actions:
                                reported_actions.add("grep")
                                send_slack(slack_token, channel, thread_ts, f"Searching in files for `{pattern[:30]}`...")
                                log_event("info", f"Tool: Grep {pattern}", channel=channel, session=session_id)

                        elif tool_name == "WebFetch":
                            web_fetches += 1
                            url = tool_input.get("url", "")
                            if url:
                                # Show domain only for brevity
                                domain = url.split("/")[2] if "/" in url else url
                                send_slack(slack_token, channel, thread_ts, f"Fetching `{domain}`...")
                                log_event("info", f"Tool: WebFetch {domain}", channel=channel, session=session_id)

                        elif tool_name == "WebSearch":
                            web_searches += 1
                            query = tool_input.get("query", "")
                            if query:
                                display_query = query[:40] + "..." if len(query) > 40 else query
                                send_slack(slack_token, channel, thread_ts, f"Searching the web: `{display_query}`...")
                                log_event("info", f"Tool: WebSearch {query}", channel=channel, session=session_id)

                        elif tool_name == "Task":
                            tasks += 1
                            description = tool_input.get("description", "agent task")
                            send_slack(slack_token, channel, thread_ts, f"Spawning agent: {description}...")
                            log_event("info", f"Tool: Task {description}", channel=channel, session=session_id)

                        elif tool_name.startswith("mcp__"):
                            mcp_calls += 1
                            # Parse MCP tool name: mcp__server__action
                            parts = tool_name.split("__")
                            if len(parts) >= 3:
                                server = parts[1]
                                action = parts[2]
                                action_key = f"mcp_{server}"
                                if action_key not in reported_actions:
                                    reported_actions.add(action_key)
                                    send_slack(slack_token, channel, thread_ts, f"Calling {server}: {action}...")
                                    log_event("info", f"Tool: MCP {server} {action}", channel=channel, session=session_id)

            if data.get("type") == "result":
                final_result = data.get("result", "")
                # Capture stats from result event
                result_stats["duration_ms"] = data.get("duration_ms", 0)
                result_stats["cost"] = data.get("total_cost_usd", 0)
                result_stats["usage"] = data.get("usage", {})

        # Process first line if we have one
        if first_line:
            process_line(first_line)

        try:
            for line in process.stdout:
                process_line(line)
        except Exception as e:
            print(f"Error reading process output: {e}", file=sys.stderr)
            log_event("error", f"Error reading output: {e}", channel=channel, session=session_id)

        process.wait()

        # Calculate duration if not captured from result event
        if not result_stats.get("duration_ms"):
            result_stats["duration_ms"] = int((time.time() - start_time) * 1000)

        # Final update to streaming message (remove typing indicator)
        # This is critical - retry up to 3 times if it fails
        if streaming_text:
            final_update_success = False
            for attempt in range(3):
                try:
                    # Get current state before update
                    current_ts = streaming_msg_ts
                    current_text_len = len(streaming_text)

                    result = update_stream_if_needed(force=True)

                    # Check the actual return value from the update function
                    if result:
                        final_update_success = True
                        log_event("info", f"Final streaming update succeeded on attempt {attempt + 1}",
                                  channel=channel, session=session_id, text_len=current_text_len,
                                  msg_ts=streaming_msg_ts)
                        break
                    else:
                        log_event("warning", f"Final update attempt {attempt + 1} returned False",
                                  channel=channel, session=session_id, msg_ts=current_ts)
                        time.sleep(1)  # Pause before retry
                except Exception as e:
                    log_event("error", f"Final update attempt {attempt + 1} exception: {e}",
                              channel=channel, session=session_id)
                    time.sleep(1)  # Brief pause before retry

            if not final_update_success:
                log_event("error", "All final update attempts failed - sending fallback message",
                          channel=channel, session=session_id, text_len=len(streaming_text))
                # Fallback: send the final text as a new message if update completely failed
                # Send just the last portion if it's too long
                fallback_text = streaming_text
                if len(fallback_text) > SLACK_MAX_MESSAGE_LENGTH:
                    fallback_text = "...\n\n" + streaming_text[-(SLACK_MAX_MESSAGE_LENGTH - 10):]
                fallback_ts = send_slack(slack_token, channel, thread_ts, fallback_text)
                if fallback_ts:
                    log_event("info", "Fallback message sent successfully", channel=channel, session=session_id)
                else:
                    log_event("error", "Fallback message also failed!", channel=channel, session=session_id)

        # Send summary if work was done (wrapped in try/except to ensure we always reach reactions)
        summary_parts = []
        try:
            if reads > 0:
                summary_parts.append(f"read {reads} file(s)")
            if edits > 0:
                summary_parts.append(f"edited {edits} file(s)")
            if writes > 0:
                summary_parts.append(f"created {writes} file(s)")
            if commands > 0:
                summary_parts.append(f"ran {commands} command(s)")
            if globs > 0:
                summary_parts.append(f"searched {globs} pattern(s)")
            if greps > 0:
                summary_parts.append(f"grepped {greps} time(s)")
            if web_fetches > 0:
                summary_parts.append(f"fetched {web_fetches} URL(s)")
            if web_searches > 0:
                summary_parts.append(f"web searched {web_searches} time(s)")
            if tasks > 0:
                summary_parts.append(f"spawned {tasks} agent(s)")
            if mcp_calls > 0:
                summary_parts.append(f"called {mcp_calls} MCP tool(s)")

            if summary_parts:
                send_slack(slack_token, channel, thread_ts, f"Done: {', '.join(summary_parts)}")

            # Send stats (duration is always available now via start_time fallback)
            # Note: cost and tokens may be missing if Claude was interrupted before result event
            stats_parts = []
            duration_ms = result_stats.get("duration_ms", 0)
            if duration_ms:
                duration_sec = duration_ms / 1000
                stats_parts.append(f"{duration_sec:.1f}s")
            if result_stats.get("cost"):
                cost = result_stats["cost"]
                stats_parts.append(f"${cost:.4f}")
            usage = result_stats.get("usage", {})
            if usage:
                input_tokens = usage.get("input_tokens", 0) + usage.get("cache_read_input_tokens", 0) + usage.get("cache_creation_input_tokens", 0)
                output_tokens = usage.get("output_tokens", 0)
                if input_tokens or output_tokens:
                    stats_parts.append(f"{input_tokens:,} in / {output_tokens:,} out tokens")
            if stats_parts:
                send_slack(slack_token, channel, thread_ts, f"_Stats: {' | '.join(stats_parts)}_")

            # Log session completion
            log_event("info", f"Session completed: {', '.join(summary_parts) if summary_parts else 'no actions'}",
                      channel=channel, session=session_id,
                      reads=reads, edits=edits, writes=writes, commands=commands,
                      globs=globs, greps=greps, web_fetches=web_fetches, web_searches=web_searches,
                      tasks=tasks, mcp_calls=mcp_calls,
                      duration_ms=result_stats.get("duration_ms", 0),
                      cost_usd=result_stats.get("cost", 0))
        except Exception as e:
            print(f"Error sending summary/stats: {e}", file=sys.stderr)
            log_event("error", f"Summary/stats error: {e}", channel=channel, session=session_id)

        # Handle final result and reactions
        # Note: streaming_text already contains the response (streamed in real-time)
        # final_result from the result event may have the complete text too
        has_response = streaming_text or final_result

        if has_response:
            # If we didn't stream (no streaming_text), send final_result
            if not streaming_text and final_result:
                send_slack(slack_token, channel, thread_ts, final_result)
            # Remove processing, add success
            remove_reaction(slack_token, channel, message_ts, PROCESSING_EMOJI)
            add_reaction(slack_token, channel, message_ts, SUCCESS_EMOJI)
        elif process.returncode != 0:
            # Log the error for debugging
            print(f"Claude exited with code {process.returncode}", file=sys.stderr)
            if error_lines:
                error_msg = "\n".join(error_lines[:5])  # First 5 error lines
                print(f"Error output: {error_msg}", file=sys.stderr)
                # Send a more helpful error message to Slack
                send_slack(slack_token, channel, thread_ts, f"Sorry, something went wrong: {error_lines[0][:200]}")
                log_event("error", f"Session failed: {error_lines[0][:100]}",
                          channel=channel, session=session_id, exit_code=process.returncode)
            else:
                send_slack(slack_token, channel, thread_ts, "Sorry, something went wrong processing your request.")
                log_event("error", "Session failed: unknown error",
                          channel=channel, session=session_id, exit_code=process.returncode)
            # Remove processing, add error
            remove_reaction(slack_token, channel, message_ts, PROCESSING_EMOJI)
            add_reaction(slack_token, channel, message_ts, ERROR_EMOJI)
        else:
            # No result but no error - just remove processing reaction
            remove_reaction(slack_token, channel, message_ts, PROCESSING_EMOJI)
            add_reaction(slack_token, channel, message_ts, SUCCESS_EMOJI)

    finally:

        # Cleanup temp directory
        try:
            shutil.rmtree(temp_dir)
        except Exception as e:
            print(f"Error cleaning up temp dir: {e}", file=sys.stderr)

    print("Done")

if __name__ == "__main__":
    main()
