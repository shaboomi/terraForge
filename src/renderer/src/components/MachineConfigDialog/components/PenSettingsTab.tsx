import { useState } from "react";
import { CalibrationDialog } from "../../CalibrationDialog";
import { PenLibrarySettings } from "./PenLibrarySettings";
import { Button } from "../../ui";
import { useMachineStore } from "../../../store/machineStore";

export function PenSettingsTab() {
  const [calibrating, setCalibrating] = useState(false);
  const machine = useMachineStore(s => s.configs.find(c => c.id === s.activeConfigId));
  return <div className="flex-1 overflow-y-auto p-6 space-y-6">
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Pen calibration</h2>
      <p className="text-sm text-content-muted">Create speed, brush depth, lift clearance, timing, geometry, repeatability and hatching test sheets for the active machine: {machine?.name ?? "none selected"}.</p>
      <p className="text-xs text-content-muted">Save machine changes before calibrating. Record successful measurements in your pen library below.</p>
      <Button disabled={!machine} onClick={() => setCalibrating(true)}>Create calibration sheet</Button>
    </section>
    <PenLibrarySettings />
    {calibrating && <CalibrationDialog onClose={() => setCalibrating(false)} />}
  </div>;
}
