# Opik Chat Sync - NPM Package Plan

## Project Overview
Create an npm package that syncs Claude Code conversations to Opik for observability and analytics.

## Key Architecture Components

### 1. Data Sources
- **Claude Code Conversations**: Located in `~/.claude/projects/[project-path]/[session-id].jsonl`
- **Session Data**: Each line contains structured JSON with message exchanges, tool calls, and metadata
- **Available Data**: sessionId, timestamps, user/assistant messages, tool calls, model info, usage stats

### 2. Opik Integration
- **Traces**: Top-level conversation sessions with start/end times, input/output, metadata
- **Spans**: Individual message exchanges and tool calls within conversations
- **API Endpoints**: 
  - POST `/api/v1/private/traces` for conversation-level tracking
  - POST `/api/v1/private/spans/batch` for message-level tracking

#### Opik Data Structures

**Trace Schema:**
```json
{
  "id": "string (UUID)",                    // Optional - will be generated if not provided
  "project_name": "string",                 // Optional - defaults to default project
  "name": "string",                         // Optional - conversation title/description
  "start_time": "string (ISO 8601)",        // Required - conversation start time
  "end_time": "string (ISO 8601)",          // Optional - conversation end time
  "input": "object | array",                // Optional - initial user prompt/context
  "output": "object | array",               // Optional - final assistant response
  "metadata": "object",                     // Optional - session metadata (model, version, etc.)
  "tags": ["string"],                       // Optional - categorization tags
  "error_info": "object",                   // Optional - error details if conversation failed
  "thread_id": "string"                     // Optional - for grouping related conversations
}
```

**Span Schema:**
```json
{
  "spans": [
    {
      "id": "string (UUID)",                // Optional - will be generated if not provided
      "trace_id": "string (UUID)",          // Required - reference to parent trace
      "parent_span_id": "string (UUID)",    // Optional - for nested spans (tool calls)
      "name": "string",                     // Optional - span description
      "start_time": "string (ISO 8601)",    // Required - message/tool start time
      "end_time": "string (ISO 8601)",      // Optional - message/tool end time
      "input": "object | array",            // Optional - message input/prompt
      "output": "object | array",           // Optional - message output/response
      "metadata": "object",                 // Optional - message metadata (model, tokens, etc.)
      "tags": ["string"],                   // Optional - span categorization
      "error_info": "object"                // Optional - error details if span failed
    }
  ]
}
```

### 3. Package Structure
```
opik-chat-sync/
├── src/
│   ├── cli.ts           # CLI entry point
│   ├── sync.ts          # Core sync logic
│   ├── parsers/
│   │   ├── claude.ts    # Parse Claude Code data
│   │   └── opik.ts      # Format for Opik API
│   ├── hooks/
│   │   └── index.ts     # Claude Code hooks integration
│   └── config/
│       └── index.ts     # Configuration management
├── bin/
│   └── opik-chat-sync   # CLI executable
└── package.json
```

## Implementation Plan

### Phase 1: Core Sync Engine ✅ COMPLETE
1. ✅ **Claude Data Parser**: Parse `.jsonl` files to extract conversation data
2. ✅ **Opik API Client**: HTTP client for Opik trace/span creation
3. ✅ **Data Mapper**: Transform Claude data to Opik format
4. ✅ **Configuration**: Support for Opik URL, API keys, project settings

### Phase 2: CLI Interface ✅ COMPLETE
1. ✅ **List Sessions**: `npx opik-chat-sync list-sessions [--project project-path]`
2. ✅ **Sync Command**: `npx opik-chat-sync sync --session [session-id]`
3. ✅ **Batch Sync**: `npx opik-chat-sync sync --project [project-path]`
4. ⏸️ **Watch Mode**: `npx opik-chat-sync sync --watch` (CLI flag exists but not implemented)
5. ✅ **Configuration**: `npx opik-chat-sync config`

### Phase 3: Hooks Integration 🚧 NOT STARTED
1. **PostToolUse Hook**: Automatically sync after tool completion
2. **Stop Hook**: Sync complete sessions when they end
3. **Real-time Sync**: Optional immediate syncing vs batched

### Phase 4: Advanced Features ✅ COMPLETE (Plus Additional)
1. ✅ **Incremental Sync**: Only sync new messages since last sync (with state management)
2. ✅ **Filtering**: Include/exclude specific projects or sessions
3. ✅ **Metadata Enhancement**: Add custom tags and metadata
4. ✅ **Error Handling**: Robust retry logic and error reporting
5. ✅ **Duplicate Prevention**: State management with fingerprinting
6. ✅ **Concurrent Execution**: File locking for multiple instances
7. ✅ **Force & Dry-run Modes**: Additional CLI options
8. ✅ **State Management Commands**: Reset, show, clean operations

## Data Mapping Strategy

### Claude Code Data Structure
Based on analysis of 20+ messages from multiple conversations in `~/.claude/projects/[project]/[session-id].jsonl`:

