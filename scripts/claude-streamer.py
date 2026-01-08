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

# Supported file types
IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.webp'}
PDF_EXTENSIONS = {'.pdf'}
SUPPORTED_EXTENSIONS = IMAGE_EXTENSIONS | PDF_EXTENSIONS

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
            timeout=60
        )
        if response.status_code == 200:
            with open(dest_path, 'wb') as f:
                f.write(response.content)
            return True
        else:
            print(f"Failed to download file: HTTP {response.status_code}", file=sys.stderr)
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
        print("  base64_files_json - Optional: JSON array of file objects [{url_private, name, mimetype}] encoded in base64")
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

    # Create temp directory for downloaded files
    temp_dir = tempfile.mkdtemp(prefix="claude_slack_")
    downloaded_files = []

    try:
        # Download supported files (images and PDFs)
        for file_info in files:
            file_url = file_info.get('url_private') or file_info.get('url_private_download')
            file_name = file_info.get('name', 'file')
            mimetype = file_info.get('mimetype', '')

            if not file_url:
                continue

            # Check if it's a supported file type
            ext = os.path.splitext(file_name)[1].lower()
            is_image = ext in IMAGE_EXTENSIONS or mimetype.startswith('image/')
            is_pdf = ext in PDF_EXTENSIONS or mimetype == 'application/pdf'

            if is_image or is_pdf:
                dest_path = os.path.join(temp_dir, file_name)
                if download_slack_file(slack_token, file_url, dest_path):
                    downloaded_files.append({
                        'path': dest_path,
                        'name': file_name,
                        'type': 'image' if is_image else 'pdf'
                    })
                    file_type = "image" if is_image else "PDF"
                    send_slack(slack_token, channel, thread_ts, f"Downloaded {file_type}: `{file_name}`")

        # Build the message with file references
        # If files were downloaded, prepend instructions to read them
        full_message = message
        if downloaded_files:
            file_instructions = []
            for f in downloaded_files:
                file_instructions.append(f"- {f['type'].upper()}: {f['path']}")

            files_text = "\n".join(file_instructions)
            full_message = f"""The user has attached the following file(s). Please read and analyze them as part of your response:

{files_text}

User's message: {message}"""

        # Build Claude command
        cmd = [
            "/home/paulo/.local/bin/claude",
            "--output-format", "stream-json",
            "--verbose",
            "-p", full_message,
            "--resume", session_id,
            "--dangerously-skip-permissions"
        ]

        # Add temp directory to allowed dirs so Claude can read the files
        if downloaded_files:
            cmd.extend(["--add-dir", temp_dir])

        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

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

    finally:
        # Cleanup temp directory
        try:
            shutil.rmtree(temp_dir)
        except Exception as e:
            print(f"Error cleaning up temp dir: {e}", file=sys.stderr)

    print("Done")

if __name__ == "__main__":
    main()
