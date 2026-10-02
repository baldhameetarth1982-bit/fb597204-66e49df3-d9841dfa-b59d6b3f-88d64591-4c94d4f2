import { PeopleAreaNav, ListSkeleton, LoadError } from "@/components/people/PeopleUI";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus } from "lucide-react";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSocietyId } from "@/hooks/useSocietyId";
import { gateErrorMessage } from "@/lib/visitors";
import { CapacityPanel, EvTab, ReportsTab, SlotsTab, TemporaryTab, useParkingData, ViolationsTab } from "@/features/parking/ParkingAdmin";

export const Route = createFileRoute("/_society/society/parking")({
  head: () => ({
    meta: [
      { title: "Parking — SociyoHub" },
      { name: "description", content: "Assign, release and reallocate parking, issue temporary slots, track violations, EV charging and parking reports." },
    ],
  }),
  component: () => (<FeatureGate feature="vehicles"><ParkingPage /></FeatureGate>),
});

function ParkingPage() {
  const { societyId } = useSocietyId();
  const data = useParkingData(societyId);
  const [tab, setTab] = useState("slots");
  const [addTick, setAddTick] = useState(0);

  return (
    <PageShell>
      <PeopleAreaNav />
      <PageHeader
        title="Parking"
        description="Slots, who holds them, temporary use, violations, EV charging and reports."
        actions={<Button className="min-h-11 rounded-xl" onClick={() => { setTab("slots"); setAddTick((t) => t + 1); }}><Plus className="mr-2 h-4 w-4" />Add slot</Button>}
      />
      <CapacityPanel d={data.data} />
      {data.isLoading || !societyId ? <ListSkeleton rows={4} /> : data.isError ? (
        <LoadError title={gateErrorMessage(data.error)} onRetry={() => void data.refetch()} />
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4 w-full justify-start overflow-x-auto">
            <TabsTrigger value="slots" className="min-h-10">Slots</TabsTrigger>
            <TabsTrigger value="temporary" className="min-h-10">Temporary</TabsTrigger>
            <TabsTrigger value="violations" className="min-h-10">Violations</TabsTrigger>
            <TabsTrigger value="ev" className="min-h-10">EV charging</TabsTrigger>
            <TabsTrigger value="reports" className="min-h-10">Reports</TabsTrigger>
          </TabsList>
          <TabsContent value="slots"><SlotsTab d={data.data!} onAdd={addTick} /></TabsContent>
          <TabsContent value="temporary"><TemporaryTab d={data.data!} /></TabsContent>
          <TabsContent value="violations"><ViolationsTab d={data.data!} societyId={societyId} /></TabsContent>
          <TabsContent value="ev"><EvTab d={data.data!} societyId={societyId} /></TabsContent>
          <TabsContent value="reports"><ReportsTab d={data.data!} /></TabsContent>
        </Tabs>
      )}
    </PageShell>
  );
}
