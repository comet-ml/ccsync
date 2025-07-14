export interface LoggerConfig {
  verbose?: boolean;
  dryRun?: boolean;
}

export class Logger {
  private config: LoggerConfig;
  
  constructor(config: LoggerConfig = {}) {
    this.config = config;
  }

  info(message: string): void {
    console.log(message);
  }

  success(message: string): void {
    console.log(`✅ ${message}`);
  }

  warning(message: string): void {
    console.log(`⚠️  ${message}`);
  }

  error(message: string): void {
    console.error(`❌ ${message}`);
  }

  debug(message: string, data?: any): void {
    if (this.config.verbose) {
      if (data !== undefined) {
        console.log(`🔍 ${message}`, data);
      } else {
        console.log(`🔍 ${message}`);
      }
    }
  }

  dryRun(message: string): void {
    if (this.config.dryRun) {
      console.log(`🔍 [DRY RUN] ${message}`);
    }
  }

  progress(message: string): void {
    console.log(`🔄 ${message}`);
  }

  skip(message: string): void {
    console.log(`⏭️  ${message}`);
  }

  syncSummary(sessionId: string, syncReason: string, createCount: number, updateCount: number, totalTraces: number): void {
    // Show short session ID (first 35 chars)
    const shortSessionId = sessionId.substring(0, 35);
    console.log(`Syncing session: ${shortSessionId}`);
    console.log(`✅ Synced ${totalTraces} conversation${totalTraces === 1 ? '' : 's'} to Opik (${createCount} new, ${updateCount} updated)`);
  }
}

export const createLogger = (config: LoggerConfig = {}): Logger => {
  return new Logger(config);
};