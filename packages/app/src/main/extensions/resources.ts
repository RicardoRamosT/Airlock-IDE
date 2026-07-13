// packages/app/src/main/extensions/resources.ts
// Pure selection for the extensions:resources IPC: which connected extensions
// should surface their resources into a sidebar section right now.
import type {
  ConnectedExtensionDescriptor,
  ExtPrefs,
} from "@airlock/agent-core";

// Connected extensions whose eye is on (pinned) and which are enabled.
export function eyeOnConnected(
  descriptors: ConnectedExtensionDescriptor[],
  prefs: ExtPrefs,
): ConnectedExtensionDescriptor[] {
  return descriptors.filter(
    (d) => prefs[d.id]?.enabled !== false && prefs[d.id]?.pinned === true,
  );
}
