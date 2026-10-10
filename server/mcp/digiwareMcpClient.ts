/**
 * DigiWare AI Gateway - MCP (Model Context Protocol) Client
 * Direct connection to https://digiwareinformatique.com/wp-json/digiware/v2/mcp
 */

export interface McpCallResult<T = any> {
  jsonrpc: string;
  id: number | string;
  result?: {
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: T;
    isError?: boolean;
    [key: string]: any;
  };
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class DigiwareMcpClient {
  private endpointUrl: string;
  private token: string;
  private nextId = 1;

  constructor(
    endpointUrl = process.env.DIGIWARE_MCP_URL || 'https://digiwareinformatique.com/wp-json/digiware/v2/mcp',
    token = process.env.DIGIWARE_MCP_TOKEN || 'dwg_tok_hNDtESKUDeiY_zdiF4joSgm1zVwc7ntsUzEUCyzM8IgKdoO7ab8rcBhQblEtO'
  ) {
    this.endpointUrl = endpointUrl;
    this.token = token;
  }

  public async rpcCall(method: string, params: any = {}): Promise<any> {
    const id = this.nextId++;
    const res = await fetch(this.endpointUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        params,
        id
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`MCP Gateway HTTP ${res.status}: ${errText}`);
    }

    const data: McpCallResult = await res.json();
    if (data.error) {
      throw new Error(`MCP Error [${data.error.code}]: ${data.error.message}`);
    }

    return data.result;
  }

  public async callTool(toolName: string, args: Record<string, any> = {}): Promise<any> {
    // Security Guard: Prevent destructive site reset or database deletion
    const DANGEROUS_TOOLS = [
      'site_reset', 'db_structure', 'db_search_replace',
      'themes_delete', 'users_delete'
    ];

    if (DANGEROUS_TOOLS.includes(toolName)) {
      throw new Error(`[SECURITY GUARD] L'action '${toolName}' est désactivée par sécurité.`);
    }

    const res = await this.rpcCall('tools/call', {
      name: toolName,
      arguments: args
    });

    if (res?.structuredContent !== undefined) {
      return res.structuredContent;
    }

    if (res?.content && Array.isArray(res.content) && res.content[0]?.text) {
      try {
        return JSON.parse(res.content[0].text);
      } catch {
        return res.content[0].text;
      }
    }

    return res;
  }

  public async listTools(): Promise<any[]> {
    const res = await this.rpcCall('tools/list', {});
    return res?.tools || [];
  }

  public async getSiteInfo(): Promise<any> {
    return this.callTool('site_info', {});
  }

  public async getWooStatus(): Promise<any> {
    return this.callTool('woo_status', {});
  }

  public async getWooCustomers(limit = 50): Promise<any> {
    return this.callTool('woo_customers', { limit });
  }

  public async getWooOrders(limit = 20, status?: string): Promise<any> {
    const args: any = { limit };
    if (status) args.status = status;
    return this.callTool('woo_orders', args);
  }

  public async readFile(filePath: string): Promise<any> {
    return this.callTool('files_read', { path: filePath });
  }

  public async writeFile(filePath: string, content: string, note = 'Mise à jour via DigiWare Studio'): Promise<any> {
    return this.callTool('files_write', {
      path: filePath,
      content,
      note
    });
  }

  public async deployExtensionFile(subPath: string, content: string, note?: string): Promise<any> {
    const targetPath = subPath.startsWith('plugins/') || subPath.startsWith('wp-content/')
      ? subPath
      : `plugins/whatsapp/${subPath.replace(/^\//, '')}`;
    return this.writeFile(targetPath, content, note || `Mise à jour automatique extension WhatsApp: ${subPath}`);
  }
}

export const digiwareMcp = new DigiwareMcpClient();
