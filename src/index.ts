#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DeribitClient } from "./deribit-client.js";
import { registerPublicTools } from "./tools/public.js";
import { registerPrivateTools } from "./tools/private.js";
import { registerWorkflowTools } from "./tools/workflow.js";

const server = new McpServer({
  name: "deribit-mcp",
  version: "1.0.0",
});

const client = new DeribitClient();

registerPublicTools(server, client);
registerPrivateTools(server, client);
registerWorkflowTools(server, client);

const transport = new StdioServerTransport();
await server.connect(transport);
