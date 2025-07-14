import { watch } from 'chokidar';
import { join } from 'path';
import { statSync, readdirSync } from 'fs';
import { syncSession } from './sync';
import { SyncOptions } from './types';
import { getClaudeDataDir } from './config';
import { createLogger } from './utils/logger';

interface WatchOptions extends SyncOptions {
  debounceMs?: number;
  includeInitial?: boolean;
}

interface WatchState {
  isRunning: boolean;
  watcher: any;
  debounceTimers: Map<string, NodeJS.Timeout>;
  syncCounts: {
    total: number;
    successful: number;
    failed: number;
  };
}

export class SessionWatcher {
  private state: WatchState;
  private options: WatchOptions;
  private claudeDataDir: string;
  private logger: ReturnType<typeof createLogger>;

  constructor(options: WatchOptions = {}) {
    this.options = {
      debounceMs: 2000, // 2 second debounce by default
      includeInitial: false,
      ...options
    };
    
    this.state = {
      isRunning: false,
      watcher: null,
      debounceTimers: new Map(),
      syncCounts: {
        total: 0,
        successful: 0,
        failed: 0
      }
    };

    this.claudeDataDir = getClaudeDataDir();
    this.logger = createLogger({ verbose: options.verbose, dryRun: options.dryRun });
  }

  async start(): Promise<void> {
    if (this.state.isRunning) {
      this.logger.warning('Watcher is already running');
      return;
    }

    const watchPath = join(this.claudeDataDir, 'projects');
    this.logger.info(`Starting watch mode...`);
    this.logger.info(`Monitoring: ${watchPath}`);
    this.logger.debug(`Debounce: ${this.options.debounceMs}ms`);
    this.logger.debug(`Auto-sync: ${this.options.force ? 'force mode' : 'smart mode'}`);
    this.logger.debug(`Dry run: ${this.options.dryRun ? 'enabled' : 'disabled'}`);
    this.logger.info('');
    this.logger.info('Press Ctrl+C to stop watching...');
    this.logger.info('');

    this.state.watcher = watch(`${watchPath}/**/*.jsonl`, {
      persistent: true,
      ignoreInitial: !this.options.includeInitial,
      awaitWriteFinish: {
        stabilityThreshold: 1000, // Wait 1s for file to stabilize
        pollInterval: 100
      }
    });

    this.state.watcher
      .on('add', (filePath: string) => this.handleFileChange('added', filePath))
      .on('change', (filePath: string) => this.handleFileChange('changed', filePath))
      .on('ready', () => {
        this.logger.success('Watcher is ready and monitoring files');
        this.printDirectoryStatus();
      })
      .on('error', (error: Error) => {
        this.logger.error(`Watcher error: ${error.message}`);
      });

    this.state.isRunning = true;

    // Setup graceful shutdown
    this.setupShutdownHandlers();
  }

  private handleFileChange(event: 'added' | 'changed', filePath: string): void {
    const sessionId = this.extractSessionId(filePath);
    if (!sessionId) {
      return;
    }

    // Check if we already have a pending sync for this session
    if (this.state.debounceTimers.has(sessionId)) {
      // Clear existing timer and set a new one
      const existingTimer = this.state.debounceTimers.get(sessionId);
      clearTimeout(existingTimer);
    } else {
      // Only log if this is a new session being detected
      this.logger.debug(`Session ${event}: ${sessionId}`);
    }

    // Set new debounce timer
    const timer = setTimeout(async () => {
      this.state.debounceTimers.delete(sessionId);
      await this.syncSessionSafely(sessionId);
    }, this.options.debounceMs);

    this.state.debounceTimers.set(sessionId, timer);
  }

  extractSessionId(filePath: string): string | null {
    // Extract session ID from path like: ~/.claude/projects/some-project/session-id.jsonl
    const match = filePath.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.jsonl$/);
    return match ? match[1] : null;
  }

  private async syncSessionSafely(sessionId: string): Promise<void> {
    this.state.syncCounts.total++;
    
    try {
      const result = await syncSession(sessionId, {
        force: this.options.force,
        dryRun: this.options.dryRun,
        verbose: this.options.verbose
      });

      if (result) {
        this.state.syncCounts.successful++;
        if (!this.options.dryRun) {
          this.logger.debug(`Traces: ${result}`);
        }
      } else {
        // Skip logging - no changes needed
      }
    } catch (error) {
      this.state.syncCounts.failed++;
      this.logger.error(`Auto-sync failed for ${sessionId}: ${error instanceof Error ? error.message : error}`);
    }

    this.logger.info('');
  }

  private setupShutdownHandlers(): void {
    const shutdown = async () => {
      this.logger.info('\nShutting down watcher...');
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  async stop(): Promise<void> {
    if (!this.state.isRunning) {
      return;
    }

    // Clear all pending debounce timers
    for (const timer of this.state.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.state.debounceTimers.clear();

    // Stop the file watcher
    if (this.state.watcher) {
      await this.state.watcher.close();
      this.state.watcher = null;
    }

    this.state.isRunning = false;

    // Print summary
    this.logger.info('Watch session summary:');
    this.logger.info(`  Total sync attempts: ${this.state.syncCounts.total}`);
    this.logger.info(`  Successful: ${this.state.syncCounts.successful}`);
    this.logger.info(`  Failed: ${this.state.syncCounts.failed}`);
    this.logger.info('Goodbye!');
  }

  private printDirectoryStatus(): void {
    try {
      const projectsPath = join(this.claudeDataDir, 'projects');
      const projectDirs = readdirSync(projectsPath);
      
      this.logger.info(`\nMonitoring ${projectDirs.length} Claude projects`);
      this.logger.info('Watching for new messages...\n');
      
      // Add a timer to check for changes every 10 seconds
      setInterval(() => {
        this.checkForRecentChanges();
      }, 10000);
    } catch (error) {
      this.logger.error(`Error checking directory status: ${error}`);
    }
  }

  private checkForRecentChanges(): void {
    try {
      const projectsPath = join(this.claudeDataDir, 'projects');
      const projectDirs = readdirSync(projectsPath);
      const now = Date.now();
      const thirtySecondsAgo = now - (30 * 1000);
      
      for (const projectDir of projectDirs) {
        const projectPath = join(projectsPath, projectDir);
        try {
          const files = readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));
          for (const file of files) {
            const filePath = join(projectPath, file);
            const stats = statSync(filePath);
            if (stats.mtime.getTime() > thirtySecondsAgo) {
              // Since chokidar isn't detecting changes, manually trigger sync
              const sessionId = this.extractSessionId(filePath);
              if (sessionId) {
                this.handleFileChange('changed', filePath);
              }
            }
          }
        } catch (err) {
          // Skip unreadable directories
        }
      }
    } catch (error) {
      this.logger.error(`Error checking for recent changes: ${error}`);
    }
  }

  getStats() {
    return {
      isRunning: this.state.isRunning,
      syncCounts: { ...this.state.syncCounts },
      pendingDebounces: this.state.debounceTimers.size
    };
  }
}

export async function startWatchMode(options: WatchOptions = {}): Promise<void> {
  const watcher = new SessionWatcher(options);
  await watcher.start();
  
  // Keep the process alive
  return new Promise(() => {
    // Process will exit via shutdown handlers
  });
}