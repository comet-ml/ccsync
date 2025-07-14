import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { ClaudeMessage, SessionInfo } from '../types';

export function listSessions(projectPath?: string, claudeDataDir: string = join(require('os').homedir(), '.claude')): SessionInfo[] {
  const projectsDir = join(claudeDataDir, 'projects');
  
  if (!existsSync(projectsDir)) {
    return [];
  }

  const sessions: SessionInfo[] = [];
  const projectDirs = readdirSync(projectsDir);

  for (const projectDir of projectDirs) {
    const fullProjectPath = join(projectsDir, projectDir);
    
    // Skip if not a directory
    if (!statSync(fullProjectPath).isDirectory()) {
      continue;
    }

    // If projectPath filter is provided, skip non-matching projects
    if (projectPath && !projectDir.includes(projectPath.replace(/[/\\]/g, '-'))) {
      continue;
    }

    const sessionFiles = readdirSync(fullProjectPath).filter(file => file.endsWith('.jsonl'));
    
    for (const sessionFile of sessionFiles) {
      const sessionId = sessionFile.replace('.jsonl', '');
      const sessionFilePath = join(fullProjectPath, sessionFile);
      
      try {
        const sessionInfo = getSessionInfo(sessionFilePath, sessionId, projectDir);
        sessions.push(sessionInfo);
      } catch (error) {
        console.warn(`Warning: Could not read session ${sessionId}:`, error instanceof Error ? error.message : error);
      }
    }
  }

  // Sort by timestamp (newest first)
  return sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

function getSessionInfo(sessionFilePath: string, sessionId: string, projectDir: string): SessionInfo {
  const content = readFileSync(sessionFilePath, 'utf8');
  const lines = content.trim().split('\n').filter(line => line.trim());
  
  if (lines.length === 0) {
    throw new Error('Empty session file');
  }

  // Parse first line to determine file type
  const firstLine = JSON.parse(lines[0]);
  
  // Check if this is a summary file (not a conversation)
  if (firstLine.type === 'summary') {
    return handleSummaryFile(sessionFilePath, sessionId, projectDir, lines);
  }
  
  // Handle regular conversation file
  const firstMessage: ClaudeMessage = firstLine;
  
  // Validate timestamp
  if (!firstMessage.timestamp) {
    throw new Error('Missing timestamp in first message');
  }
  
  const timestampDate = new Date(firstMessage.timestamp);
  if (isNaN(timestampDate.getTime())) {
    throw new Error(`Invalid timestamp format: ${firstMessage.timestamp}`);
  }
  
  // Find first user message for description
  let description = 'No user message found';
  for (const line of lines) {
    try {
      const message: ClaudeMessage = JSON.parse(line);
      if (message.type === 'user' && typeof message.message.content === 'string') {
        // Truncate long messages
        description = message.message.content.length > 100 
          ? message.message.content.substring(0, 100) + '...'
          : message.message.content;
        break;
      }
    } catch {
      // Skip malformed lines
      continue;
    }
  }

  return {
    sessionId,
    projectPath: projectDir.replace(/-/g, '/'), // Convert back to path format
    description,
    timestamp: firstMessage.timestamp,
    messageCount: lines.length
  };
}

function handleSummaryFile(sessionFilePath: string, sessionId: string, projectDir: string, lines: string[]): SessionInfo {
  // For summary files, use file modification time as timestamp
  const stats = statSync(sessionFilePath);
  const timestamp = stats.mtime.toISOString();
  
  // Use the first summary as description
  const firstSummary = JSON.parse(lines[0]);
  const description = firstSummary.summary || 'Summary file';
  
  return {
    sessionId,
    projectPath: projectDir.replace(/-/g, '/'), // Convert back to path format
    description,
    timestamp,
    messageCount: lines.length
  };
}

export function parseConversation(sessionFile: string): ClaudeMessage[] {
  try {
    const content = readFileSync(sessionFile, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    
    const messages: ClaudeMessage[] = [];
    for (const line of lines) {
      try {
        const message: ClaudeMessage = JSON.parse(line);
        messages.push(message);
      } catch (error) {
        console.warn(`Warning: Could not parse message line:`, error instanceof Error ? error.message : error);
      }
    }
    
    return messages;
  } catch (error) {
    throw new Error(`Failed to read session file ${sessionFile}: ${error instanceof Error ? error.message : error}`);
  }
}

export function findSessionFile(sessionId: string, claudeDataDir: string = join(require('os').homedir(), '.claude')): string | null {
  const projectsDir = join(claudeDataDir, 'projects');
  
  if (!existsSync(projectsDir)) {
    return null;
  }

  const projectDirs = readdirSync(projectsDir);

  for (const projectDir of projectDirs) {
    const fullProjectPath = join(projectsDir, projectDir);
    
    if (!statSync(fullProjectPath).isDirectory()) {
      continue;
    }

    const sessionFilePath = join(fullProjectPath, `${sessionId}.jsonl`);
    if (existsSync(sessionFilePath)) {
      return sessionFilePath;
    }
  }

  return null;
}