import { OpikConfig, OpikTrace, SyncOptions, ClaudeMessage } from './types';
import { createOpikClient, OpikApiClient } from './api/opik-client';
import { SyncedGroup } from './state/sync-state';
import { createLogger } from './utils/logger';

export class OpikClient {
  private apiClient: OpikApiClient;

  constructor(config: OpikConfig) {
    this.apiClient = createOpikClient(config);
  }

  async createTraces(traces: OpikTrace[]): Promise<any> {
    return await this.apiClient.createTraces(traces);
  }

  async testConnection(): Promise<boolean> {
    return await this.apiClient.testConnection();
  }

  async updateTrace(traceId: string, trace: Partial<OpikTrace>): Promise<void> {
    return await this.apiClient.updateTrace(traceId, trace);
  }

  async updateThreadTags(threadId: string, tags: string[]): Promise<void> {
    return await this.apiClient.updateThreadTags(threadId, tags);
  }
}

interface GroupAction {
  action: 'create' | 'update';
  group: ClaudeMessage[];
  traceId?: string;
}

function analyzeGroupChanges(currentGroups: ClaudeMessage[][], syncedGroups: SyncedGroup[]): GroupAction[] {
  const actions: GroupAction[] = [];
  
  for (const group of currentGroups) {
    if (group.length === 0) continue;
    
    const userMessage = group[0];
    const lastMessage = group[group.length - 1];
    
    // Find if this group was previously synced
    const syncedGroup = syncedGroups.find(sg => sg.userMessageUuid === userMessage.uuid);
    
    if (!syncedGroup) {
      // New group - CREATE trace
      actions.push({action: 'create', group});
    } else if (syncedGroup.lastMessageUuid !== lastMessage.uuid || 
               syncedGroup.messageCount !== group.length) {
      // Group has new content - UPDATE trace
      actions.push({action: 'update', group, traceId: syncedGroup.traceId});
    }
    // If unchanged, no action needed
  }
  
  return actions;
}

function generateUUIDv7(): string {
  // Generate proper UUIDv7 using library
  const { uuidv7 } = require('uuidv7');
  return uuidv7();
}

async function convertGroupToTrace(group: ClaudeMessage[]): Promise<OpikTrace | null> {
  // Import the necessary functions
  const { claudeToOpikTraces } = await import('./parsers/opik');
  
  // Create a temporary message array with just this group
  const traces = claudeToOpikTraces(group);
  if (traces.length === 0) return null;
  
  const trace = traces[0];
  const userMessage = group[0];
  
  // Generate proper UUIDv7 trace ID
  trace.id = generateUUIDv7();
  
  return trace;
}

