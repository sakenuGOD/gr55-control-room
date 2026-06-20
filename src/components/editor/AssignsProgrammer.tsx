import { Sliders } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import {
  ASSIGN_SLOTS,
  DEFAULT_ASSIGN_SLOT_MAPPINGS,
  findAssignSlotMapping,
  getAssignSlotMappingReadiness,
  listAssignTargets,
  listPhysicalAssignControls,
  stageAssignControlMapping,
  type AssignMode,
  type AssignSlotMapping,
  type AssignSlotNumber,
  type AssignSourceId,
  type AssignStageSuccess,
  type AssignTargetOption,
  type PhysicalAssignControl,
} from "../../lib/actions/assigns";

type AssignDraft = {
  sourceId: AssignSourceId;
  targetParameterId: string;
  min: number;
  max: number;
  mode: AssignMode;
};

type DraftsBySlot = Record<AssignSlotNumber, AssignDraft>;

export function AssignsProgrammer({
  slotMappings = DEFAULT_ASSIGN_SLOT_MAPPINGS,
  controls = listPhysicalAssignControls(),
  targets = listAssignTargets(),
  onStageMapping,
}: {
  slotMappings?: readonly AssignSlotMapping[];
  controls?: readonly PhysicalAssignControl[];
  targets?: readonly AssignTargetOption[];
  onStageMapping?: (result: AssignStageSuccess) => void;
}) {
  const targetById = useMemo(() => new Map(targets.map((target) => [target.id, target])), [targets]);
  const [drafts, setDrafts] = useState<DraftsBySlot>(() => createInitialDrafts(controls, targets));
  const [statusBySlot, setStatusBySlot] = useState<Partial<Record<AssignSlotNumber, string>>>({});

  const updateDraft = (slot: AssignSlotNumber, patch: Partial<AssignDraft>) => {
    setDrafts((current) => ({
      ...current,
      [slot]: {
        ...current[slot],
        ...patch,
      },
    }));
  };

  const updateTarget = (slot: AssignSlotNumber, targetParameterId: string) => {
    const nextTarget = targetById.get(targetParameterId);
    updateDraft(slot, {
      targetParameterId,
      min: nextTarget?.min ?? 0,
      max: nextTarget?.max ?? 127,
    });
  };

  const stageSlot = (slot: AssignSlotNumber, source: PhysicalAssignControl, target: AssignTargetOption, draft: AssignDraft) => {
    const mode = source.modes.length > 0 ? draft.mode : undefined;
    const result = stageAssignControlMapping({
      slot,
      sourceId: source.id,
      targetParameterId: target.id,
      min: draft.min,
      max: draft.max,
      mode,
      slotMappings,
    });

    if (result.ok) {
      onStageMapping?.(result);
      setStatusBySlot((current) => ({ ...current, [slot]: `${result.staged.length} writes staged` }));
      return;
    }

    setStatusBySlot((current) => ({ ...current, [slot]: result.reason }));
  };

  return (
    <section className="module-editor special-panel" aria-labelledby="assigns-programmer-title">
      <div className="module-header">
        <div>
          <span>Assigns 1-8</span>
          <h2 id="assigns-programmer-title">Assigns programmer</h2>
        </div>
      </div>

      <p className="mapping-note">
        Assign rows stage only registry-mapped source, target and range fields. Fixture-only assign bytes still need USER 73-3 hardware verification before they can be called verified.
      </p>

      <div className="parameter-grid compact">
        {ASSIGN_SLOTS.map((slot) => {
          const draft = drafts[slot];
          const source = controls.find((control) => control.id === draft.sourceId) ?? controls[0];
          const target = targetById.get(draft.targetParameterId) ?? targets[0];
          const mapping = findAssignSlotMapping(slot, slotMappings);
          const mode = source?.modes.length ? draft.mode : undefined;
          const readiness = getAssignSlotMappingReadiness({
            mapping,
            sourceId: source?.id,
            targetParameterId: target?.id,
            mode,
          });
          const canProgram = Boolean(source && target && readiness.ready);

          return (
            <article key={slot} className="parameter-control">
              <div className="parameter-header">
                <div>
                  <strong>Assign {slot}</strong>
                  <span className="parameter-note">
                    {canProgram && source && target
                      ? `${source.label} to ${target.displayName}`
                      : "Mapping needed before this assign can write to the GR-55"}
                  </span>
                </div>
                <output>{canProgram ? "fixture-only mapped" : "unmapped"}</output>
              </div>

              {canProgram && source && target ? (
                <AssignSlotForm
                  slot={slot}
                  controls={controls}
                  targets={targets}
                  source={source}
                  target={target}
                  draft={draft}
                  status={statusBySlot[slot]}
                  onSourceChange={(sourceId) => updateDraft(slot, { sourceId })}
                  onTargetChange={(targetParameterId) => updateTarget(slot, targetParameterId)}
                  onDraftChange={(patch) => updateDraft(slot, patch)}
                  onStage={() => stageSlot(slot, source, target, draft)}
                />
              ) : (
                <MappingNeededReadout
                  missing={target ? readiness.missing : ["mapped assign target"]}
                  status={statusBySlot[slot]}
                />
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function AssignSlotForm({
  slot,
  controls,
  targets,
  source,
  target,
  draft,
  status,
  onSourceChange,
  onTargetChange,
  onDraftChange,
  onStage,
}: {
  slot: AssignSlotNumber;
  controls: readonly PhysicalAssignControl[];
  targets: readonly AssignTargetOption[];
  source: PhysicalAssignControl;
  target: AssignTargetOption;
  draft: AssignDraft;
  status?: string;
  onSourceChange: (sourceId: AssignSourceId) => void;
  onTargetChange: (targetParameterId: string) => void;
  onDraftChange: (patch: Partial<AssignDraft>) => void;
  onStage: () => void;
}) {
  const sourceSelectId = `assign-${slot}-source`;
  const targetSelectId = `assign-${slot}-target`;
  const minInputId = `assign-${slot}-min`;
  const maxInputId = `assign-${slot}-max`;
  const modeSelectId = `assign-${slot}-mode`;

  return (
    <>
      <div className="parameter-input-cell" style={{ display: "grid", gap: 8 }}>
        <div className="intent-control-row" style={{ gridTemplateColumns: "minmax(98px, 0.55fr) minmax(160px, 1fr)" }}>
          <label className="intent-control-label" htmlFor={sourceSelectId}>Source</label>
          <select id={sourceSelectId} value={source.id} onChange={(event) => onSourceChange(event.target.value as AssignSourceId)}>
            {controls.map((control) => (
              <option key={control.id} value={control.id}>
                {control.label}
              </option>
            ))}
          </select>
        </div>

        <div className="intent-control-row" style={{ gridTemplateColumns: "minmax(98px, 0.55fr) minmax(160px, 1fr)" }}>
          <label className="intent-control-label" htmlFor={targetSelectId}>Target</label>
          <select id={targetSelectId} value={target.id} onChange={(event) => onTargetChange(event.target.value)}>
            {targets.map((option) => (
              <option key={option.id} value={option.id}>
                {option.displayName}
              </option>
            ))}
          </select>
        </div>

        <div className="intent-control-row" style={{ gridTemplateColumns: "minmax(98px, 0.55fr) minmax(160px, 1fr)" }}>
          <span className="intent-control-label">Range</span>
          <div className="intent-slider-row">
            <label htmlFor={minInputId} className="parameter-note">Min</label>
            <input
              id={minInputId}
              className="value-input"
              type="number"
              min={target.min}
              max={draft.max}
              step={target.step}
              value={draft.min}
              onChange={(event) => onDraftChange({ min: Number(event.target.value) })}
            />
            <label htmlFor={maxInputId} className="parameter-note">Max</label>
            <input
              id={maxInputId}
              className="value-input"
              type="number"
              min={draft.min}
              max={target.max}
              step={target.step}
              value={draft.max}
              onChange={(event) => onDraftChange({ max: Number(event.target.value) })}
            />
          </div>
        </div>

        {source.modes.length > 0 ? (
          <div className="intent-control-row" style={{ gridTemplateColumns: "minmax(98px, 0.55fr) minmax(160px, 1fr)" }}>
            <label className="intent-control-label" htmlFor={modeSelectId}>Mode</label>
            <select id={modeSelectId} value={draft.mode} onChange={(event) => onDraftChange({ mode: event.target.value as AssignMode })}>
              {source.modes.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <div className="parameter-context-cell">
        <p className="parameter-note">
          Target accepts {target.min}{target.unit ? ` ${target.unit}` : ""} to {target.max}{target.unit ? ` ${target.unit}` : ""}. Assign bytes are staged as fixture-only until hardware read/write verification passes.
        </p>
        <button type="button" className="toolbar-button primary" onClick={onStage}>
          <Sliders size={15} aria-hidden="true" />
          Stage mapping
        </button>
        {status ? <p className="parameter-note" role="status">{status}</p> : null}
      </div>
    </>
  );
}

function MappingNeededReadout({ missing, status }: { missing: readonly string[]; status?: string }) {
  return (
    <>
      <div className="parameter-input-cell">
        <strong>Mapping needed</strong>
        <p className="parameter-note">No MIDI or SysEx is staged for this row.</p>
      </div>
      <div className="parameter-context-cell">
        <details className="parameter-advanced">
          <summary>Missing mapping</summary>
          <dl>
            {missing.map((item) => (
              <div key={item}>
                <dt>Required</dt>
                <dd>{item}</dd>
              </div>
            ))}
          </dl>
        </details>
        {status ? <p className="parameter-note" role="status">{status}</p> : null}
      </div>
    </>
  );
}

function createInitialDrafts(
  controls: readonly PhysicalAssignControl[],
  targets: readonly AssignTargetOption[],
): DraftsBySlot {
  const firstSource = controls[0]?.id ?? "ctlPedal";
  const firstTarget = targets[0];
  const draft: AssignDraft = {
    sourceId: firstSource,
    targetParameterId: firstTarget?.id ?? "",
    min: firstTarget?.min ?? 0,
    max: firstTarget?.max ?? 127,
    mode: "toggle",
  };

  return Object.fromEntries(ASSIGN_SLOTS.map((slot) => [slot, { ...draft }])) as DraftsBySlot;
}
