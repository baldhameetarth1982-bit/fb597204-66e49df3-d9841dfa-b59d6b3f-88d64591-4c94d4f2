import { createFileRoute } from "@tanstack/react-router";
import { Palette } from "lucide-react";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { SettingsShell, SettingsSection } from "@/components/settings/SettingsUI";
import { BrandingSettingsPanel } from "@/components/branding/BrandingSettingsPanel";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_society/society/branding")({
  head: () => ({
    meta: [
      { title: "Custom Branding — SociyoHub" },
      { name: "description", content: "Set your society's display name, logo and colours for residents." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <FeatureGate feature="custom_branding">
      <SettingsShell
        title={tu("op.custom_branding")}
        description={tu("op.give_residents_a_home_screen")}
        scope="Whole society"
        icon={Palette}
      >
        <SettingsSection title={tu("op.society_branding")} icon={Palette} description={tu("op.changes_apply_only_after_you")}>
          <BrandingSettingsPanel />
        </SettingsSection>
      </SettingsShell>
    </FeatureGate>
  ),
});
