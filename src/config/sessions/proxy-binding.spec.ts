import { describe, expect, it } from "vitest";
import { classifySessionKey, resolveProxyBinding } from "../../gateway/session-utils.js";
import { normalizeStoreSessionKey, resolveSessionStoreEntry } from "./store-entry.js";

describe("Proxy Binding Logic", () => {
  const mockStore = {
    "agent:proxy-bot:discord:channel:123": {
      updatedAt: 1000,
      proxyBinding: {
        proxySessionKey: "agent:proxy-bot:discord:channel:123",
        channelId: "discord:123",
        targetSessionKey: "agent:main-bot:discord:channel:123",
        ownerAgentId: "main-bot",
        mode: "broadcast",
        status: "active",
        includeOwnMessages: true,
        createdAt: 0,
      },
    },
  };

  it("identifies proxy sessions from session key pattern", () => {
    expect(classifySessionKey("agent:discord::proxy:123")).toBe("proxy");
  });

  it("identifies proxy sessions from store metadata", () => {
    // using unknown key but the entry has a proxyBinding attached
    expect(
      classifySessionKey("unknown-key", mockStore["agent:proxy-bot:discord:channel:123"]),
    ).toBe("proxy");
  });

  it("resolves active proxy binding", () => {
    const binding = resolveProxyBinding(mockStore as any, "agent:proxy-bot:discord:channel:123");
    expect(binding).toBeTruthy();
    expect(binding?.targetSessionKey).toBe("agent:main-bot:discord:channel:123");
  });

  it("returns null for inactive or missing proxy binding", () => {
    const inactiveStore = {
      "agent:proxy-bot": {
        proxyBinding: { status: "paused" },
      },
    };
    expect(resolveProxyBinding(inactiveStore as any, "agent:proxy-bot")).toBeNull();
    expect(resolveProxyBinding({} as any, "agent:missing")).toBeNull();
  });
});