export async function syncSession(sessionId: string, options: SyncOptions = {}): Promise<string> {
  const { findSessionFile, parseConversation } = await import('./parsers/claude');
  const { claudeToOpikTraces, groupMessagesByUserInteraction } = await import('./parsers/opik');
  const { getOpikConfig } = await import('./config');
  const { writeFileSync } = await import('fs');
  const { join } = await import('path');
  const { tmpdir } = await import('os');
  const { syncStateManager } = await import('./state/sync-state');
  
  const logger = createLogger({ verbose: options.verbose, dryRun: options.dryRun });
  
  // Find the session file
  const sessionFile = findSessionFile(sessionId);
  if (!sessionFile) {
    throw new Error(`Session ${sessionId} not found`);
  }
  
  logger.debug(`Reading session from: ${sessionFile}`);
  
  // Parse the conversation and group by user interaction
  const messages = parseConversation(sessionFile);
  const currentGroups = groupMessagesByUserInteraction(messages);
  logger.debug(`Parsed ${messages.length} messages into ${currentGroups.length} conversation groups`);
  
  let existingSyncedGroups: SyncedGroup[] = [];
  let syncReason = '';
  
  // Check if sync is needed (unless force flag is set)
  if (!options.force) {
    try {
      const syncCheck = await syncStateManager.needsSync(sessionId, sessionFile);
      if (!syncCheck.needsSync) {
        logger.dryRun(`Would skip session ${sessionId}`);
        
        // Return empty result to indicate no sync performed
        return '';
      }
      
      syncReason = syncCheck.reason || 'Sync needed';
      
      // Get existing synced groups
      const state = await syncStateManager.getSyncState();
      const existingSession = state.sessions[sessionId];
      if (existingSession) {
        // Handle migration from old state format
        if (existingSession.syncedGroups) {
          existingSyncedGroups = existingSession.syncedGroups;
          logger.debug(`Found ${existingSyncedGroups.length} previously synced groups`);
        } else {
          logger.debug(`Session found but no group tracking (old format) - will recreate all groups`);
          existingSyncedGroups = [];
        }
      }
    } catch (stateError) {
      logger.warning(`State check failed: ${stateError instanceof Error ? stateError.message : stateError}`);
      syncReason = 'State error - proceeding with full sync';
    }
  } else {
    syncReason = 'Force sync enabled';
  }
  
  // Analyze what groups need to be created or updated
  const groupActions = analyzeGroupChanges(currentGroups, existingSyncedGroups);
  const createCount = groupActions.filter(a => a.action === 'create').length;
  const updateCount = groupActions.filter(a => a.action === 'update').length;
  
  if (groupActions.length === 0) {
    // Skip logging - no conversations need syncing
    return '';
  }
  
  // If dry run, just show what would be done
  if (options.dryRun) {
    logger.dryRun(`Would process ${groupActions.length} conversation${groupActions.length === 1 ? '' : 's'}`);
    for (const action of groupActions) {
      logger.dryRun(`${action.action.toUpperCase()}: conversation with ${action.group.length} messages`);
    }
    return '';
  }
  
  // Process group actions
  const opikConfig = getOpikConfig();
  const opikClient = new OpikClient(opikConfig);
  const updatedSyncedGroups: SyncedGroup[] = [...existingSyncedGroups];
  let totalTraces = 0;
  
  // Write to tmp file for review
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tmpFile = join(tmpdir(), `opik-traces-${sessionId}-${timestamp}.json`);
  const allTraces: OpikTrace[] = [];
  
  // Separate create and update actions
  const createActions = groupActions.filter(a => a.action === 'create');
  const updateActions = groupActions.filter(a => a.action === 'update');
  
  try {
    // Process create actions in batch
    if (createActions.length > 0) {
      const tracesToCreate: OpikTrace[] = [];
      const createGroups: { action: GroupAction; trace: OpikTrace }[] = [];
      
      for (const action of createActions) {
        const trace = await convertGroupToTrace(action.group);
        if (trace) {
          tracesToCreate.push(trace);
          createGroups.push({ action, trace });
          allTraces.push(trace);
        }
      }
      
      if (tracesToCreate.length > 0) {
        await opikClient.createTraces(tracesToCreate);
        
        // Process traces and update synced groups using deterministic IDs
        for (const { action, trace } of createGroups) {
          const userMessage = action.group[0];
          const lastMessage = action.group[action.group.length - 1];
          const traceId = trace.id!; // We set this in convertGroupToTrace
          
          logger.debug(`Created trace ${traceId} for conversation ${userMessage.uuid}`);
          
          // Update thread tags if we have thread_id and tags
          if (trace.thread_id && trace.tags) {
            try {
              await opikClient.updateThreadTags(trace.thread_id, trace.tags);
              logger.debug(`Updated thread tags for ${trace.thread_id}`);
            } catch (error) {
              logger.warning(`Failed to update thread tags for ${trace.thread_id}: ${error instanceof Error ? error.message : error}`);
            }
          }
          
          // Add to synced groups
          updatedSyncedGroups.push({
            traceId,
            userMessageUuid: userMessage.uuid,
            lastMessageUuid: lastMessage.uuid,
            messageCount: action.group.length
          });
          
          totalTraces++;
        }
      }
    }
    
    // Process update actions individually
    for (const action of updateActions) {
      if (!action.traceId) continue;
      
      const userMessage = action.group[0];
      const lastMessage = action.group[action.group.length - 1];
      
      const trace = await convertGroupToTrace(action.group);
      if (!trace) continue;
      
      allTraces.push(trace);
      
      // Update existing trace
      await opikClient.updateTrace(action.traceId, trace);
      logger.debug(`Updated trace ${action.traceId} for conversation ${userMessage.uuid}`);
      
      // Update thread tags if we have thread_id and tags
      if (trace.thread_id && trace.tags) {
        try {
          await opikClient.updateThreadTags(trace.thread_id, trace.tags);
          logger.debug(`Updated thread tags for ${trace.thread_id}`);
        } catch (error) {
          logger.warning(`Failed to update thread tags for ${trace.thread_id}: ${error instanceof Error ? error.message : error}`);
        }
      }
      
      // Update synced groups
      const existingIndex = updatedSyncedGroups.findIndex(sg => sg.traceId === action.traceId);
      if (existingIndex !== -1) {
        updatedSyncedGroups[existingIndex] = {
          traceId: action.traceId,
          userMessageUuid: userMessage.uuid,
          lastMessageUuid: lastMessage.uuid,
          messageCount: action.group.length
        };
      }
      
      totalTraces++;
    }
    
    writeFileSync(tmpFile, JSON.stringify(allTraces, null, 2));
    logger.debug(`Opik traces written to: ${tmpFile}`);
    
    const finalCreateCount = groupActions.filter(a => a.action === 'create').length;
    const finalUpdateCount = groupActions.filter(a => a.action === 'update').length;
    
    // Show sync summary
    logger.syncSummary(sessionId, syncReason, finalCreateCount, finalUpdateCount, totalTraces);
    
    // Update synced groups in state
    try {
      await syncStateManager.updateSyncedGroups(sessionId, sessionFile, updatedSyncedGroups);
      logger.debug(`Session state updated with ${updatedSyncedGroups.length} synced groups`);
    } catch (stateError) {
      logger.warning(`Failed to update sync state: ${stateError instanceof Error ? stateError.message : stateError}`);
      logger.warning(`Sync completed successfully but state update failed`);
    }
    
  } catch (error) {
    logger.error(`Failed to sync to Opik: ${error instanceof Error ? error.message : error}`);
    logger.info(`Traces are still available in: ${tmpFile}`);
    throw error;
  }
  
  return tmpFile;
}

