import { createFileRoute } from "@tanstack/react-router";
import { Palette } from "lucide-react";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { SettingsShell, SettingsSection } from "@/components/settings/SettingsUI";
import { BrandingSettingsPanel } from "@/components/branding/BrandingSettingsPanel";

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
        title="Custom Branding"
        description="Give residents a home screen with your society's name, logo and colours. SociyoHub stays the platform name."
        scope="Whole society"
        icon={Palette}
      >
        <SettingsSection title="Society branding" icon={Palette} description="Changes apply only after you save, and the server checks your role and Premium plan every time.">
          <BrandingSettingsPanel />
        </SettingsSection>
      </SettingsShell>
    </FeatureGate>
  ),
});
