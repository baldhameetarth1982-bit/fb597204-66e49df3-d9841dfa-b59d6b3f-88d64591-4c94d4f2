import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

export const Route = createFileRoute("/verify/no-dues/$token")({
  head: () => ({
    meta: [
      { title: "Verify No-Dues Certificate — SocioHub" },
      { name: "description", content: "Verify the authenticity of a SocioHub no-dues certificate." },
    ],
  }),
  component: VerifyPage,
});

function VerifyPage() {
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
        <h1 className="text-xl font-semibold mb-4">No-Dues Certificate</h1>
        {isLoading && <p className="text-sm text-muted-foreground">Verifying…</p>}
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
              {data.valid ? "Valid certificate" : (data.reason ?? "Not valid")}
            </div>
            {data.certificate_number && (
              <dl className="space-y-2 text-sm">
                <Row k="Certificate No." v={data.certificate_number} />
                <Row k="Society" v={data.society_name} />
                <Row k="Unit" v={data.unit_label} />
                <Row
                  k="Issued"
                  v={data.issued_at ? new Date(data.issued_at).toLocaleDateString() : "—"}
                />
                <Row
                  k="Valid Until"
                  v={data.valid_until ? new Date(data.valid_until).toLocaleDateString() : "—"}
                />
                <Row k="Status" v={data.status} />
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
      <dd className="font-medium">{v ?? "—"}</dd>
    </div>
  );
}
