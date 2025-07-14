# opik-chat-sync

A command-line tool to export Claude Code conversations to Opik for observability and analytics.

## Installation

```bash
npm install
npm run build
```

## Configuration

Configure Opik connection using environment variables or a config file:

### Environment Variables
```bash
export OPIK_API_KEY="your-api-key"
export OPIK_BASE_URL="http://localhost:5173"  # Optional
export OPIK_PROJECT_NAME="your-project"       # Optional
```

### Configuration File
Create `~/.opik.config`:
```ini
api_key = your-api-key
url_override = http://localhost:5173
workspace = your-project
```

## Commands

### `opik-chat-sync config`
*Check configuration and connectivity*

Show current Opik configuration and verify connection.

```bash
opik-chat-sync config
```

**Output:**
```
✅ Connected to Opik at http://localhost:5173
Current Configuration:
  Opik URL: http://localhost:5173
  API Key: ***configured***
  Project: default
  Claude Data Dir: /Users/username/.claude
```

### `opik-chat-sync list-sessions`
*Discover available Claude conversations*

List all Claude Code sessions available for export.

```bash
opik-chat-sync list-sessions [--project <path>]
```

**Options:**
- `--project <path>` - Filter sessions by project path

**Examples:**
```bash
# List all sessions
opik-chat-sync list-sessions

# List sessions for specific project
opik-chat-sync list-sessions --project /path/to/project
```

**Sample Output:**
```
Listing Claude Code sessions...
Session ID                           Last Updated # Messages Summary
❯ 1.  ce61eece-2274-40ec-8b15-3a1189c04c4a 2h ago       15         Implementing user authentication...
❯ 2.  b7f3d9e1-8a2c-4f5e-9b1d-3c7e6a4f8b2e 1d ago       8          Bug fix for login validation...
```

### `opik-chat-sync sync`
*Export conversations to Opik*

Export Claude Code data to Opik for analysis and observability.

```bash
opik-chat-sync sync [options]
```

**Required Options (choose one):**
- `--session <id>` - Export specific session by ID
- `--project <path>` - Export all sessions in project path
- `--all` - Export all sessions across all projects
- `--watch` - Watch for new conversations and sync automatically

**Modifier Options:**
- `--force` - Force export even if already exported
- `--dry-run` - Preview what would be exported without actually exporting
- `--verbose` - Enable verbose logging for debugging

**Examples:**
```bash
# Export a specific session
opik-chat-sync sync --session ce61eece-2274-40ec-8b15-3a1189c04c4a

# Preview what would be exported
opik-chat-sync sync --session ce61eece-2274-40ec-8b15-3a1189c04c4a --dry-run

# Force export (bypass duplicate detection)
opik-chat-sync sync --session ce61eece-2274-40ec-8b15-3a1189c04c4a --force

# Export all sessions in a project
opik-chat-sync sync --project /path/to/project

# Export all sessions across all projects
opik-chat-sync sync --all

# Watch for new conversations and sync automatically
opik-chat-sync sync --watch

# Dry run with watch mode
opik-chat-sync sync --watch --dry-run
```

**Sample Sync Output:**
```
✅ Connected to Opik at https://www.comet.com/opik/api/
Syncing session: ce61eece-2274-40ec-8b15-3a1189c04c4a
✅ Synced 3 conversations to Opik (2 new, 1 updated)
```

**Sample Watch Mode Output:**
```
✅ Connected to Opik at https://www.comet.com/opik/api/
Starting watch mode...
Monitoring: /Users/username/.claude/projects

Press Ctrl+C to stop watching...

✅ Watcher is ready and monitoring files

Monitoring 5 Claude projects
Watching for new messages...

Syncing session: 9827a1f6-5ddc-4d1a-be3c-41056311853
✅ Synced 1 conversation to Opik (0 new, 1 updated)
```

### `opik-chat-sync state`
*Manage export tracking*

Manage the state system that tracks which sessions have been exported.

```bash
opik-chat-sync state [options]
```

**Options:**
- `--show` - Display current export history
- `--reset` - Clear all export history (forces re-export)
- `--clean` - Remove stale lock files

**Examples:**
```bash
# Show export history
opik-chat-sync state --show

# Clear export history
opik-chat-sync state --reset

# Clean up lock files
opik-chat-sync state --clean
```

## Watch Mode

**Watch mode** automatically monitors your Claude Code conversations and syncs them to Opik in real-time:

```bash
# Start watching for new conversations
opik-chat-sync sync --watch
```

**Watch Mode Features:**
- Automatically detects new messages and conversation updates
- Intelligent debouncing to avoid excessive API calls (2 second delay)
- Smart sync detection (only syncs when needed)
- Graceful shutdown with Ctrl+C
- Concurrent project monitoring

**Watch Mode Options:**
- `--force` - Force sync all changes (bypass smart detection)
- `--dry-run` - Preview what would be synced without actually syncing
- `--verbose` - Show detailed logging including debug information

