import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createMessageReceivedHook, createMessageSendingHook } from "./inbound-bridge.js";
import { buildChannelSendTool } from "./tools.js";

// In-memory proxy bindings (set from plugin config on load)
let proxyBindings = [];

/**
 * Validate plugin config shape.
 * Minimal schema — accept anything with a proxyBindings array.
 */
function validateConfig(config) {
  if (!config || !Array.isArray(config.proxyBindings)) {
    return { ok: false, errors: ["proxyBindings must be an array"] };
  }
  for (const binding of config.proxyBindings) {
    if (!binding.channelId) {
      return {
        ok: false,
        errors: [`Missing channelId in binding: ${JSON.stringify(binding)}`],
      };
    }
    if (!binding.targetSessionKey) {
      return {
        ok: false,
        errors: [`Missing targetSessionKey in binding: ${JSON.stringify(binding)}`],
      };
    }
  }
  return { ok: true, value: config };
}

export const ChannelAdapterPlugin = definePluginEntry({
  id: "channel-binding",
  name: "channel-adapter",
  description: "Explicit channel routing via channel_send tool and inbound bridging",
  configSchema: {
    safeParse: (value) => validateConfig(value),
  },
  register(api) {
    // Register the outbound channel_send tool
    api.registerTool(buildChannelSendTool(api), { optional: true });

    // Apply config from plugin config block
    if (api.pluginConfig) {
      proxyBindings = Array.isArray(api.pluginConfig.proxyBindings)
        ? api.pluginConfig.proxyBindings
        : [];
      api.logger.info(
        `[channel-bridge] Loaded ${proxyBindings.length} proxy binding(s) from config`,
      );
    }

    // Create a getter for bindings (called by hooks at runtime)
    const getBindings = () => proxyBindings;

    // Register the inbound message_received hook
    const inboundHook = createMessageReceivedHook(api, getBindings);
    api.registerHook("message_received", inboundHook, {
      source: "channel-bridge",
    });

    // Register the outbound message_sending hook
    const outboundHook = createMessageSendingHook(api, getBindings);
    api.registerHook("message_sending", outboundHook, {
      source: "channel-bridge-outbound",
    });
  },
});

export default ChannelAdapterPlugin;
