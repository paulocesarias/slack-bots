#!/usr/bin/env python3
"""
Claude Slack Streamer - Streams Claude CLI output to Slack with real-time progress updates.

Usage:
    python3 claude-streamer.py <slack_token> <channel> <thread_ts> <session_id> <base64_message> [base64_files_json]

Features:
    - Real-time progress updates (Editing file..., Creating file..., Running command...)
    - Silently counts read operations (no spam)
    - Summary of actions taken (Done: read 3 file(s), edited 1 file(s))
    - Session persistence for conversation continuity
    - Image support (downloads and passes images to Claude)
"""

import sys
import json
import subprocess
import requests
import base64
import os
import tempfile

def send_slack(token, channel, thread_ts, text):
    """Send a message to Slack."""
    try:
        requests.post(
            "https://slack.com/api/chat.postMessage",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"channel": channel, "thread_ts": thread_ts, "text": f"[n8n-bot] {text}"},
            timeout=10
        )
    except Exception as e:
        print(f"Error sending to Slack: {e}", file=sys.stderr)

def download_slack_file(token, file_url, dest_path):
    """Download a file from Slack."""
    try:
        response = requests.get(
            file_url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=30
        )
        if response.status_code == 200:
            with open(dest_path, 'wb') as f:
                f.write(response.content)
            return True
    except Exception as e:
        print(f"Error downloading file: {e}", file=sys.stderr)
    return False

def main():
    if len(sys.argv) < 6:
        print("Usage: python3 claude-streamer.py <slack_token> <channel> <thread_ts> <session_id> <base64_message> [base64_files_json]")
        print("  slack_token      - Slack Bot OAuth token (xoxb-...)")
        print("  channel          - Slack channel ID")
        print("  thread_ts        - Thread timestamp for replies")
        print("  session_id       - Claude session UUID for conversation continuity")
        print("  base64_message   - User message encoded in base64")
        print("  base64_files_json - Optional: JSON array of file objects [{url, name, mimetype}] encoded in base64")
        sys.exit(1)

    slack_token = sys.argv[1]
    channel = sys.argv[2]
    thread_ts = sys.argv[3]
    session_id = sys.argv[4]
    message = base64.b64decode(sys.argv[5]).decode('utf-8')

    # Parse optional files argument
    files = []
    if len(sys.argv) >= 7 and sys.argv[6]:
        try:
            files_json = base64.b64decode(sys.argv[6]).decode('utf-8')
            files = json.loads(files_json) if files_json else []
        except Exception as e:
            print(f"Error parsing files: {e}", file=sys.stderr)

    # Send processing message
    send_slack(slack_token, channel, thread_ts, "Processing your request...")

    # Download any images/files to temp directory
    temp_dir = tempfile.mkdtemp(prefix="claude_slack_")
    downloaded_files = []
    image_extensions = {'.png', '.jpg', '.jpeg', '.gif', '.webp'}

    for file_info in files:
        file_url = file_info.get('url_private') or file_info.get('url')
        file_name = file_info.get('name', 'file')
        mimetype = file_info.get('mimetype', '')

        if file_url:
            # Check if it's an image
            ext = os.path.splitext(file_name)[1].lower()
            is_image = ext in image_extensions or mimetype.startswith('image/')

            if is_image:
                dest_path = os.path.join(temp_dir, file_name)
                if download_slack_file(slack_token, file_url, dest_path):
                    downloaded_files.append(dest_path)
                    send_slack(slack_token, channel, thread_ts, f"Downloaded image `{file_name}`...")

    # Build Claude command
    cmd = [
        "/home/paulo/.local/bin/claude",
        "--output-format", "stream-json",
        "--verbose",
        "-p", message,
        "--resume", session_id,
        "--dangerously-skip-permissions"
    ]

    # Add image files to command
    for img_path in downloaded_files:
        cmd.extend(["--image", img_path])

    try:
        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    except Exception as e:
        send_slack(slack_token, channel, thread_ts, f"Error starting Claude: {e}")
        # Cleanup temp files
        for f in downloaded_files:
            try:
                os.remove(f)
            except:
                pass
        try:
            os.rmdir(temp_dir)
        except:
            pass
        sys.exit(1)

    # Track actions
    edits = 0
    writes = 0
    reads = 0
    commands = 0
    final_result = ""
    reported_files = set()  # Avoid duplicate reports

    for line in process.stdout:
        line = line.strip()
        if not line:
            continue

        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            continue

        # Handle tool use events
        if data.get("type") == "assistant" and "message" in data:
            content = data["message"].get("content", [])
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
                                send_slack(slack_token, channel, thread_ts, f"Editing `{filename}`...")

                    elif tool_name == "Write":
                        writes += 1
                        file_path = tool_input.get("file_path", "")
                        if file_path:
                            filename = file_path.split("/")[-1]
                            if filename not in reported_files:
                                reported_files.add(filename)
                                send_slack(slack_token, channel, thread_ts, f"Creating `{filename}`...")

                    elif tool_name == "Read":
                        reads += 1
                        # Silent - don't report reads

                    elif tool_name == "Bash":
                        cmd_str = tool_input.get("command", "")
                        # Only report significant commands (not cat, ls, etc.)
                        skip_prefixes = ("cat ", "head ", "tail ", "ls ", "pwd", "echo ", "grep ", "find ", "source ")
                        if cmd_str and not cmd_str.startswith(skip_prefixes):
                            commands += 1
                            # Truncate long commands
                            display_cmd = cmd_str[:50] + "..." if len(cmd_str) > 50 else cmd_str
                            send_slack(slack_token, channel, thread_ts, f"Running `{display_cmd}`...")

        # Get final result
        if data.get("type") == "result":
            final_result = data.get("result", "")

    process.wait()

    # Send summary if work was done
    summary_parts = []
    if reads > 0:
        summary_parts.append(f"read {reads} file(s)")
    if edits > 0:
        summary_parts.append(f"edited {edits} file(s)")
    if writes > 0:
        summary_parts.append(f"created {writes} file(s)")
    if commands > 0:
        summary_parts.append(f"ran {commands} command(s)")

    if summary_parts:
        send_slack(slack_token, channel, thread_ts, f"Done: {', '.join(summary_parts)}")

    # Send final result
    if final_result:
        send_slack(slack_token, channel, thread_ts, final_result)
    elif process.returncode != 0:
        send_slack(slack_token, channel, thread_ts, "Sorry, something went wrong processing your request.")

    # Cleanup temp files
    for f in downloaded_files:
        try:
            os.remove(f)
        except:
            pass
    try:
        os.rmdir(temp_dir)
    except:
        pass

    print("Done")

if __name__ == "__main__":
    main()
