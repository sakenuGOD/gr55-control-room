import { ArrowCounterClockwise, CopySimple, SpeakerSlash } from "@phosphor-icons/react";
import { PARAMETERS_BY_ID, type ParameterDefinition } from "../../data/gr55Parameters";

type ParameterValues = Record<string, number>;

const STRING_LEVEL_IDS = {
  pcm1: (stringNumber: number) => `pcm1String${stringNumber}Level`,
  pcm2: (stringNumber: number) => `pcm2String${stringNumber}Level`,
  modeling: (stringNumber: number) => `modelingString${stringNumber}Level`,
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
  const paramsForRow = (stringNumber: number) =>
    [
      PARAMETERS_BY_ID.get(STRING_LEVEL_IDS.pcm1(stringNumber)),
      PARAMETERS_BY_ID.get(STRING_LEVEL_IDS.pcm2(stringNumber)),
      PARAMETERS_BY_ID.get(STRING_LEVEL_IDS.modeling(stringNumber)),
    ].filter((param): param is ParameterDefinition => Boolean(param));

  const setRow = (stringNumber: number, value: number) => {
    paramsForRow(stringNumber).forEach((param) => onChange(param, value));
  };

  const resetRow = (stringNumber: number) => {
    paramsForRow(stringNumber).forEach((param) => onChange(param, originalValues[param.id] ?? param.defaultValue));
  };

  const copyRowToAll = (stringNumber: number) => {
    const row = paramsForRow(stringNumber);
    for (let targetString = 1; targetString <= 6; targetString += 1) {
      const target = paramsForRow(targetString);
      target.forEach((param, index) => onChange(param, values[row[index]?.id ?? ""] ?? row[index]?.defaultValue ?? param.defaultValue));
    }
  };

  const normalizeLevels = () => {
    for (let stringNumber = 1; stringNumber <= 6; stringNumber += 1) {
      paramsForRow(stringNumber).forEach((param) => onChange(param, 100));
    }
  };

  const restoreOriginal = () => {
    for (let stringNumber = 1; stringNumber <= 6; stringNumber += 1) {
      resetRow(stringNumber);
    }
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
          <button type="button" onClick={normalizeLevels}>Normalize levels</button>
          <button type="button" onClick={restoreOriginal}>Restore original</button>
        </div>
      </div>

      <div className="string-matrix" role="table" aria-label="String level matrix">
        <div className="string-matrix-row string-matrix-head" role="row">
          <span role="columnheader">String</span>
          <span role="columnheader">PCM1 Level</span>
          <span role="columnheader">PCM2 Level</span>
          <span role="columnheader">Modeling Level</span>
          <span role="columnheader">Row actions</span>
        </div>
        {Array.from({ length: 6 }, (_, index) => index + 1).map((stringNumber) => (
          <div className="string-matrix-row" role="row" key={stringNumber}>
            <strong role="rowheader">{stringNumber}</strong>
            {paramsForRow(stringNumber).map((param) => (
              <StringCell
                key={param.id}
                param={param}
                value={values[param.id] ?? param.defaultValue}
                originalValue={originalValues[param.id] ?? param.defaultValue}
                onChange={(value) => onChange(param, value)}
              />
            ))}
            <div className="string-row-actions">
              <button type="button" onClick={() => setRow(stringNumber, 0)} title={`Mute string ${stringNumber}`} aria-label={`Mute string ${stringNumber}`}>
                <SpeakerSlash size={15} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => copyRowToAll(stringNumber)} title={`Copy string ${stringNumber} to all`} aria-label={`Copy string ${stringNumber} to all`}>
                <CopySimple size={15} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => resetRow(stringNumber)} title={`Reset string ${stringNumber}`} aria-label={`Reset string ${stringNumber}`}>
                <ArrowCounterClockwise size={15} aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <details className="mapping-needed">
        <summary>Developer mapping needed</summary>
        <ul>
          <li>Per-string PCM tuning/pitch fields are not in the verified registry.</li>
          <li>Per-string modeling pitch/fine fields are not in the verified registry.</li>
          <li>Per-string source enable/routing fields are not in the verified registry.</li>
        </ul>
      </details>
    </section>
  );
}

function StringCell({
  param,
  value,
  originalValue,
  onChange,
}: {
  param: ParameterDefinition;
  value: number;
  originalValue: number;
  onChange: (value: number) => void;
}) {
  const dirty = value !== originalValue;
  return (
    <label className={`string-cell ${dirty ? "is-dirty" : ""}`}>
      <input
        type="range"
        min={param.min}
        max={param.max}
        step={param.step}
        value={value}
        aria-label={param.displayName}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>{value}{param.unit ?? ""}</output>
      {dirty ? <em>staged</em> : null}
    </label>
  );
}
