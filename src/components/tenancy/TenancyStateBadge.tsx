import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const LABELS: Record<string, { label: string; tone: string }> = {
  invited: { label: "Invited", tone: "bg-muted text-muted-foreground" },
  pending: { label: "Moving in", tone: "bg-muted text-muted-foreground" },
  active: { label: "Active", tone: "bg-primary/10 text-primary" },
  expiring: { label: "Expiring soon", tone: "bg-warning/15 text-warning-foreground" },
  terminating: { label: "Notice given", tone: "bg-warning/15 text-warning-foreground" },
  expired: { label: "Expired", tone: "bg-destructive/10 text-destructive" },
  terminated: { label: "Ended early", tone: "bg-destructive/10 text-destructive" },
  moved_out: { label: "Moved out", tone: "bg-muted text-muted-foreground" },
  archived: { label: "Archived", tone: "bg-muted text-muted-foreground" },
};

export function TenancyStateBadge({ state }: { state: string }) {
  const s = LABELS[state] ?? { label: state, tone: "bg-muted text-muted-foreground" };
  return <Badge variant="outline" className={cn("border-0 font-medium", s.tone)}>{s.label}</Badge>;
}
