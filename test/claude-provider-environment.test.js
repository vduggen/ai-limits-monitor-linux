import assert from "node:assert/strict";
import test from "node:test";

import { register } from "tsx/esm/api";

register();

const claudeProvider = await import("../src/providers/claude.ts");

test("the default Claude profile uses the CLI's default authentication context", () => {
  const environment = claudeProvider.createClaudeEnvironment?.(
    "/home/test/.claude",
    {
      PATH: "/usr/bin",
      OTHER_SETTING: "preserved",
      CLAUDE_CONFIG_DIR: "/home/test/.claude-old-profile",
    },
    "/home/test",
  );

  assert.deepEqual(environment, {
    PATH: "/usr/bin",
    OTHER_SETTING: "preserved",
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    CLAUDE_CODE_AUTO_CONNECT_IDE: "0",
    CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: "1",
  });
});

test("additional Claude profiles keep their explicit authentication context", () => {
  const environment = claudeProvider.createClaudeEnvironment?.(
    "/home/test/.claude-work",
    {
      PATH: "/usr/bin",
      CLAUDE_CONFIG_DIR: "/home/test/.claude-old-profile",
    },
    "/home/test",
  );

  assert.deepEqual(environment, {
    PATH: "/usr/bin",
    CLAUDE_CONFIG_DIR: "/home/test/.claude-work",
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    CLAUDE_CODE_AUTO_CONNECT_IDE: "0",
    CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: "1",
  });
});