## Quick Start

1. **Configure connection**:
   ```bash
   opik-chat-sync config
   ```

2. **List available sessions**:
   ```bash
   opik-chat-sync list-sessions
   ```

3. **Export a session**:
   ```bash
   opik-chat-sync sync --session <session-id>
   ```

4. **Start automatic syncing**:
   ```bash
   opik-chat-sync sync --watch
   ```

## Advanced Features

### Smart Sync Detection
- Automatically detects when sessions have new messages
- Tracks conversation groups and only syncs updated content
- Prevents duplicate exports while handling conversation updates

### Logging Levels
- **Default**: Shows essential sync progress and results
- **Verbose** (`--verbose`): Shows detailed debug information
- **Dry Run** (`--dry-run`): Shows what would be synced without actually doing it

### State Management
- Export tracking state is stored in `~/.opik/sync-state/`
- Multiple instances can run safely in parallel
- Automatic cleanup of stale lock files

## Notes

- The tool automatically tracks exported sessions to prevent duplicates
- Use `--force` to re-export sessions that have already been exported
- Use `--dry-run` to preview exports without actually sending data
- Watch mode intelligently monitors all Claude projects simultaneously
- Sessions are grouped by conversation threads for better organization in Opik

## Troubleshooting

**Configuration Issues:**
```bash
opik-chat-sync config  # Check current settings
```

**No sessions found:**
- Ensure you have Claude Code conversations in `~/.claude/projects/`
- Try filtering by project: `--project /path/to/project`

**Lock file errors:**
```bash
opik-chat-sync state --clean  # Remove stale locks
```

**Force re-export:**
```bash
opik-chat-sync sync --session <id> --force
```

**Watch mode issues:**
```bash
# Test with dry-run first
opik-chat-sync sync --watch --dry-run

# Enable verbose logging for debugging
opik-chat-sync sync --watch --verbose
```

**Performance tuning:**
- Watch mode uses a 2 second debounce delay to avoid excessive API calls
- Use `--verbose` only when debugging (creates more output)
- Watch mode is designed to run continuously and efficiently

## Claude Code Hooks Integration

**Claude Code hooks** provide automatic syncing by executing `opik-chat-sync` commands in response to Claude Code events. This eliminates the need to manually run sync commands or use watch mode.

### Available Hook Events

- **PostToolUse**: Runs after each tool call completes - ideal for incremental syncing
- **Stop**: Runs when Claude finishes responding - perfect for syncing complete conversations

### Hook Configuration

Add hooks to your Claude Code settings file (`~/.claude/settings.json` or `.claude/settings.json`):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.session_id' | xargs -I {} npx opik-chat-sync sync --session {} --force"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "*", 
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.session_id' | xargs -I {} npx opik-chat-sync sync --session {}"
          }
        ]
      }
    ]
  }
}
```

### Hook Usage Examples

**Real-time sync after each tool call:**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command", 
            "command": "jq -r '.session_id' | xargs -I {} npx opik-chat-sync sync --session {} --force"
          }
        ]
      }
    ]
  }
}
```

**Sync only when conversations end:**
```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.session_id' | xargs -I {} npx opik-chat-sync sync --session {}"
          }
        ]
      }
    ]
  }
}
```

**Conditional sync with error handling:**
```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.session_id' | xargs -I {} npx opik-chat-sync sync --session {} 2>/dev/null || echo 'Sync failed'"
          }
        ]
      }
    ]
  }
}
```

### Hook Input Data

Claude Code provides JSON input to hooks via stdin with these fields:
- `session_id` - Current session ID for targeted syncing
- `transcript_path` - Path to the conversation's JSON log file
- `hook_event_name` - The specific hook event type (e.g., "PostToolUse", "Stop")

The command examples above use `jq` to extract the `session_id` from the JSON input that Claude Code provides via stdin.

### Hook Best Practices

1. **Use `--force` with PostToolUse** to ensure incremental updates are captured
2. **Use regular sync with Stop** to avoid unnecessary duplicate processing
3. **Add error handling** to prevent hook failures from disrupting Claude Code
4. **Test hooks with `--dry-run`** before enabling automatic syncing
5. **Consider performance** - PostToolUse hooks run frequently

### Security Note

⚠️ **Warning**: Hooks execute shell commands with full user permissions. Only configure hooks you trust and understand.

### Hooks vs Watch Mode

| Feature | Hooks | Watch Mode |
|---------|-------|------------|
| **Setup** | One-time configuration | Manual command each time |
| **Performance** | Event-driven (efficient) | File system polling |
| **Scope** | Per-session automatic | All projects continuous |
| **Control** | Integrated with Claude Code | Independent process |

**Recommendation**: Use hooks for automatic per-session syncing, watch mode for continuous monitoring of all projects.