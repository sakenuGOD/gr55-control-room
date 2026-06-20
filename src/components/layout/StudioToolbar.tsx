import {
  Command,
  DownloadSimple,
  FloppyDisk,
  Keyboard,
  MagnifyingGlass,
  PaperPlaneTilt,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { UserPatch } from "../../data/gr55PatchMap";

export type CommandPaletteCommand = {
  id: string;
  label: string;
  detail: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  onRun: () => void;
};

export type StudioToolbarProps = {
  status: string;
  outputName: string;
  selectedPatch: UserPatch;
  patchName: string;
  slotSelectionConfirmed: boolean;
  dirtyCount: number;
  patchLoaded: boolean;
  operationState: "idle" | "sending" | "saved" | "error";
  liveWrite: boolean;
  commandPaletteOpen: boolean;
  onCommandPaletteOpenChange: (open: boolean) => void;
  commands: CommandPaletteCommand[];
  onReadPatch: () => void;
  onSendChanges: () => void;
  onSavePatch: () => void;
  onLiveWriteChange: (value: boolean) => void;
  onFocusSearch: () => void;
};

export function StudioToolbar({
  status,
  outputName,
  selectedPatch,
  patchName,
  slotSelectionConfirmed,
  dirtyCount,
  patchLoaded,
  operationState,
  liveWrite,
  commandPaletteOpen,
  onCommandPaletteOpenChange,
  commands,
  onReadPatch,
  onSendChanges,
  onSavePatch,
  onLiveWriteChange,
  onFocusSearch,
}: StudioToolbarProps) {
  const isReady = status === "ready";
  const canSend = patchLoaded && dirtyCount > 0;
  const slotLabel = slotSelectionConfirmed ? `USER ${selectedPatch.label}` : "No USER slot";
  const nameLabel = patchName ? ` - ${patchName}` : "";

  return (
    <>
      <header className="studio-toolbar">
        <div className="studio-status" role="status" aria-live="polite">
          <span className={`connection-dot status-${status}`} aria-hidden="true" />
          <strong>{isReady ? "GR-55 ready" : "GR-55 offline"}</strong>
          <span>{outputName || "No route"}</span>
        </div>

        <button type="button" className="studio-slot" onClick={onFocusSearch}>
          <Keyboard size={17} aria-hidden="true" />
          <span>
            <strong>{slotLabel}{nameLabel}</strong>
            <small>{dirtyCount ? `${dirtyCount} staged` : patchLoaded ? "mapped values loaded" : "read required"}</small>
          </span>
        </button>

        <div className="studio-actions" aria-label="Primary patch actions">
          <button type="button" onClick={onReadPatch} disabled={!slotSelectionConfirmed}>
            <DownloadSimple size={17} aria-hidden="true" />
            Read
          </button>
          <button type="button" onClick={onSendChanges} disabled={!canSend}>
            <PaperPlaneTilt size={17} aria-hidden="true" />
            Send Staged
          </button>
          <button type="button" className="primary" onClick={onSavePatch} disabled={!canSend}>
            <FloppyDisk size={17} aria-hidden="true" />
            Save
          </button>
        </div>

        <div className="studio-mode" role="group" aria-label="Preview mode">
          <span>Mode</span>
          <button type="button" className={!liveWrite ? "is-active" : ""} aria-pressed={!liveWrite} onClick={() => onLiveWriteChange(false)}>
            Staged
          </button>
          <button type="button" className={liveWrite ? "is-active" : ""} aria-pressed={liveWrite} onClick={() => onLiveWriteChange(true)}>
            Live
          </button>
        </div>

        {operationState !== "idle" ? (
          <span className={`operation-chip state-${operationState}`}>
            {operationState === "sending" ? "Sending" : operationState === "saved" ? "Saved" : "Failed"}
          </span>
        ) : null}

        <button type="button" className="command-trigger" onClick={() => onCommandPaletteOpenChange(true)}>
          <Command size={18} aria-hidden="true" />
          <span>Commands</span>
          <kbd>Cmd/Ctrl+K</kbd>
        </button>
      </header>

      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={onCommandPaletteOpenChange}
        commands={commands}
      />
    </>
  );
}

export function CommandPalette({
  open,
  onOpenChange,
  commands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: CommandPaletteCommand[];
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const visibleCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? commands.filter((command) => `${command.label} ${command.detail}`.toLowerCase().includes(normalized))
      : commands;
  }, [commands, query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) {
    return null;
  }

  const runCommand = (command: CommandPaletteCommand) => {
    if (command.disabled) {
      return;
    }
    command.onRun();
    onOpenChange(false);
  };

  return (
    <div className="command-palette-backdrop" role="presentation" onMouseDown={() => onOpenChange(false)}>
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onOpenChange(false);
          }
        }}
      >
        <div className="command-palette-head">
          <h2 id="command-palette-title">Command palette</h2>
          <button type="button" aria-label="Close command palette" onClick={() => onOpenChange(false)}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <label className="command-search">
          <MagnifyingGlass size={17} aria-hidden="true" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search commands"
          />
        </label>
        <div className="command-list" role="listbox" aria-label="Available commands">
          {visibleCommands.map((command) => (
            <button
              key={command.id}
              type="button"
              className={command.danger ? "is-danger" : ""}
              disabled={command.disabled}
              onClick={() => runCommand(command)}
              role="option"
            >
              <span>
                <strong>{command.label}</strong>
                <small>{command.detail}</small>
              </span>
              {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
            </button>
          ))}
          {!visibleCommands.length ? <p>No matching commands.</p> : null}
        </div>
      </section>
    </div>
  );
}
