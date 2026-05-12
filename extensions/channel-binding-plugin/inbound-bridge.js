/**
 * Inbound & outbound bridging:
 *
 * INBOUND (message_received):
 *   Discord guild message → hook intercepts → match binding →
 *     subagent.run(targetSessionKey, message, deliver=true) →
 *     target agent responds → reply routed back to Discord
 *
 * OUTBOUND (message_sending):
 *   Agent calls channel_send → hook intercepts → match binding →
 *     subagent.run(targetSessionKey, message, deliver=false) →
 *     message injected into target session's context
 */

const activityMap = new Map();

/**
 * Extract channel ID from the context's channelId string.
 * Format: "discord:1466895086234243144" or just "1466895086234243144"
 */
function extractChannelId(channelContext) {
  if (!channelContext) return null;
  const parts = channelContext.split(":");
  return parts.length > 1 ? parts[1] : parts[0];
}

/**
 * Check if content contains a bot mention (for mention-only mode).
 */
function containsBotMention(content, botUserId) {
  if (!content || !botUserId) return false;
  return content.includes(`<@${botUserId}>`) || content.includes(`<@!${botUserId}>`);
}

/**
 * Decide if the message should be forwarded based on binding mode.
 */
function shouldForward(content, mode, botUserId) {
  if (mode === "broadcast") return true;
  return containsBotMention(content, botUserId);
}

/**
 * INBOUND HOOK: Create the message_received handler.
 *
 * When a message arrives on a bridged channel, forward it to the target agent
 * session via subagent.run. The agent's reply will be automatically routed
 * back to the originating channel because deliver=true.
 */
export function createMessageReceivedHook(api, getBindings) {
  const runtime = api.runtime;
  const pluginLogger = api.logger;

  return async (event, ctx) => {
    const bindings = getBindings();
    if (!bindings || bindings.length === 0) return;

    // Get the channel ID from the context
    const ctxChannelId = ctx.channelId ? extractChannelId(ctx.channelId) : null;
    if (!ctxChannelId) return;

    for (const binding of bindings) {
      if (binding.status !== "active") continue;
      if (binding.channelId !== ctxChannelId) continue;

      // Check mention gating
      if (!shouldForward(event.content, binding.mode, binding.botUserId)) continue;

      try {
        // Track activity
        activityMap.set(binding.targetSessionKey, Date.now());

        // Build the forwarded message with bridging context
        const prefix = `[Bridged from ${event.from} (${ctxChannelId})]`;
        const forwardedContent = `${prefix}\n${event.content}`;

        // Forward to target session via subagent.run
        // deliver=true ensures the agent's reply routes back to the
        // originating channel automatically
        await runtime.subagent.run({
          sessionKey: binding.targetSessionKey,
          message: forwardedContent,
          deliver: true,
          extraSystemPrompt:
            "You are receiving a message bridged from another channel. Respond naturally — the reply will be delivered back to the originating channel. Do not mention this is a bridged message.",
        });

        pluginLogger.info(
          `[channel-bridge] Forwarded ${event.from}:${ctxChannelId} -> ${binding.targetSessionKey}`,
        );
      } catch (err) {
        pluginLogger.error(
          `[channel-bridge] Error forwarding to ${binding.targetSessionKey}: ${err.message}`,
        );
      }
    }
  };
}

/**
 * OUTBOUND HOOK: Create the message_sending handler.
 *
 * When an agent sends a message (via channel_send tool result or direct reply),
 * intercept and route it to the target session if the target channel matches.
 *
 * The hook receives PluginHookMessageSendingEvent with:
 *   { to, content, replyToId, threadId, metadata }
 *
 * And returns PluginHookMessageSendingResult with:
 *   { content, cancel? }
 */
export function createMessageSendingHook(api, getBindings) {
  const runtime = api.runtime;
  const pluginLogger = api.logger;

  return async (event, ctx) => {
    const bindings = getBindings();
    if (!bindings || bindings.length === 0) return;

    // The 'to' field is the target channel/address
    const toChannelId = event.to
      ? extractChannelId(event.to)
      : extractChannelId(event.metadata?.channelId);
    if (!toChannelId) return;

    for (const binding of bindings) {
      if (binding.status !== "active") continue;
      if (binding.channelId !== toChannelId) continue;

      // Found a matching binding — inject into target session
      try {
        await runtime.subagent.run({
          sessionKey: binding.targetSessionKey,
          message: event.content,
          deliver: false, // One-way inject, no reply routing needed
        });

        pluginLogger.info(`[channel-bridge] Outbound: ${event.to} -> ${binding.targetSessionKey}`);

        // Cancel the original send since we've injected into target
        return { cancel: true };
      } catch (err) {
        pluginLogger.error(
          `[channel-bridge] Error outbound dispatch to ${binding.targetSessionKey}: ${err.message}`,
        );
      }
    }
  };
}

/**
 * Get current activity timestamps (for debugging/monitoring).
 */
export function getActivityMap() {
  return new Map(activityMap);
}
