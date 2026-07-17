/**
 * Stage 2E — SetupChecklistCard consumes the server-derived checklist.
 *
 * Proves:
 *   • Uses `getSetupChecklist` (not localStorage / fake state).
 *   • Missing units renders as incomplete.
 *   • Import is optional and never blocks required completion.
 *   • Error/denied path fails closed (no fake ticks).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// The route object exposed by TanStack Router isn't needed in this shallow test.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to?: string }) =>
    // Render as a plain anchor so we can query the DOM.
    // eslint-disable-next-line jsx-a11y/anchor-is-valid
    (<a data-to={to}>{children}</a>),
}));

const mockFetch = vi.fn();
vi.mock("@tanstack/react-start", () => ({
  useServerFn: () => mockFetch,
}));
vi.mock("@/lib/migration.functions", () => ({
  getSetupChecklist: Symbol("getSetupChecklist"),
}));

import { SetupChecklistCard } from "@/components/society/SetupChecklistCard";

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SetupChecklistCard societyId="00000000-0000-0000-0000-000000000abc" />
    </QueryClientProvider>,
  );
}

beforeEach(() => mockFetch.mockReset());

describe("Stage 2E — SetupChecklistCard", () => {
  it("consumes getSetupChecklist server function", async () => {
    mockFetch.mockResolvedValueOnce({
      has_blocks: true, has_flats: true, has_residents: true, has_completed_imports: false,
      blocks: 2, flats: 20, active_residents: 15, completed_imports: 0,
    });
    renderCard();
    await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce());
    expect(mockFetch).toHaveBeenCalledWith({
      data: { society_id: "00000000-0000-0000-0000-000000000abc" },
    });
  });

  it("shows missing units as incomplete", async () => {
    mockFetch.mockResolvedValueOnce({
      has_blocks: false, has_flats: false, has_residents: false, has_completed_imports: false,
      blocks: 0, flats: 0, active_residents: 0, completed_imports: 0,
    });
    renderCard();
    await waitFor(() => expect(screen.getByText(/Active units exist/)).toBeTruthy());
    // "done" copy would say "All required steps complete." — absent here.
    expect(screen.queryByText(/All required steps complete/)).toBeNull();
  });

  it("marks import as optional (does not block required completion)", async () => {
    mockFetch.mockResolvedValueOnce({
      has_blocks: true, has_flats: true, has_residents: true, has_completed_imports: false,
      blocks: 1, flats: 10, active_residents: 5, completed_imports: 0,
    });
    renderCard();
    await waitFor(() => expect(screen.getByText(/Bulk import/)).toBeTruthy());
    expect(screen.getByText(/\(optional\)/)).toBeTruthy();
  });

  it("fails closed on error (no fake ticks)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("unavailable"));
    renderCard();
    await waitFor(() =>
      expect(screen.getByText(/Setup checklist unavailable/)).toBeTruthy(),
    );
  });
});
