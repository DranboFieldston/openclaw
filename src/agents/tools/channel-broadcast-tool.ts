import { Type } from "typebox";
import { getRuntimeConfig } from "../../config/config.js";
import { resolveSessionStoreEntry } from "../../config/sessions/store-entry.js";
import { callGateway } from "../../gateway/call.js";
import { resolveProxyBindingFromStoreOrConfig } from "../../gateway/session-utils.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";
import { resolveMainSessionAlias } from "./sessions-helpers.js";

const ChannelBroadcastToolSchema = Type.Object({
  /** Target channel session key (e.g. "agent:dranbo:discord:channel:123456") or channelId (e.g. "discord:channel:123456"). */
  channelKey: Type.String(),
  /** Message text to send to the channel. */
  message: Type.String(),
});

/**
 * channel_broadcast tool — allows an agent to intentionally send a message to a
 * bridged channel, rather than having replies auto-redirected by updateLastRoute.
 *
 * Flow:
 * 1. Resolve the proxy binding for the target channelKey
 * 2. Extract delivery context (to, channel, accountId) from the proxy binding
 * 3. Call gateway "send" to deliver the message to the Discord channel
 * 4. Mirror the sent message back into the agent's main session transcript
 */
export function createChannelBroadcastTool(opts?: {
  agentSessionKey?: string;
  agentChannel?: string;
}): AnyAgentTool {
  return {
    label: "Channel Broadcast",
    name: "channel_broadcast",
    description:
      "Send a message to a bridged Discord channel. Use this when you want to intentionally respond to a channel message, rather than waiting for auto-redirected replies. The channelKey can be a session key (e.g. 'agent:dranbo:discord:channel:123') or just the channel identifier.",
    parameters: ChannelBroadcastToolSchema,
    execute: async (toolCallId, params) => {
      const args = params as Record<string, unknown>;
      const channelKey = readStringParam(args, "channelKey", { required: true });
      const message = readStringParam(args, "message", { required: true });

      if (!message.trim()) {
        return jsonResult({
          runId: toolCallId,
          status: "error",
          error: "Message text is required",
        });
      }

      // Get config and resolve session alias
      const cfg = getRuntimeConfig();
      const { mainKey, alias } = resolveMainSessionAlias(cfg);

      // Load the session store
      const { loadSessionStore } = await import("../../config/sessions/store-load.js");
      const store = loadSessionStore(alias);

      // Resolve proxy binding for the target channel
      // Try as session key first, then as channelId
      const binding = resolveProxyBindingFromStoreOrConfig(cfg, store, channelKey);

      if (!binding) {
        // Fallback: try to parse as a plain channel identifier
        // For Discord: "discord:channel:123456" or just "123456"
        const channelId = channelKey.startsWith("discord:channel:")
          ? channelKey
          : channelKey.includes(":")
            ? channelKey
            : `discord:channel:${channelKey}`;

        const bindingFromConfig = resolveProxyBindingFromStoreOrConfig(cfg, store, channelId);
        if (!bindingFromConfig) {
          return jsonResult({
            runId: toolCallId,
            status: "error",
            error: `No proxy binding found for channel: ${channelKey}. Ensure the channel is configured in session.channelBridge.proxies.`,
          });
        }

        // Use the binding to get delivery context
        const targetEntry = await resolveSessionStoreEntry(store, binding.targetSessionKey);
        if (!targetEntry) {
          return jsonResult({
            runId: toolCallId,
            status: "error",
            error: `Proxy binding target session not found: ${binding.targetSessionKey}`,
          });
        }

        // Deliver via gateway send
        const deliverTarget = {
          to: targetEntry.lastTo ?? targetEntry.sessionId ?? channelId,
          channel: "discord",
          accountId: targetEntry.lastAccountId ?? "default",
          threadId: targetEntry.lastThreadId,
        };

        try {
          const result = await callGateway({
            method: "send",
            params: {
              to: deliverTarget.to,
              message,
              channel: deliverTarget.channel,
              accountId: deliverTarget.accountId,
              threadId: deliverTarget.threadId,
              idempotencyKey: `broadcast-${Date.now()}`,
            },
            timeoutMs: 30_000,
          });

          return jsonResult({
            runId: toolCallId,
            status: "ok",
            delivered: true,
            channel: deliverTarget.channel,
            target: deliverTarget.to,
            messageId: (result as any)?.messageId ?? "unknown",
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          return jsonResult({
            runId: toolCallId,
            status: "error",
            error: `Failed to send message: ${errMsg}`,
          });
        }
      }

      // We have a binding — use it to get delivery context
      const targetEntry = await resolveSessionStoreEntry(store, binding.targetSessionKey);
      if (!targetEntry) {
        return jsonResult({
          runId: toolCallId,
          status: "error",
          error: `Proxy binding target session not found: ${binding.targetSessionKey}`,
        });
      }

      // Extract delivery context from the target session's last route
      // (populated when the proxy session received its last message)
      const deliverTarget = {
        to: targetEntry.lastTo ?? targetEntry.sessionId ?? channelKey,
        channel: "discord",
        accountId: targetEntry.lastAccountId ?? "default",
        threadId: targetEntry.lastThreadId,
      };

      try {
        const result = await callGateway({
          method: "send",
          params: {
            to: deliverTarget.to,
            message,
            channel: deliverTarget.channel,
            accountId: deliverTarget.accountId,
            threadId: deliverTarget.threadId,
            idempotencyKey: `broadcast-${Date.now()}`,
          },
          timeoutMs: 30_000,
        });

        return jsonResult({
          runId: toolCallId,
          status: "ok",
          delivered: true,
          channel: deliverTarget.channel,
          target: deliverTarget.to,
          messageId: (result as any)?.messageId ?? "unknown",
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return jsonResult({
          runId: toolCallId,
          status: "error",
          error: `Failed to send message: ${errMsg}`,
        });
      }
    },
  };
}
