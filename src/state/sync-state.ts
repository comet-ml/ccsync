import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, unlinkSync, openSync, closeSync, constants } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface SyncedGroup {
  traceId: string;           // UUIDv7 trace ID for Opik
  userMessageUuid: string;   // Claude user message UUID
  lastMessageUuid: string;   // Claude last message UUID in group
  messageCount: number;
}

export interface SessionSyncState {
  sessionId: string;
  lastSyncTime: string;
  fingerprint: string;
  messageCount: number;
  lastMessageTime: string;
  syncedGroups: SyncedGroup[];
}

export interface SyncStateData {
  sessions: Record<string, SessionSyncState>;
  lastUpdated: string;
}

export interface SessionFingerprint {
  sessionId: string;
  messageCount: number;
  lastMessageTime: string;
  fileModTime: string;
  checksum: string;
}

export class SyncStateManager {
  private readonly stateDir: string;
  private readonly stateFile: string;
  private readonly lockFile: string;
  private readonly lockTimeout: number = 30000; // 30 seconds
  private readonly maxRetries: number = 10;

  constructor() {
    this.stateDir = join(homedir(), '.opik', 'sync-state');
    this.stateFile = join(this.stateDir, 'sessions.json');
    this.lockFile = join(this.stateDir, 'sessions.lock');
    this.ensureStateDirectory();
  }

  private ensureStateDirectory(): void {
    if (!existsSync(this.stateDir)) {
      mkdirSync(this.stateDir, { recursive: true });
    }
  }

  private generateFingerprint(sessionId: string, messageCount: number, lastMessageTime: string, fileModTime: string): string {
    const data = `${sessionId}:${messageCount}:${lastMessageTime}:${fileModTime}`;
    return createHash('sha256').update(data).digest('hex');
  }

  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    let lockFd: number | null = null;
    let attempts = 0;

    while (attempts < this.maxRetries) {
      try {
        // Clean up stale locks (older than lockTimeout)
        this.cleanStaleLocks();

        // Try to acquire exclusive lock
        lockFd = openSync(this.lockFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
        writeFileSync(lockFd, `${process.pid}:${Date.now()}`);
        
        // Execute the operation
        const result = await operation();
        
        // Release lock
        closeSync(lockFd);
        unlinkSync(this.lockFile);
        
        return result;
      } catch (error: any) {
        if (lockFd !== null) {
          try {
            closeSync(lockFd);
          } catch {
            // Ignore close errors
          }
        }

        if (error.code === 'EEXIST') {
          // Lock file exists, wait and retry
          attempts++;
          const delay = Math.min(100 * Math.pow(2, attempts), 2000); // Exponential backoff, max 2s
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        } else {
          throw error;
        }
      }
    }

    throw new Error(`Failed to acquire lock after ${this.maxRetries} attempts`);
  }

  private cleanStaleLocks(): void {
    if (!existsSync(this.lockFile)) {
      return;
    }

    try {
      const lockStat = statSync(this.lockFile);
      const lockAge = Date.now() - lockStat.mtime.getTime();
      
      if (lockAge > this.lockTimeout) {
        console.warn(`Removing stale lock file (age: ${Math.round(lockAge / 1000)}s)`);
        unlinkSync(this.lockFile);
      }
    } catch (error) {
      // If we can't read the lock file, try to remove it
      try {
        unlinkSync(this.lockFile);
      } catch {
        // Ignore removal errors
      }
    }
  }

  private loadState(): SyncStateData {
    if (!existsSync(this.stateFile)) {
      return {
        sessions: {},
        lastUpdated: new Date().toISOString()
      };
    }

    try {
      const content = readFileSync(this.stateFile, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      console.warn(`Failed to load sync state: ${error instanceof Error ? error.message : error}`);
      return {
        sessions: {},
        lastUpdated: new Date().toISOString()
      };
    }
  }

  private saveState(state: SyncStateData): void {
    state.lastUpdated = new Date().toISOString();
    
    // Atomic write: write to temp file then rename
    const tempFile = `${this.stateFile}.tmp`;
    writeFileSync(tempFile, JSON.stringify(state, null, 2));
    
    // Rename is atomic on most filesystems
    require('fs').renameSync(tempFile, this.stateFile);
  }

  createSessionFingerprint(sessionId: string, sessionFile: string): SessionFingerprint {
    const { parseConversation } = require('../parsers/claude');
    
    const messages = parseConversation(sessionFile);
    const fileStats = statSync(sessionFile);
    
    const lastMessage = messages[messages.length - 1];
    const lastMessageTime = lastMessage?.timestamp || new Date().toISOString();
    const fileModTime = fileStats.mtime.toISOString();
    
    const fingerprint = this.generateFingerprint(
      sessionId,
      messages.length,
      lastMessageTime,
      fileModTime
    );

    return {
      sessionId,
      messageCount: messages.length,
      lastMessageTime,
      fileModTime,
      checksum: fingerprint
    };
  }

  async needsSync(sessionId: string, sessionFile: string): Promise<{ needsSync: boolean; reason?: string }> {
    return this.withLock(async () => {
      const state = this.loadState();
      const currentFingerprint = this.createSessionFingerprint(sessionId, sessionFile);
      
      const existingState = state.sessions[sessionId];
      if (!existingState) {
        return { needsSync: true, reason: 'Session not previously synced' };
      }

      if (existingState.fingerprint !== currentFingerprint.checksum) {
        return { 
          needsSync: true, 
          reason: `Session changed (messages: ${existingState.messageCount} -> ${currentFingerprint.messageCount})` 
        };
      }

      return { needsSync: false, reason: 'Session unchanged since last sync' };
    });
  }

  async markSynced(sessionId: string, sessionFile: string): Promise<void> {
    return this.withLock(async () => {
      const state = this.loadState();
      const fingerprint = this.createSessionFingerprint(sessionId, sessionFile);
      
      state.sessions[sessionId] = {
        sessionId,
        lastSyncTime: new Date().toISOString(),
        fingerprint: fingerprint.checksum,
        messageCount: fingerprint.messageCount,
        lastMessageTime: fingerprint.lastMessageTime,
        syncedGroups: []
      };

      this.saveState(state);
    });
  }

  async updateSyncedGroups(sessionId: string, sessionFile: string, syncedGroups: SyncedGroup[]): Promise<void> {
    return this.withLock(async () => {
      const state = this.loadState();
      const fingerprint = this.createSessionFingerprint(sessionId, sessionFile);
      
      state.sessions[sessionId] = {
        sessionId,
        lastSyncTime: new Date().toISOString(),
        fingerprint: fingerprint.checksum,
        messageCount: fingerprint.messageCount,
        lastMessageTime: fingerprint.lastMessageTime,
        syncedGroups: syncedGroups
      };

      this.saveState(state);
    });
  }

  async getSyncState(): Promise<SyncStateData> {
    return this.withLock(async () => {
      return this.loadState();
    });
  }

  async clearState(): Promise<void> {
    return this.withLock(async () => {
      const state: SyncStateData = {
        sessions: {},
        lastUpdated: new Date().toISOString()
      };
      this.saveState(state);
    });
  }

  async removeSession(sessionId: string): Promise<void> {
    return this.withLock(async () => {
      const state = this.loadState();
      delete state.sessions[sessionId];
      this.saveState(state);
    });
  }

  cleanLocks(): void {
    this.cleanStaleLocks();
  }
}

export const syncStateManager = new SyncStateManager();