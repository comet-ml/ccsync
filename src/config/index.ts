import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { OpikConfig } from '../types';
import { createLogger } from '../utils/logger';

interface OpikConfigFile {
  api_key?: string;
  url_override?: string;
  workspace?: string;
  project_name?: string;
  is_local?: boolean;
}

function parseOpikConfigFile(content: string): OpikConfigFile {
  const config: OpikConfigFile = {};
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) {
      continue;
    }
    
    // Parse key = value pairs
    const match = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      const cleanValue = value.trim();
      
      switch (key) {
        case 'api_key':
          config.api_key = cleanValue;
          break;
        case 'url_override':
          config.url_override = cleanValue;
          break;
        case 'workspace':
          config.workspace = cleanValue;
          break;
        case 'project_name':
          config.project_name = cleanValue;
          break;
        case 'is_local':
          config.is_local = cleanValue.toLowerCase() === 'true';
          break;
      }
    }
  }
  
  return config;
}

export function getOpikConfig(): OpikConfig {
  const logger = createLogger({ verbose: false });
  
  // Try environment variables first
  const apiKey = process.env.OPIK_API_KEY;
  const baseUrl = process.env.OPIK_BASE_URL || 'http://localhost:5173';
  const projectName = process.env.OPIK_PROJECT_NAME;
  const workspace = process.env.OPIK_WORKSPACE;
  const isLocal = process.env.OPIK_IS_LOCAL?.toLowerCase() === 'true';

  if (apiKey || isLocal) {
    return {
      api_key: apiKey,
      base_url: baseUrl,
      project_name: projectName || 'Claude Code',
      workspace: workspace || 'default',
      is_local: isLocal
    };
  }

  // Try ~/.opik.config file
  try {
    const configPath = join(homedir(), '.opik.config');
    logger.debug(`Reading Opik config from: ${configPath}`);
    const configFile = readFileSync(configPath, 'utf8');
    const config = parseOpikConfigFile(configFile);
    logger.debug(`Parsed config:`, config);
    
    if (!config.api_key && !config.is_local) {
      throw new Error('No API key found in config file (required for cloud instance)');
    }

    const finalConfig = {
      api_key: config.api_key,
      base_url: config.url_override || baseUrl,
      project_name: config.project_name || 'Claude Code',
      workspace: config.workspace || 'default',
      is_local: config.is_local || false
    };
    
    logger.debug(`Using Opik config:`, { 
      ...finalConfig, 
      api_key: finalConfig.api_key ? '***configured***' : 'not set' 
    });
    
    return finalConfig;
  } catch (error) {
    logger.error(`Config error: ${error instanceof Error ? error.message : error}`);
    throw new Error(
      'No Opik configuration found. Please set OPIK_API_KEY environment variable or create ~/.opik.config file'
    );
  }
}

export function getClaudeDataDir(): string {
  return process.env.CLAUDE_DATA_DIR || join(homedir(), '.claude');
}