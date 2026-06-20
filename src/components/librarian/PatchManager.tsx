import { ListMagnifyingGlass, MagnifyingGlass } from "@phosphor-icons/react";
import { useState, type RefObject } from "react";
import { USER_PATCHES, type UserPatch } from "../../data/gr55PatchMap";

type PatchSlotState = "unread" | "reading" | "loaded" | "dirty" | "saved" | "error";

export type PatchSlotRecord = {
  status: PatchSlotState;
  name?: string;
  error?: string;
};

export function PatchManager({
  searchRef,
  selectedPatch,
  slotSelectionConfirmed,
  patchLoaded,
  readStatus,
  dirtyCount,
  patchName,
  patchNameDirty,
  patchSlots,
  onSelectPatch,
  onReadPatch,
  onSavePatch,
  onClearSelectedPatch,
  onExportMappedPatch,
  onOpenImport,
}: {
  searchRef: RefObject<HTMLInputElement | null>;
  selectedPatch: UserPatch;
  slotSelectionConfirmed: boolean;
  patchLoaded: boolean;
  readStatus: string;
  dirtyCount: number;
  patchName: string;
  patchNameDirty: boolean;
  patchSlots: Record<number, PatchSlotRecord>;
  onSelectPatch: (patch: UserPatch) => void;
  onReadPatch: () => void;
  onSavePatch: () => void;
  onClearSelectedPatch: () => void;
  onExportMappedPatch: () => void;
  onOpenImport: () => void;
}) {
  const [query, setQuery] = useState("");
  const [bankFilter, setBankFilter] = useState("all");
  const normalizedQuery = query.trim().toLowerCase();
  const visible = USER_PATCHES.filter((patch) => {
    const inBank = bankFilter === "all" || patch.bank === Number(bankFilter);
    if (!inBank) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    const cachedName = patchSlots[patch.userIndex]?.name ?? "";
    return `USER ${patch.label} ${cachedName}`.toLowerCase().includes(normalizedQuery);
  });

  return (
    <section className="sidebar-section patch-manager" aria-labelledby="patch-manager-title">
      <div className="section-header">
        <h2 id="patch-manager-title">Patch Manager</h2>
        <span className="section-header-aside"><ListMagnifyingGlass size={16} aria-hidden="true" /></span>
      </div>

      <div className="search-field">
        <MagnifyingGlass size={15} aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search USER patches"
          aria-label="Search patches"
        />
      </div>

      <div className={`library-current ${dirtyCount ? "is-dirty" : ""} ${patchLoaded ? "is-loaded" : "is-unread"}`}>
        <span>{slotSelectionConfirmed ? "Selected USER slot" : "No USER slot selected"}</span>
        <strong>
          {slotSelectionConfirmed ? `USER ${selectedPatch.label}${patchName ? ` - ${patchName}` : ""}` : "Choose a slot below"}
          {slotSelectionConfirmed && dirtyCount ? <em>{dirtyCount} staged</em> : null}
        </strong>
        <small>
          {slotSelectionConfirmed
            ? patchLoaded
              ? patchNameDirty
                ? "Patch name rename is staged."
                : "Mapped values are loaded."
              : "Selection only. Patch contents have not been read."
            : "Select before read, export, import, save, or clear."}
        </small>
        <small>{readStatus}</small>
      </div>

      <div className="librarian-actions">
        <button type="button" className="primary" onClick={onReadPatch} disabled={!slotSelectionConfirmed}>
          {patchLoaded ? "Read again" : "Read selected"}
        </button>
        <button type="button" onClick={onExportMappedPatch} disabled={!slotSelectionConfirmed || !patchLoaded}>Export mapped</button>
        <button type="button" onClick={onOpenImport}>Import</button>
        <details className="patch-manager-more">
          <summary>More</summary>
          <div>
            <button type="button" onClick={onSavePatch} disabled={!patchLoaded || !dirtyCount}>Save selected</button>
            <button type="button" className="danger" onClick={onClearSelectedPatch} disabled={!slotSelectionConfirmed}>Clear selected</button>
          </div>
        </details>
      </div>

      <label className="field">
        <span>Bank filter</span>
        <select value={bankFilter} onChange={(event) => setBankFilter(event.target.value)}>
          <option value="all">All USER banks</option>
          {Array.from({ length: 99 }, (_, index) => index + 1).map((bank) => (
            <option key={bank} value={bank}>
              USER {bank.toString().padStart(2, "0")}
            </option>
          ))}
        </select>
      </label>

      <div className="patch-list" role="listbox" aria-label="GR-55 USER patches">
        {visible.length === 0 ? (
          <p className="empty-state">No matching USER patches.</p>
        ) : (
          visible.map((patch) => {
            const slot = patchSlots[patch.userIndex];
            const selected = slotSelectionConfirmed && patch.userIndex === selectedPatch.userIndex;
            const state = selected && dirtyCount ? "dirty" : slot?.status ?? (selected && !patchLoaded ? "reading" : "unread");
            const name = selected && patchName ? patchName : slot?.name;
            return (
              <button
                type="button"
                key={patch.userIndex}
                className={`${selected ? "is-selected" : ""} ${state === "dirty" ? "is-dirty" : ""} ${
                  state === "saved" ? "is-saved" : state === "error" ? "is-error" : ""
                }`}
                onClick={() => onSelectPatch(patch)}
                role="option"
                aria-selected={selected}
              >
                <span>
                  USER {patch.label}
                  {name ? <strong>{name}</strong> : null}
                  <em>{state}</em>
                </span>
                <small>PC {patch.program}</small>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
