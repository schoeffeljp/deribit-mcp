#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { DeribitClient } from "./deribit-client.js";
import { registerPublicTools } from "./tools/public.js";
import { registerPrivateTools } from "./tools/private.js";
import { registerWorkflowTools } from "./tools/workflow.js";
import { registerAnalyticsTools } from "./tools/analytics.js";
import { registerPrompts } from "./prompts.js";

function createMcpServer(client: DeribitClient): McpServer {
  const server = new McpServer({
    name: "deribit-mcp",
    version: "1.0.0",
  });

  registerPublicTools(server, client);
  registerPrivateTools(server, client);
  registerWorkflowTools(server, client);
  registerAnalyticsTools(server, client);
  registerPrompts(server);

  return server;
}

const transportMode = process.env.MCP_TRANSPORT ?? "stdio";

if (transportMode === "http") {
  const port = Number(process.env.PORT ?? 3000);
  const apiKey = process.env.MCP_API_KEY;
  const client = new DeribitClient();

  const httpServer = createServer(async (req, res) => {
    // CORS headers for browser-based clients
    res.setHeader("Access-Control-Allow-Origin", process.env.MCP_CORS_ORIGIN ?? "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, Authorization");
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Only serve /mcp endpoint
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    // API key auth (if configured)
    if (apiKey) {
      const authHeader = req.headers.authorization;
      if (authHeader !== `Bearer ${apiKey}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }

    // Stateless mode: new server + transport per request
    const server = createMcpServer(client);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);

    // Read request body
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const rawBody = Buffer.concat(chunks).toString();
    if (!rawBody) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Empty request body" }));
      return;
    }
    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    try {
      await transport.handleRequest(req, res, body);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        }));
      }
    }
  });

  httpServer.listen(port, () => {
    console.error(`Deribit MCP server listening on http://localhost:${port}/mcp`);
  });
} else {
  // Default: stdio transport for Claude Desktop / local clients
  const client = new DeribitClient();
  const server = createMcpServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
