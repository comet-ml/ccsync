import { ClaudeMessage, OpikTrace } from '../types';
import { randomBytes } from 'crypto';
import { relative, resolve } from 'path';

function generateUUIDv7(): string {
  // Generate a UUID version 7 (time-ordered)
  // Format: TTTTTTTT-TTTT-7RRR-VRRR-RRRRRRRRRRRR
  // Where T = timestamp, R = random, V = variant bits
  
  const timestamp = Date.now();
  const randomBits = randomBytes(10);
  
  // Convert timestamp to hex and pad to 12 characters (48 bits)
  const timestampHex = timestamp.toString(16).padStart(12, '0');
  
  // Build the UUID
  const uuid = [
    timestampHex.slice(0, 8),                              // 32 bits of timestamp
    timestampHex.slice(8, 12),                             // 16 bits of timestamp  
    '7' + randomBits[0].toString(16).padStart(3, '0'),     // version 7 + 12 random bits
    ((randomBits[1] & 0x3F) | 0x80).toString(16) +        // variant bits + 6 random bits
      randomBits[2].toString(16).padStart(2, '0'),         // + 8 random bits
    randomBits.slice(3, 9).toString('hex')                 // 48 random bits
  ].join('-');
  
  return uuid;
}

export function claudeToOpikTraces(messages: ClaudeMessage[], startFromIndex: number = 0): OpikTrace[] {
  // If startFromIndex is provided, only process messages from that index onwards
  const messagesToProcess = startFromIndex > 0 ? messages.slice(startFromIndex) : messages;
  const groups = groupMessagesByUserInteraction(messagesToProcess);
  const traces: OpikTrace[] = [];
  
  for (const group of groups) {
    if (group.length === 0) continue;
    
    const userMessage = group[0];
    const assistantMessages = group.slice(1);
    
    // Skip if no user message or user message is not text
    if (userMessage.type !== 'user' || typeof userMessage.message.content !== 'string') {
      continue;
    }
    
    // Use "Claude Code" as the project name
    const projectName = "Claude Code";
    
    // Extract project name from working directory
    const workingProjectName = extractProjectName(userMessage.cwd);
    
    // Build timeline-style output from assistant responses
    const output = buildTimelineOutput(assistantMessages);
    
    // Calculate total tokens
    const totalTokens = calculateTotalTokens(group);
    
    // Create project-specific tags
    const projectTags = ['claude-code', `project:${workingProjectName}`];
    
    // Create trace
    const trace: OpikTrace = {
      id: generateUUIDv7(),
      project_name: projectName,
      name: truncateString(userMessage.message.content, 100),
      start_time: userMessage.timestamp,
      end_time: group[group.length - 1]?.timestamp || userMessage.timestamp,
      input: userMessage.message.content,
      output: output,
      metadata: {
        session_id: userMessage.sessionId,
        working_directory: userMessage.cwd,
        claude_version: userMessage.version,
        total_tokens: totalTokens,
        message_count: group.length,
        raw_messages: group,
        original_message_id: userMessage.uuid,
        project_name: workingProjectName
      },
      thread_id: userMessage.sessionId,
      tags: projectTags
    };
    
    traces.push(trace);
  }
  
  return traces;
}

function extractProjectName(cwd: string): string {
  if (!cwd || typeof cwd !== 'string') {
    return 'unknown-project';
  }
  const pathParts = cwd.split('/').filter(part => part.length > 0);
  return pathParts[pathParts.length - 1] || 'unknown-project';
}