export async function syncProject(projectPath: string | null, options: SyncOptions = {}): Promise<void> {
  const { listSessions } = await import('./parsers/claude');
  const { getClaudeDataDir } = await import('./config');
  const logger = createLogger({ verbose: options.verbose, dryRun: options.dryRun });
  
  const claudeDataDir = getClaudeDataDir();
  const sessions = listSessions(projectPath || undefined, claudeDataDir);
  
  if (sessions.length === 0) {
    const message = projectPath ? `No sessions found for project: ${projectPath}` : 'No sessions found';
    logger.info(message);
    return;
  }
  
  logger.info(`Found ${sessions.length} session${sessions.length === 1 ? '' : 's'} to sync`);
  
  let syncedCount = 0;
  let skippedCount = 0;
  
  for (const session of sessions) {
    try {
      const result = await syncSession(session.sessionId, options);
      if (result) {
        syncedCount++;
        logger.debug(`Synced session ${session.sessionId}`);
      } else {
        skippedCount++;
        logger.debug(`Skipped session ${session.sessionId} (already up to date)`);
      }
    } catch (error) {
      logger.error(`Failed to sync session ${session.sessionId}: ${error instanceof Error ? error.message : error}`);
    }
  }
  
  logger.info(`Sync completed: ${syncedCount} synced, ${skippedCount} skipped`);
}
