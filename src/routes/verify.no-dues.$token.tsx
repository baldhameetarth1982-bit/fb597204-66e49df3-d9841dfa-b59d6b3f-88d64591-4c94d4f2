import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ndDate } from "@/lib/no-dues-labels";

// The API sends fixed English; show it in the chosen language. Validity always comes from the server.
const REASON_KEY: Record<string, string> = { "Invalid or expired certificate": "nd.invalidExpired", "Too many requests. Please try again shortly.": "nd.tooMany" };
const STATUS_KEY: Record<string, string> = { active: "nd.vs.active", revoked: "nd.st.revoked", expired: "nd.vs.expired" };

export const Route = createFileRoute("/verify/no-dues/$token")({
  head: () => ({
    meta: [
      { title: "Verify No-Dues Certificate — SociyoHub" },
      { name: "description", content: "Verify the authenticity of a SociyoHub no-dues certificate." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: VerifyPage,
});

function VerifyPage() {
  const { t } = useTranslation();
  const { token } = Route.useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["verify-nd", token],
    queryFn: async () => {
      const res = await fetch(`/api/public/verify/no-dues/${token}`);
      return await res.json();
    },
  });

  return (
    <main className="min-h-screen grid place-items-center px-4 bg-background">
      <div className="w-full max-w-md rounded-2xl border p-6 shadow-sm bg-card">
        <h1 className="text-xl font-semibold mb-4">{t("nd.title")}</h1>
        {isLoading && <p className="text-sm text-muted-foreground">{t("nd.verifying")}</p>}
        {!isLoading && data && (
          <>
            <div
              className={
                "rounded-md px-3 py-2 mb-4 text-sm font-medium " +
                (data.valid
                  ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200"
                  : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200")
              }
            >
              {data.valid ? t("nd.valid") : data.reason ? (REASON_KEY[data.reason] ? t(REASON_KEY[data.reason]) : data.reason) : t("nd.notValid")}
            </div>
            {data.certificate_number && (
              <dl className="space-y-2 text-sm">
                <Row k={t("nd.certNoLbl")} v={data.certificate_number} />
                <Row k={t("nd.society")} v={data.society_name} />
                <Row k={t("nd.unit")} v={data.unit_label} />
                <Row
                  k={t("nd.issuedLbl")}
                  v={data.issued_at ? ndDate(data.issued_at) : "—"}
                />
                <Row
                  k={t("nd.validUntil")}
                  v={data.valid_until ? ndDate(data.valid_until) : "—"}
                />
                <Row k={t("common.status")} v={STATUS_KEY[data.status] ? t(STATUS_KEY[data.status]) : data.status} />
              </dl>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function Row({ k, v }: { k: string; v: any }) {
  return (
    <div className="flex justify-between border-b pb-1">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium text-end">{v ?? "—"}</dd>
    </div>
  );
}
