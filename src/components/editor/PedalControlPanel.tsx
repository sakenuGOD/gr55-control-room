import {
  listPhysicalAssignControls,
  type AssignSourceId,
  type PhysicalAssignControl,
} from "../../lib/actions/assigns";

type PedalControlValues = Partial<Record<AssignSourceId, number>>;

export function PedalControlPanel({
  controls = listPhysicalAssignControls(),
  values = {},
  onControlChange,
}: {
  controls?: readonly PhysicalAssignControl[];
  values?: PedalControlValues;
  onControlChange?: (control: PhysicalAssignControl, value: number) => void;
}) {
  return (
    <section className="module-editor special-panel" aria-labelledby="pedal-control-panel-title">
      <div className="module-header">
        <div>
          <span>Physical controls</span>
          <h2 id="pedal-control-panel-title">Pedal and GK controls</h2>
        </div>
      </div>

      <p className="mapping-note">
        Sendable controls are limited to existing confirmed CC mappings. Other pedal and GK sources stay read-only until registry write mapping exists.
      </p>

      <div
        className="performance-panel"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
      >
        {controls.map((control) => (
          <PedalControlTile
            key={control.id}
            control={control}
            value={values[control.id]}
            onControlChange={onControlChange}
          />
        ))}
      </div>
    </section>
  );
}

function PedalControlTile({
  control,
  value,
  onControlChange,
}: {
  control: PhysicalAssignControl;
  value?: number;
  onControlChange?: (control: PhysicalAssignControl, value: number) => void;
}) {
  const current = normalizeControlValue(control, value ?? (control.kind === "continuous" ? control.min : 0));
  const canSend = control.controller !== undefined && Boolean(onControlChange);

  if (canSend && control.kind === "switch") {
    const checked = current > 0;
    return (
      <button
        type="button"
        className={`performance-toggle ${checked ? "is-on" : ""}`}
        onClick={() => onControlChange?.(control, checked ? 0 : control.max)}
        aria-pressed={checked}
      >
        <span>{control.label}</span>
        <strong>{checked ? "ON" : "OFF"}</strong>
        <small>{control.controller !== undefined ? `CC ${control.controller}` : "Mapping needed"}</small>
      </button>
    );
  }

  if (canSend && control.kind === "continuous") {
    return (
      <div className="performance-slider">
        <label htmlFor={`pedal-control-${control.id}`}>{control.label}</label>
        <input
          id={`pedal-control-${control.id}`}
          type="range"
          min={control.min}
          max={control.max}
          value={current}
          onChange={(event) => onControlChange?.(control, Number(event.target.value))}
        />
        <input
          type="number"
          min={control.min}
          max={control.max}
          value={current}
          aria-label={`${control.label} value`}
          onChange={(event) => onControlChange?.(control, Number(event.target.value))}
        />
        <small>CC {control.controller}</small>
      </div>
    );
  }

  return (
    <article className="performance-slider" aria-label={control.label}>
      <strong>{control.label}</strong>
      <span>{control.kind === "switch" ? "Switch source" : "Continuous source"}</span>
      <small>{control.controller !== undefined ? `CC ${control.controller}` : "Mapping needed"}</small>
      <small>{control.modes.length > 0 ? `Modes: ${control.modes.join(", ")}` : "No mode selector"}</small>
      <small>{control.detail}</small>
    </article>
  );
}

function normalizeControlValue(control: PhysicalAssignControl, value: number) {
  const safe = Number.isFinite(value) ? value : control.min;
  return Math.min(Math.max(Math.round(safe), control.min), control.max);
}
