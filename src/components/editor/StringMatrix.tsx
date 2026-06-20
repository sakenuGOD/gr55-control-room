import { ArrowCounterClockwise, CopySimple, SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { type CSSProperties } from "react";
import { type ParameterDefinition } from "../../data/gr55Parameters";
import {
  buildStringMatrixModel,
  cellForString,
  copyStringRowToAll,
  muteStringRow,
  normalizeAllStringLevels,
  restoreStringRow,
  scaleStringLevelsByPercent,
  soloStringRow,
  STRING_NUMBERS,
  type StringMatrixActionResult,
  type StringMatrixCell as StringMatrixCellModel,
} from "../../lib/actions/stringMatrix";
import { toHex } from "../../lib/roland";

type ParameterValues = Record<string, number>;

const STRING_MATRIX_MODEL = buildStringMatrixModel();
const MATRIX_GRID_STYLE: CSSProperties = {
  gridTemplateColumns: `70px repeat(${STRING_MATRIX_MODEL.columns.length}, minmax(150px, 1fr)) 160px`,
  width: `${Math.max(680, 230 + STRING_MATRIX_MODEL.columns.length * 150)}px`,
};

export function StringMatrix({
  values,
  originalValues,
  onChange,
}: {
  values: ParameterValues;
  originalValues: ParameterValues;
  onChange: (param: ParameterDefinition, value: number, shouldSend?: boolean) => void;
}) {
  const applyAction = (result: StringMatrixActionResult) => {
    if (!result.safe) {
      return;
    }

    result.changes.forEach((change) => onChange(change.param, change.value));
  };

  const restoreAllRows = () => {
    STRING_NUMBERS.forEach((stringNumber) => applyAction(restoreStringRow(STRING_MATRIX_MODEL, stringNumber, originalValues)));
  };

  return (
    <section className="module-editor string-matrix-panel" aria-labelledby="string-matrix-title">
      <div className="module-header">
        <div>
          <span>Mapped string balance</span>
          <h2 id="string-matrix-title">String Matrix</h2>
          <p>Per-string level controls use only mapped temporary-patch registry parameters.</p>
        </div>
        <div className="matrix-batch-actions">
          <button type="button" onClick={() => applyAction(normalizeAllStringLevels(STRING_MATRIX_MODEL))}>Normalize all</button>
          <button type="button" onClick={() => applyAction(scaleStringLevelsByPercent(STRING_MATRIX_MODEL, values, 80))}>Scale 80%</button>
          <button type="button" onClick={() => applyAction(scaleStringLevelsByPercent(STRING_MATRIX_MODEL, values, 120))}>Scale 120%</button>
          <button type="button" onClick={restoreAllRows}>Restore all</button>
        </div>
      </div>

      <div className="string-matrix" role="table" aria-label="String level matrix">
        <div className="string-matrix-row string-matrix-head" role="row" style={MATRIX_GRID_STYLE}>
          <span role="columnheader">String</span>
          {STRING_MATRIX_MODEL.columns.map((column) => (
            <span key={column.key} role="columnheader" data-column-key={column.key} data-column-role={column.role}>
              {column.label}
            </span>
          ))}
          <span role="columnheader">Row actions</span>
        </div>
        {STRING_NUMBERS.map((stringNumber) => (
          <div className="string-matrix-row" role="row" key={stringNumber} data-string-number={stringNumber} style={MATRIX_GRID_STYLE}>
            <strong role="rowheader">{stringNumber}</strong>
            {STRING_MATRIX_MODEL.columns.map((column) => {
              const cell = cellForString(column, stringNumber);
              return cell ? (
                <StringCell
                  key={column.key}
                  cell={cell}
                  columnKey={column.key}
                  value={cell.param ? values[cell.param.id] ?? cell.param.defaultValue : undefined}
                  originalValue={cell.param ? originalValues[cell.param.id] ?? cell.param.defaultValue : undefined}
                  onChange={(param, value) => onChange(param, value)}
                />
              ) : null;
            })}
            <div className="string-row-actions">
              <button type="button" onClick={() => applyAction(muteStringRow(STRING_MATRIX_MODEL, stringNumber))} title={`Mute string ${stringNumber}`} aria-label={`Mute string ${stringNumber}`}>
                <SpeakerSlash size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => applyAction(soloStringRow(STRING_MATRIX_MODEL, stringNumber))}
                disabled={!STRING_MATRIX_MODEL.canSoloRows}
                title={STRING_MATRIX_MODEL.canSoloRows ? `Solo string ${stringNumber}` : "Solo requires all mapped level params"}
                aria-label={`Solo string ${stringNumber}`}
              >
                <SpeakerHigh size={15} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => applyAction(copyStringRowToAll(STRING_MATRIX_MODEL, stringNumber, values))} title={`Copy string ${stringNumber} to all`} aria-label={`Copy string ${stringNumber} to all`}>
                <CopySimple size={15} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => applyAction(restoreStringRow(STRING_MATRIX_MODEL, stringNumber, originalValues))} title={`Restore string ${stringNumber}`} aria-label={`Restore string ${stringNumber}`}>
                <ArrowCounterClockwise size={15} aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <details className="mapping-needed">
        <summary>Developer mapping needed</summary>
        <ul>
          {STRING_MATRIX_MODEL.mappingNeeded.map((item) => (
            <li key={item.key}>{item.label}: {item.reason}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function StringCell({
  cell,
  columnKey,
  value,
  originalValue,
  onChange,
}: {
  cell: StringMatrixCellModel;
  columnKey: string;
  value?: number;
  originalValue?: number;
  onChange: (param: ParameterDefinition, value: number) => void;
}) {
  if (!cell.param) {
    return (
      <div
        className="string-cell string-cell-missing"
        data-string-matrix-cell="mapping-needed"
        data-column-key={columnKey}
        data-string-number={cell.stringNumber}
        data-expected-param-id={cell.expectedParamId}
        title={`Mapping needed for ${cell.expectedParamId}`}
      >
        <span>Mapping needed</span>
      </div>
    );
  }

  const param = cell.param;
  const currentValue = value ?? param.defaultValue;
  const baselineValue = originalValue ?? param.defaultValue;
  const dirty = currentValue !== baselineValue;
  const address = toHex(param.address);
  const title = `${param.displayName}; Address ${address}; Hardware ${param.hardwareVerificationStatus}; ${dirty ? "Dirty" : "Clean"}`;

  return (
    <label
      className={`string-cell ${dirty ? "is-dirty" : ""}`}
      title={title}
      data-string-matrix-cell="mapped"
      data-column-key={columnKey}
      data-string-number={cell.stringNumber}
      data-param-id={param.id}
      data-dirty={dirty ? "true" : "false"}
      data-hardware-status={param.hardwareVerificationStatus}
      data-address={address}
    >
      <input
        type="range"
        min={param.min}
        max={param.max}
        step={param.step}
        value={currentValue}
        aria-label={param.displayName}
        onChange={(event) => onChange(param, Number(event.target.value))}
      />
      <output>{currentValue}{param.unit ?? ""}</output>
      {dirty ? <em>staged</em> : null}
    </label>
  );
}
