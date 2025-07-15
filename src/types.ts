export interface ClaudeMessage {
  parentUuid: string | null;
  isSidechain: boolean;
  userType: string;
  cwd: string;
  sessionId: string;
  version: string;
  type: 'user' | 'assistant';
  message: {
    role: 'user' | 'assistant';
    content: string | any[];
    id?: string;
    model?: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
      service_tier: string;
    };
  };
  uuid: string;
  timestamp: string;
  requestId?: string;
  toolUseResult?: any;
}

export interface OpikTrace {
  id?: string;
  project_name?: string;
  name?: string;
  start_time: string;
  end_time?: string;
  input?: any;
  output?: any;
  metadata?: any;
  tags?: string[];
  error_info?: any;
  thread_id?: string;
}

export interface OpikConfig {
  base_url: string;
  api_key?: string;
  project_name?: string;
  workspace?: string;
  is_local?: boolean;
}

export interface SyncOptions {
  sessionId?: string;
  projectPath?: string;
  batchSize?: number;
  includeProjects?: string[];
  excludeProjects?: string[];
  force?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

export interface SessionInfo {
  sessionId: string;
  projectPath: string;
  description: string;
  timestamp: string;
  messageCount: number;
}