function buildTimelineOutput(assistantMessages: ClaudeMessage[]): string {
  // First pass: collect all tool calls and their results
  const toolCalls: Map<string, {call: string, result: string | null, cwd: string}> = new Map();
  const timeline: Array<{type: 'text' | 'tool', content: string, toolId?: string}> = [];
  
  // Collect tool calls and results
  for (const message of assistantMessages) {
    if (!message.message) continue;
    
    if (message.type === 'assistant') {
      if (typeof message.message.content === 'string') {
        // Text response
        timeline.push({type: 'text', content: message.message.content});
      } else if (Array.isArray(message.message.content)) {
        // Process array content (can contain both text and tool_use)
        for (const item of message.message.content) {
          if (item && item.type === 'text') {
            timeline.push({type: 'text', content: item.text});
          } else if (item && item.type === 'tool_use') {
            // Tool call
            const toolDesc = formatToolDescription(item.name, item.input, message.cwd);
            const toolId = item.id;
            
            toolCalls.set(toolId, {
              call: `⏺ ${toolDesc}`,
              result: null,
              cwd: message.cwd
            });
            
            timeline.push({type: 'tool', content: '', toolId});
          }
        }
      }
    } else if (message.type === 'user' && message.toolUseResult) {
      // Tool result - find the matching tool call ID
      const toolId = findToolCallId(message);
      
      if (toolId && toolCalls.has(toolId)) {
        const result = message.toolUseResult;
        if (result && typeof result === 'object') {
          const summary = formatEnhancedToolResultSummary(result, message.cwd);
          if (summary) {
            toolCalls.get(toolId)!.result = summary;
          }
        }
      }
    }
  }
  
  // Second pass: build final timeline with grouped tool calls and results
  const finalTimeline: string[] = [];
  
  for (const item of timeline) {
    if (item.type === 'text') {
      finalTimeline.push(item.content);
    } else if (item.type === 'tool' && item.toolId) {
      const toolInfo = toolCalls.get(item.toolId);
      if (toolInfo) {
        finalTimeline.push(toolInfo.call);
        if (toolInfo.result) {
          finalTimeline.push(toolInfo.result);
        }
      }
    }
  }
  
  return finalTimeline.join('\n\n').replace(/\\n/g, '\n').replace(/\\"/g, '"');
}

function findToolCallId(userMessage: ClaudeMessage): string | null {
  // Look for tool_use_id in the message content
  if (userMessage.message?.content && Array.isArray(userMessage.message.content)) {
    for (const item of userMessage.message.content) {
      if (item?.type === 'tool_result' && item.tool_use_id) {
        return item.tool_use_id;
      }
    }
  }
  
  return null;
}

function makeRelativePath(absolutePath: string, cwd: string): string {
  try {
    // Handle null/undefined paths
    if (!absolutePath || typeof absolutePath !== 'string') {
      return absolutePath || '';
    }
    
    // If the path is already relative or doesn't start with /, return as is
    if (!absolutePath.startsWith('/')) {
      return absolutePath;
    }
    
    // Convert absolute path to relative from the working directory
    const relativePath = relative(cwd, absolutePath);
    
    // If the relative path would go up directories, just use the filename
    if (relativePath.startsWith('../')) {
      const parts = absolutePath.split('/');
      return parts[parts.length - 1];
    }
    
    return relativePath;
  } catch {
    // If path conversion fails, just return the filename
    if (!absolutePath || typeof absolutePath !== 'string') {
      return absolutePath || '';
    }
    const parts = absolutePath.split('/');
    return parts[parts.length - 1];
  }
}

function formatToolDescription(toolName: string, input: any, cwd?: string): string {
  // Helper to get relative path if cwd is available
  const getDisplayPath = (path: string) => {
    return cwd ? makeRelativePath(path, cwd) : path;
  };
  
  switch (toolName) {
    case 'Read':
      return `Read(${getDisplayPath(input.file_path)})`;
    case 'Edit':
      return `Update(${getDisplayPath(input.file_path)})`;
    case 'MultiEdit':
      return `MultiEdit(${getDisplayPath(input.file_path)})`;
    case 'Write':
      return `Write(${getDisplayPath(input.file_path)})`;
    case 'Bash':
      return `Bash: ${input.command}`;
    case 'Glob':
      return `Glob(${input.pattern})`;
    case 'Grep':
      return `Grep("${input.pattern}")`;
    case 'LS':
      return `LS(${input.path ? getDisplayPath(input.path) : ''})`;
    case 'WebFetch':
      return `WebFetch(${input.url})`;
    case 'Task':
      return `Task: ${input.description}`;
    default:
      return `${toolName}()`;
  }
}

function formatEnhancedToolResultSummary(result: any, cwd?: string): string {
  // Check for any error conditions first
  if (result.success === false || result.error || result.stderr) {
    return `  ⎿  Failed`;
  }
  
  // Default to successful for all other cases
  return `  ⎿  Successful`;
}

function generateDiffOutput(oldContent: string, newContent: string, filePath?: string): string {
  // Simple diff generation - in a real implementation you might want to use a proper diff library
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  
  // For now, just show a simple line-by-line diff
  const diffLines: string[] = [];
  const maxLines = Math.max(oldLines.length, newLines.length);
  
  let lineNumber = 1;
  for (let i = 0; i < maxLines; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    
    if (oldLine !== undefined && newLine !== undefined) {
      if (oldLine !== newLine) {
        // Changed line
        diffLines.push(`${lineNumber.toString().padStart(8)} -  ${oldLine}`);
        diffLines.push(`${lineNumber.toString().padStart(8)} +  ${newLine}`);
      } else {
        // Unchanged line (show context)
        diffLines.push(`${lineNumber.toString().padStart(8)}    ${oldLine}`);
      }
    } else if (oldLine !== undefined) {
      // Removed line
      diffLines.push(`${lineNumber.toString().padStart(8)} -  ${oldLine}`);
    } else if (newLine !== undefined) {
      // Added line
      diffLines.push(`${lineNumber.toString().padStart(8)} +  ${newLine}`);
    }
    
    lineNumber++;
    
    // Limit diff output to prevent overwhelming display
    if (diffLines.length > 20) {
      diffLines.push('... (diff truncated)');
      break;
    }
  }
  
  return diffLines.length > 0 ? diffLines.join('\n') : '';
}

// Legacy function for backward compatibility
function formatToolResultSummary(result: any): string {
  return formatEnhancedToolResultSummary(result).replace(/^  ⎿  /, '');
}

function calculateTotalTokens(messages: ClaudeMessage[]): any {
  let inputTokens = 0;
  let outputTokens = 0;
  
  for (const message of messages) {
    if (message.message?.usage) {
      inputTokens += message.message.usage.input_tokens || 0;
      outputTokens += message.message.usage.output_tokens || 0;
    }
  }
  
  return {
    input: inputTokens,
    output: outputTokens
  };
}

function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + '...';
}

export function groupMessagesByUserInteraction(messages: ClaudeMessage[]): ClaudeMessage[][] {
  const groups: ClaudeMessage[][] = [];
  let currentGroup: ClaudeMessage[] = [];
  
  for (const message of messages) {
    // Skip summary messages
    if ((message as any).type === 'summary') {
      continue;
    }
    
    // Start a new group on user text messages (not tool results)
    if (message.type === 'user' && typeof message.message.content === 'string') {
      // Save previous group if it exists
      if (currentGroup.length > 0) {
        groups.push([...currentGroup]);
      }
      // Start new group with this user message
      currentGroup = [message];
    } else {
      // Add to current group (assistant responses, tool calls, tool results)
      currentGroup.push(message);
    }
  }
  
  // Add the final group if it exists
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }
  
  return groups;
}
