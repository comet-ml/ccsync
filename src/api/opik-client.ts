import axios, { AxiosInstance, AxiosError } from 'axios';
import { OpikConfig, OpikTrace } from '../types';
import { createLogger } from '../utils/logger';

export interface OpikCreateTracesRequest {
  traces: OpikTrace[];
}

export interface OpikCreateTracesResponse {
  traces?: Array<{
    id: string;
    project_id?: string;
  }>;
  [key: string]: any; // Allow additional properties
}

export class OpikApiClient {
  private client: AxiosInstance;
  private config: OpikConfig;
  private logger: ReturnType<typeof createLogger>;

  constructor(config: OpikConfig) {
    this.config = config;
    this.logger = createLogger({ verbose: false });
    
    // Normalize the base URL - remove trailing /api/ if present since we'll add the full path
    let baseURL = config.base_url;
    if (baseURL.endsWith('/api/')) {
      baseURL = baseURL.slice(0, -5); // Remove '/api/'
    } else if (baseURL.endsWith('/api')) {
      baseURL = baseURL.slice(0, -4); // Remove '/api'
    }
    
    this.client = axios.create({
      baseURL: baseURL,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(config.api_key && { 'authorization': config.api_key }),
        ...(config.workspace && { 'Comet-Workspace': config.workspace })
      },
      timeout: 30000 // 30 second timeout
    });
    
