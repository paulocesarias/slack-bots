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
    - (Image support planned for future)
"""

import sys
import json
import subprocess
import requests
import base64

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

    # Send processing message
    send_slack(slack_token, channel, thread_ts, "Processing your request...")

    # Build Claude command
    cmd = [
        "/home/paulo/.local/bin/claude",
        "--output-format", "stream-json",
        "--verbose",
        "-p", message,
        "--resume", session_id,
        "--dangerously-skip-permissions"
    ]

    try:
        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    except Exception as e:
        send_slack(slack_token, channel, thread_ts, f"Error starting Claude: {e}")
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

    print("Done")

if __name__ == "__main__":
    main()
