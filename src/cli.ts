#!/usr/bin/env node

import { Command } from 'commander';
import { getOpikConfig, getClaudeDataDir } from './config';
import { listSessions } from './parsers/claude';
import { syncSession, syncProject } from './sync';
import { createLogger } from './utils/logger';

function formatTimeAgo(milliseconds: number): string {
  // Handle invalid or NaN values
  if (!milliseconds || isNaN(milliseconds) || milliseconds < 0) {
    return 'unknown';
  }

  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) return `${years}y ago`;
  if (months > 0) return `${months}mo ago`;
  if (weeks > 0) return `${weeks}w ago`;
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

const program = new Command();

program
  .name('@opik/ccsync')
  .description('Sync Claude Code conversations to Opik for observability and analytics')
  .version('0.1.0');

program
  .command('ls')
  .description('List all available Claude Code sessions')
  .option('--project <path>', 'Filter sessions by project path')
  .action(async (options) => {
    try {
      const logger = createLogger();
      logger.info('Listing Claude Code sessions...');
      const claudeDataDir = getClaudeDataDir();
      const sessions = listSessions(options.project, claudeDataDir);
      
      if (sessions.length === 0) {
        if (options.project) {
          logger.info(`No sessions found for project: ${options.project}`);
        } else {
          logger.info('No sessions found. Make sure you have used Claude Code and have conversations in ~/.claude/projects/');
        }
        return;
      }

      logger.info('Session ID                           Last Updated # Messages Summary');
      
      sessions.forEach((session, index) => {
        const now = new Date();
        const sessionDate = new Date(session.timestamp);
        
        // Calculate time ago
        const timeDiff = now.getTime() - sessionDate.getTime();
        const timeAgo = formatTimeAgo(timeDiff);
        
        // Debug: log problematic sessions
        if (timeAgo === 'unknown') {
          console.warn(`Warning: Invalid timestamp for session ${session.sessionId}: ${session.timestamp}`);
        }
        
        // Truncate session ID for display
        const displaySessionId = session.sessionId.substring(0, 36);
        
        // Escape newlines and truncate description to fit nicely
        const maxDescLength = 50;
        const cleanedDesc = session.description.replace(/[\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
        const truncatedDesc = cleanedDesc.length > maxDescLength 
          ? cleanedDesc.substring(0, maxDescLength) + '...'
          : cleanedDesc;
        
        const rowNumber = `${(index + 1).toString()}.`.padEnd(4); // "1. " = 3 chars + 1 space = 4 total
        logger.info(`❯ ${rowNumber}${displaySessionId.padEnd(36)} ${timeAgo.padEnd(12)} ${session.messageCount.toString().padEnd(10)} ${truncatedDesc}`);
      });
    } catch (error) {
      const logger = createLogger();
      logger.error(`Error listing sessions: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

program
  .command('sync')
  .description('Sync Claude Code data to Opik')
  .option('--session <id>', 'Sync specific session by ID')
  .option('--project <path>', 'Sync all sessions in project path')
  .option('--watch', 'Watch for new conversations and sync automatically')
  .option('--force', 'Force sync even if session was already synced')
  .option('--dry-run', 'Preview what would be synced without actually syncing')
  .option('--verbose', 'Enable verbose logging')
  .option('--all', 'Sync all sessions across all projects')
  .action(async (options) => {
    const logger = createLogger({ verbose: options.verbose, dryRun: options.dryRun });
    
    try {
      // Validate Opik configuration at startup
      const opikConfig = getOpikConfig();
      logger.success(`Connected to Opik at ${opikConfig.base_url}`);

      const syncOptions = {
        force: options.force || false,
        dryRun: options.dryRun || false,
        verbose: options.verbose || false
      };

      if (options.session) {
        logger.progress(`Syncing session: ${options.session}`);
        if (options.force) logger.info('Force mode enabled');
        if (options.dryRun) logger.info('Dry run mode enabled');
        
        const tmpFile = await syncSession(options.session, syncOptions);
        if (tmpFile) {
          logger.success('Session sync completed');
          logger.debug(`Traces written to: ${tmpFile}`);
        } else {
          logger.success('Session sync completed (no sync needed)');
        }
      } else if (options.project) {
        logger.progress(`Syncing project: ${options.project}`);
        await syncProject(options.project, syncOptions);
        logger.success('Project sync completed');
      } else if (options.all) {
        logger.progress('Syncing all sessions across all projects');
        await syncProject(null, syncOptions);
        logger.success('All sessions sync completed');
      } else if (options.watch) {
        const { startWatchMode } = await import('./watch');
        await startWatchMode({
          force: options.force || false,
          dryRun: options.dryRun || false,
          verbose: options.verbose || false,
          debounceMs: 2000
        });
      } else {
        logger.error('Please specify --session, --project, --all, or --watch');
        process.exit(1);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Check if it's a configuration error
      if (errorMessage.includes('No Opik configuration found')) {
        logger.error('❌ No Opik configuration found!');
        logger.info('');
        logger.info('💡 To set up configuration, run:');
        logger.info('   ccsync config');
        logger.info('');
        logger.info('🔧 Or set environment variables:');
        logger.info('   export OPIK_API_KEY="your-api-key"');
        logger.info('   export OPIK_BASE_URL="http://localhost:5173"');
      } else {
        logger.error(`Error during sync: ${errorMessage}`);
      }
      
      process.exit(1);
    }
  });

program
  .command('config')
  .description('Configure Opik connection (interactive setup)')
  .option('--show', 'Show current configuration without interactive setup')
  .action(async (options) => {
    try {
      if (options.show) {
        const { showConfigStatus } = await import('./config/interactive');
        await showConfigStatus();
      } else {
        const { runInteractiveConfig } = await import('./config/interactive');
        await runInteractiveConfig();
      }
    } catch (error) {
      const logger = createLogger();
      logger.error(`Configuration error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

program
  .command('state')
  .description('Manage sync state')
  .option('--reset', 'Clear all sync state')
  .option('--show', 'Show current sync state')
  .option('--clean', 'Clean stale lock files')
  .action(async (options) => {
    try {
      const { syncStateManager } = await import('./state/sync-state');

      if (options.reset) {
        const logger = createLogger();
        logger.info('Clearing all sync state...');
        await syncStateManager.clearState();
        logger.success('Sync state cleared');
      } else if (options.show) {
        const logger = createLogger();
        logger.info('Current sync state:');
        const state = await syncStateManager.getSyncState();
        
        if (Object.keys(state.sessions).length === 0) {
          logger.info('  No sessions have been synced yet');
        } else {
          logger.info(`  Last updated: ${state.lastUpdated}`);
          logger.info(`  Sessions synced: ${Object.keys(state.sessions).length}`);
          logger.info('');
          
          Object.values(state.sessions).forEach(session => {
            logger.info(`  📋 ${session.sessionId}`);
            logger.info(`     Last sync: ${session.lastSyncTime}`);
            logger.info(`     Messages: ${session.messageCount}`);
            logger.info(`     Last message: ${session.lastMessageTime}`);
            logger.info('');
          });
        }
      } else if (options.clean) {
        const logger = createLogger();
        logger.info('Cleaning stale lock files...');
        syncStateManager.cleanLocks();
        logger.success('Lock files cleaned');
      } else {
        const logger = createLogger();
        logger.error('Please specify --reset, --show, or --clean');
        process.exit(1);
      }
    } catch (error) {
      const logger = createLogger();
      logger.error(`Error managing state: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse();

export default program;