    this.logger.debug(`Opik API client configured with base URL: ${baseURL}`);
  }

  async createTraces(traces: OpikTrace[]): Promise<OpikCreateTracesResponse> {
    // Don't call API if there are no traces to create
    if (traces.length === 0) {
      return { traces: [] };
    }
    
    const request: OpikCreateTracesRequest = { traces };
    
    try {
      this.logger.debug(`Sending ${traces.length} traces to Opik at ${this.config.base_url}`);
      
      const response = await this.client.post<OpikCreateTracesResponse>(
        '/api/v1/private/traces/batch',
        request
      );

      this.logger.debug(`Status Code: ${response.status}`);
      this.logger.debug(`API Response:`, response.data);
      this.logger.debug(`Successfully created ${response.data?.traces?.length || 'unknown number of'} traces`);
      return response.data;
    } catch (error) {
      if (error instanceof AxiosError) {
        // If workspace doesn't exist, try with "default"
        if (error.response?.status === 403 && 
            error.response?.data?.message?.includes('Workspace') &&
            this.config.workspace !== 'default') {
          
          this.logger.warning(`Workspace '${this.config.workspace}' not found, trying 'default'`);
          
          // Create a new client with default workspace
          const defaultClient = axios.create({
            ...this.client.defaults,
            headers: {
              ...this.client.defaults.headers,
              'Comet-Workspace': 'default'
            }
          });
          
          try {
            const response = await defaultClient.post<OpikCreateTracesResponse>(
              '/api/v1/private/traces/batch',
              request
            );
            this.logger.debug(`Fallback Status Code: ${response.status}`);
            this.logger.debug(`Fallback API Response:`, response.data);
            this.logger.debug(`Successfully created ${response.data?.traces?.length || 'unknown number of'} traces in default workspace`);
            return response.data;
          } catch (fallbackError) {
            this.logger.error(`Fallback to default workspace also failed`);
          }
        }
        
        this.logger.debug(`Request details:`, {
          url: error.config?.url,
          method: error.config?.method,
          baseURL: error.config?.baseURL,
          headers: error.config?.headers
        });
        
        const status = error.response?.status || 'no response';
        const statusText = error.response?.statusText || 'unknown error';
        const errorMsg = `Failed to create traces: ${status} ${statusText}`;
        const errorDetails = error.response?.data ? JSON.stringify(error.response.data, null, 2) : error.message;
        throw new Error(`${errorMsg}\nDetails: ${errorDetails}`);
      }
      throw new Error(`Unexpected error creating traces: ${error instanceof Error ? error.message : error}`);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      // Test with empty traces array to validate connection
      await this.client.post('/api/v1/private/traces/batch', { traces: [] });
      this.logger.debug(`Successfully connected to Opik at ${this.config.base_url}`);
      return true;
    } catch (error) {
      if (error instanceof AxiosError) {
        this.logger.error(`Failed to connect to Opik: ${error.response?.status} ${error.response?.statusText}`);
        if (error.response?.data) {
          this.logger.debug('Response details:', JSON.stringify(error.response.data, null, 2));
        }
      } else {
        this.logger.error(`Unexpected connection error: ${error instanceof Error ? error.message : error}`);
      }
      return false;
    }
  }

  async createSingleTrace(trace: OpikTrace): Promise<string> {
    const response = await this.createTraces([trace]);
    if (!response.traces || response.traces.length === 0) {
      throw new Error('No trace ID returned from API');
    }
    return response.traces[0].id;
  }

  async updateTrace(traceId: string, trace: Partial<OpikTrace>): Promise<void> {
    try {
      this.logger.debug(`Updating trace ${traceId} in Opik`);
      
      const response = await this.client.patch<void>(
        `/api/v1/private/traces/${traceId}`,
        trace
      );

      this.logger.debug(`Update Status Code: ${response.status}`);
      this.logger.debug(`Successfully updated trace ${traceId}`);
    } catch (error) {
      if (error instanceof AxiosError) {
        this.logger.debug(`Update request details:`, {
          url: error.config?.url,
          method: error.config?.method,
          baseURL: error.config?.baseURL,
          headers: error.config?.headers
        });
        
        const status = error.response?.status || 'no response';
        const statusText = error.response?.statusText || 'unknown error';
        const errorMsg = `Failed to update trace ${traceId}: ${status} ${statusText}`;
        const errorDetails = error.response?.data ? JSON.stringify(error.response.data, null, 2) : error.message;
        throw new Error(`${errorMsg}\nDetails: ${errorDetails}`);
      }
      throw new Error(`Unexpected error updating trace ${traceId}: ${error instanceof Error ? error.message : error}`);
    }
  }

  async updateThreadTags(threadId: string, tags: string[]): Promise<void> {
    try {
      // First, get the thread_model_id by searching for the thread
      const searchEndpoint = `/api/v1/private/traces/threads`;
      const searchParams = new URLSearchParams({
        project_name: 'Claude Code',
        filters: JSON.stringify([{
          id: 'thread_id_filter',
          field: 'id',
          type: 'string',
          operator: 'contains',
          key: '',
          value: threadId
        }]),
        sorting: JSON.stringify([{
          field: 'last_updated_at',
          direction: 'DESC'
        }]),
        size: '1',
        page: '1',
        truncate: 'true'
      });

      const searchResponse = await this.client.get(`${searchEndpoint}?${searchParams}`);
      
      if (!searchResponse.data?.content?.[0]?.thread_model_id) {
        throw new Error(`Thread ${threadId} not found or no thread_model_id available`);
      }

      const threadModelId = searchResponse.data.content[0].thread_model_id;

      // Now update the thread tags using the thread_model_id
      const updateEndpoint = `/api/v1/private/traces/threads/${threadModelId}`;
      const payload = { tags };
      
      await this.client.patch<void>(updateEndpoint, payload);
    } catch (error) {
      if (error instanceof AxiosError) {
        this.logger.error(`Thread tags update request details: ${JSON.stringify({
          url: error.config?.url,
          method: error.config?.method,
          baseURL: error.config?.baseURL,
          headers: error.config?.headers,
          data: error.config?.data
        })}`);
        
        const status = error.response?.status || 'no response';
        const statusText = error.response?.statusText || 'unknown error';
        const errorMsg = `Failed to update thread ${threadId} tags: ${status} ${statusText}`;
        const errorDetails = error.response?.data ? JSON.stringify(error.response.data, null, 2) : error.message;
        throw new Error(`${errorMsg}\nDetails: ${errorDetails}`);
      }
      throw new Error(`Unexpected error updating thread ${threadId} tags: ${error instanceof Error ? error.message : error}`);
    }
  }

  getConfig(): OpikConfig {
    return { ...this.config };
  }
}

export function createOpikClient(config: OpikConfig): OpikApiClient {
  return new OpikApiClient(config);
}
