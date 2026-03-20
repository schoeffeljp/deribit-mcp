/**
 * Deribit API v2 JSON-RPC client with automatic authentication.
 */

const MAINNET_URL = "https://www.deribit.com/api/v2";
const TESTNET_URL = "https://test.deribit.com/api/v2";

interface AuthToken {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

export class DeribitClient {
  private baseUrl: string;
  private clientId: string | undefined;
  private clientSecret: string | undefined;
  private token: AuthToken | null = null;
  private requestId = 0;

  constructor() {
    const useTestnet = process.env.DERIBIT_TESTNET === "true";
    this.baseUrl = useTestnet ? TESTNET_URL : MAINNET_URL;
    this.clientId = process.env.DERIBIT_CLIENT_ID;
    this.clientSecret = process.env.DERIBIT_CLIENT_SECRET;
  }

  private nextId(): number {
    return ++this.requestId;
  }

  /**
   * Authenticate and obtain an access token.
   */
  private async authenticate(): Promise<void> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        "DERIBIT_CLIENT_ID and DERIBIT_CLIENT_SECRET environment variables are required for private endpoints"
      );
    }

    const result = await this.callPublic("public/auth", {
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    this.token = {
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      expires_at: Date.now() + result.expires_in * 1000 - 30_000, // 30s buffer
    };
  }

  /**
   * Get a valid access token, refreshing if necessary.
   */
  private async getAccessToken(): Promise<string> {
    if (!this.token || Date.now() >= this.token.expires_at) {
      await this.authenticate();
    }
    return this.token!.access_token;
  }

  /**
   * Low-level JSON-RPC call (no auth header).
   */
  async callPublic(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const body = {
      jsonrpc: "2.0",
      id: this.nextId(),
      method,
      params,
    };

    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const json = await response.json() as any;

    if (json.error) {
      throw new Error(`Deribit API error [${json.error.code}]: ${json.error.message}`);
    }

    return json.result;
  }

  /**
   * Authenticated JSON-RPC call.
   */
  async callPrivate(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const accessToken = await this.getAccessToken();

    const body = {
      jsonrpc: "2.0",
      id: this.nextId(),
      method,
      params,
    };

    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    const json = await response.json() as any;

    if (json.error) {
      throw new Error(`Deribit API error [${json.error.code}]: ${json.error.message}`);
    }

    return json.result;
  }
}
