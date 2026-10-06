import { createFileRoute } from "@tanstack/react-router";
import { EyeOff } from "lucide-react";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { SettingsShell, SettingsSection } from "@/components/settings/SettingsUI";
import { PrivacySettingsPanel } from "@/components/settings/PrivacySettingsPanel";
import { tu } from "@/lib/i18n";

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
        title={tu("op.privacy_transparency")}
        description={tu("op.choose_what_residents_can_see")}
        scope="Whole society"
        icon={EyeOff}
      >
        <SettingsSection
          title={tu("op.resident_privacy")}
          icon={EyeOff}
          description={tu("op.these_rules_are_checked_by")}
        >
          <PrivacySettingsPanel />
        </SettingsSection>
      </SettingsShell>
    </FeatureGate>
  ),
});
