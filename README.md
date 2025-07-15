# @opik/ccsync

A command-line tool to export Claude Code conversations to Opik for observability and analytics.

## Installation

```bash
npm install -g @opik/ccsync
```

Or run directly without installing:

```bash
npx @opik/ccsync --help
```

## Quick Start

The best way to use @opik/ccsync is with **Claude Code hooks** for automatic syncing:

1. **Set up Opik connection**:
   ```bash
   npx @opik/ccsync config
   ```
   
   This will guide you through an interactive setup process. Alternatively, you can set environment variables:
   ```bash
   export OPIK_API_KEY="your-api-key"
   export OPIK_BASE_URL="http://localhost:5173"  # Optional, defaults to Opik cloud
   ```

2. **Add automatic syncing hooks** to your Claude Code settings (`~/.claude/settings.json`):
   ```json
   {
     "hooks": {
       "PostToolUse": [
         {
           "matcher": "*",
           "hooks": [
             {
               "type": "command",
               "command": "jq -r '.session_id' | xargs -I {} npx @opik/ccsync sync --session {}"
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
               "command": "jq -r '.session_id' | xargs -I {} npx @opik/ccsync sync --session {}"
             }
           ]
         }
       ]
     }
   }
   ```

That's it! Now every time you finish a Claude Code conversation, it will automatically sync to Opik.

### Alternative: Manual Sync

You can also run syncing manually:
```bash
# Sync all conversations at once
npx @opik/ccsync sync --all
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
workspace = your-workspace
```

## Commands

### `ccsync sync` - Export conversations to Opik

Export Claude Code data to Opik for analysis and observability.

```bash
# Export all sessions across all projects (recommended)
npx @opik/ccsync sync --all

# Export specific session
npx @opik/ccsync sync --session ce61eece-2274-40ec-8b15-3a1189c04c4a

# Export all sessions in a project
npx @opik/ccsync sync --project /path/to/project

# Watch for new conversations and sync automatically
npx @opik/ccsync sync --watch

# Preview what would be exported (dry run)
npx @opik/ccsync sync --all --dry-run

# Force export (bypass duplicate detection)
npx @opik/ccsync sync --all --force
```

### `ccsync ls` - List available conversations

List all Claude Code sessions available for export.

```bash
# List all sessions
npx @opik/ccsync ls

# List sessions for specific project
npx @opik/ccsync ls --project /path/to/project
```

### `ccsync config` - Configure Opik connection

Interactive setup for Opik connection. Guides you through configuration and validates the connection.

```bash
# Interactive configuration setup
npx @opik/ccsync config

# Just show current configuration
npx @opik/ccsync config --show
```

### `ccsync state` - Manage export tracking

Manage the state system that tracks which sessions have been exported.

```bash
# Show export history
npx @opik/ccsync state --show

# Clear export history (forces re-export)
npx @opik/ccsync state --reset

# Clean up lock files
npx @opik/ccsync state --clean
```

## Watch Mode

**Watch mode** automatically monitors your Claude Code conversations and syncs them to Opik in real-time:

```bash
# Start watching for new conversations
npx @opik/ccsync sync --watch
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
   npx @opik/ccsync config
   ```

2. **List available sessions**:
   ```bash
   npx @opik/ccsync ls
   ```

3. **Export a session**:
   ```bash
   npx @opik/ccsync sync --session <session-id>
   ```

4. **Start automatic syncing**:
   ```bash
   npx @opik/ccsync sync --watch
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
npx @opik/ccsync config  # Interactive setup
npx @opik/ccsync config --show  # Check current settings
```

**No sessions found:**
- Ensure you have Claude Code conversations in `~/.claude/projects/`
- Try filtering by project: `--project /path/to/project`

**Lock file errors:**
```bash
npx @opik/ccsync state --clean  # Remove stale locks
```

**Force re-export:**
```bash
npx @opik/ccsync sync --session <id> --force
```

**Watch mode issues:**
```bash
# Test with dry-run first
npx @opik/ccsync sync --watch --dry-run

# Enable verbose logging for debugging
npx @opik/ccsync sync --watch --verbose
```

**Performance tuning:**
- Watch mode uses a 2 second debounce delay to avoid excessive API calls
- Use `--verbose` only when debugging (creates more output)
- Watch mode is designed to run continuously and efficiently

## Claude Code Hooks Integration

**Claude Code hooks** provide automatic syncing by executing `@opik/ccsync` commands in response to Claude Code events. This eliminates the need to manually run sync commands or use watch mode.

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
            "command": "jq -r '.session_id' | xargs -I {} npx @opik/ccsync sync --session {} --force"
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
            "command": "jq -r '.session_id' | xargs -I {} npx @opik/ccsync sync --session {}"
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
            "command": "jq -r '.session_id' | xargs -I {} npx @opik/ccsync sync --session {} --force"
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
            "command": "jq -r '.session_id' | xargs -I {} npx @opik/ccsync sync --session {}"
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
            "command": "jq -r '.session_id' | xargs -I {} npx @opik/ccsync sync --session {} 2>/dev/null || echo 'Sync failed'"
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
