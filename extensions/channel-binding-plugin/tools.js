/**
 * Outbound tool: channel_send
 *
 * Sends a message to one or more channels explicitly.
 * Designed for agents to reply to bridged channels by target ID.
 *
 * Mechanism:
 *   The tool uses the plugin's api to register as a tool factory.
 *   When invoked, it stores the dispatch intent in run context.
 *   The message_sending hook (in inbound-bridge.js) intercepts
 *   outgoing messages and routes them to target sessions.
 */

/**
 * Build the channel_send tool.
 * Receives the plugin API to access runtime.subagent.
 */
export function buildChannelSendTool(api) {
  return {
    name: "channel_send",
    description:
      "Send a message to one or more channels explicitly. Use this to reply to bridged channels.",
    parameters: {
      type: "object",
      required: ["message", "targets"],
      properties: {
        message: {
          type: "string",
          description: "Message content to send",
        },
        targets: {
          type: "array",
          items: { type: "string" },
          description:
            'Array of channel IDs or handles to send to (e.g., ["discord:12345", "telegram:67890"])',
        },
        options: {
          type: "object",
          properties: {
            asUser: {
              type: "boolean",
              description: "Send as the user rather than the agent (if supported)",
            },
            threadId: {
              type: "string",
              description: "Optional thread ID to maintain conversation continuity",
            },
          },
          description: "Additional send options",
        },
      },
    },
    execute: async (_toolCallId, { message, targets, options }) => {
      if (!api) {
        return {
          summary: "Plugin not initialized — tool unavailable",
          details: [],
        };
      }

      const results = [];

      for (const target of targets) {
        try {
          // Dispatch to target session via subagent.run.
          // deliver=false means one-way injection (no reply routing).
          // The message will be intercepted by the outbound hook and
          // routed through the appropriate channel binding.
          await api.runtime.subagent.run({
            sessionKey: target,
            message,
            deliver: false,
          });
          results.push({ target, success: true });
        } catch (err) {
          results.push({
            target,
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const successful = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      return {
        summary: `Sent to ${successful} channel(s), ${failed} failed`,
        details: results,
      };
    },
  };
}
