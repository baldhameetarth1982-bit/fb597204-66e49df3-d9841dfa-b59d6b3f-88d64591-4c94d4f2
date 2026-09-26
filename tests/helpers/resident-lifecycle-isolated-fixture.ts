export type ResidentRelationship = {
  id: string;
  societyId: string;
  residentId: string;
  active: boolean;
  movedOutAt: string | null;
};

export type FamilyMember = { id: string; active: boolean };
export type Vehicle = { id: string; societyId: string; plate: string; active: boolean };

export function createResidentLifecycleFixture() {
  const relationships: ResidentRelationship[] = [];
  const family: FamilyMember[] = [];
  const vehicles: Vehicle[] = [];
  let sequence = 0;
  const id = (kind: string) => `${kind}-${++sequence}`;
  const normalizePlate = (plate: string) => plate.replace(/\s+/g, "").toUpperCase();

  return {
    relationships,
    family,
    vehicles,
    assign(societyId: string, residentId: string) {
      const row = { id: id("relationship"), societyId, residentId, active: true, movedOutAt: null };
      relationships.push(row);
      return row;
    },
    end(relationshipId: string) {
      const row = relationships.find((candidate) => candidate.id === relationshipId);
      if (!row) throw new Error("relationship_not_found");
      row.active = false;
      row.movedOutAt = "2026-09-26T00:00:00.000Z";
      return row;
    },
    addFamily() {
      const row = { id: id("family"), active: true };
      family.push(row);
      return row;
    },
    deactivateFamily(memberId: string) {
      const row = family.find((candidate) => candidate.id === memberId);
      if (!row) throw new Error("family_member_not_found");
      row.active = false;
      return row;
    },
    addVehicle(societyId: string, plate: string) {
      const normalized = normalizePlate(plate);
      if (vehicles.some((row) => row.societyId === societyId && row.active && row.plate === normalized)) {
        throw new Error("duplicate_active_plate");
      }
      const row = { id: id("vehicle"), societyId, plate: normalized, active: true };
      vehicles.push(row);
      return row;
    },
    deactivateVehicle(vehicleId: string) {
      const row = vehicles.find((candidate) => candidate.id === vehicleId);
      if (!row) throw new Error("vehicle_not_found");
      row.active = false;
      return row;
    },
    reactivateVehicle(vehicleId: string) {
      const row = vehicles.find((candidate) => candidate.id === vehicleId);
      if (!row) throw new Error("vehicle_not_found");
      if (vehicles.some((candidate) => candidate.id !== row.id && candidate.societyId === row.societyId && candidate.active && candidate.plate === row.plate)) {
        throw new Error("duplicate_active_plate");
      }
      row.active = true;
      return row;
    },
  };
}