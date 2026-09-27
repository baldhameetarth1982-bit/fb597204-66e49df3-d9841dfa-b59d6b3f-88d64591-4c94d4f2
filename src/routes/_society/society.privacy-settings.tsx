import { createFileRoute } from "@tanstack/react-router";
import { EyeOff } from "lucide-react";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { SettingsShell, SettingsSection } from "@/components/settings/SettingsUI";
import { PrivacySettingsPanel } from "@/components/settings/PrivacySettingsPanel";

export const Route = createFileRoute("/_society/society/privacy-settings")({
  head: () => ({
    meta: [
      { title: "Privacy & Transparency — SociyoHub" },
      { name: "description", content: "Choose what residents can see about each other and the society's finances." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <FeatureGate feature="privacy_controls">
      <SettingsShell
        title="Privacy & Transparency"
        description="Choose what residents can see about each other and about the society's money. Society Admins can always see everything."
        scope="Whole society"
        icon={EyeOff}
      >
        <SettingsSection
          title="Resident privacy"
          icon={EyeOff}
          description="These rules are checked by the server every time someone opens a page, so hidden details stay hidden everywhere in the app."
        >
          <PrivacySettingsPanel />
        </SettingsSection>
      </SettingsShell>
    </FeatureGate>
  ),
});