```json
{
  "parentUuid": "string | null",           // Parent message UUID for linear threading
  "isSidechain": false,                    // Whether this is a side conversation
  "userType": "external",                  // Type of user (external/internal)
  "cwd": "string",                         // Working directory path
  "sessionId": "string (UUID)",            // Unique session identifier
  "version": "string",                     // Claude Code version
  "type": "user | assistant",              // Message type
  "message": {
    "role": "user | assistant",            // Message role
    "content": "string | array",           // Message content or tool calls
    "id": "string",                        // Message ID (groups related assistant messages)
    "model": "string",                     // Model used (for assistant messages)
    "usage": {                             // Token usage stats
      "input_tokens": number,
      "output_tokens": number,
      "cache_creation_input_tokens": number,
      "cache_read_input_tokens": number,
      "service_tier": "string"
    }
  },
  "uuid": "string (UUID)",                 // Unique message UUID
  "timestamp": "string (ISO 8601)",        // Message timestamp
  "requestId": "string",                   // Request ID for assistant messages
  "toolUseResult": "object"                // Tool execution results (if applicable)
}
```

### Conversation Flow Pattern
**Standard Sequence (validated across multiple conversations):**
1. **User Text Message** (`parentUuid: null` for conversation start)
2. **Assistant Text Response** (acknowledgment)
3. **Assistant Tool Call(s)** (one or more, sharing same `message.id`)
4. **User Tool Result(s)** (one per tool call)
5. **Repeat** until user provides next instruction

### Smart Message Grouping Strategy

**Goal**: Create one trace per user-initiated interaction, with `trace.input` = user message, `trace.output` = complete assistant response cycle.

**Grouping Algorithm:**
1. **Trace Boundaries**: Start new trace at each user text message (not tool results)
2. **Assistant Response Grouping**: Group all messages with same `message.id` as one logical response
3. **Tool Call Integration**: Combine tool calls with their corresponding tool results
4. **Output Aggregation**: Merge all assistant responses and tool results until next user text message

**Example Grouping:**
```
Trace 1: User Request → Complete Assistant Response
├── Input: "Let's create a project plan..."
├── Output: {
│   "assistant_response": "I'll research the documentation...",
│   "tool_calls": [
│     {
│       "name": "WebFetch",
│       "input": {"url": "...", "prompt": "..."},
│       "output": "Based on the documentation..."
│     },
│     {
│       "name": "Read",
│       "input": {"file_path": "..."},
│       "output": "File contents..."
│     }
│   ],
│   "final_response": "Based on my research, here's the plan..."
│ }
└── Metadata: {model, tokens, duration, working_directory}
```

### Trace Mapping (One Trace per User Message)
- **Trace ID**: Generate from user message `uuid`
- **Thread ID**: `sessionId` (to group all traces in conversation)
- **Project Name**: Extract from `cwd` path
- **Start Time**: User message `timestamp`
- **End Time**: Last related message `timestamp` (before next user text message)
- **Input**: User message `content`
- **Output**: Aggregated assistant responses and tool results
- **Metadata**: Session info, token usage, model details

### Response Aggregation Strategy
**Assistant Response Cycle Output Format:**
```json
{
  "responses": [
    {
      "type": "text",
      "content": "Assistant text response",
      "timestamp": "ISO 8601",
      "model": "claude-sonnet-4-20250514"
    },
    {
      "type": "tool_calls",
      "calls": [
        {
          "name": "WebFetch",
          "input": {"url": "...", "prompt": "..."},
          "output": "Tool result...",
          "duration_ms": 11844
        }
      ]
    }
  ],
  "summary": {
    "total_tokens": {"input": 283, "output": 356},
    "tool_calls_count": 3,
    "duration_ms": 35000
  }
}
```

### Configuration for Opik Integration
- **No Spans**: Use traces-only approach due to Opik limitations
- **Thread Grouping**: Use `sessionId` as `thread_id` to group conversation traces
- **Smart Batching**: Group related messages to avoid trace fragmentation
- **Tool Result Integration**: Combine tool calls with results for complete context

## Configuration Options

### Opik Configuration
The package will read Opik configuration from:

1. **Environment Variables**:
   - `OPIK_API_KEY`: API key for authentication (required)
   - `OPIK_BASE_URL`: Opik server URL (default: http://localhost:5173)
   - `OPIK_PROJECT_NAME`: Default project name (optional)

2. **Opik Config File** (`~/.opik.config`):
   - Standard Opik configuration file if environment variables not set

**Error Handling**: Package will raise an error at startup if no API key is found in either location.

### Additional Options
- Custom project mapping from Claude Code working directory
- Include/exclude patterns for specific sessions or projects
- Batch size for bulk operations

This plan provides a comprehensive foundation for building a robust Claude Code to Opik sync solution with both CLI and hooks-based usage patterns.