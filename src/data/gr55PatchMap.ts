export type UserPatch = {
  bank: number;
  slot: 1 | 2 | 3;
  label: string;
  bankMsb: number;
  program: number;
  userIndex: number;
};

export function buildUserPatchMap(): UserPatch[] {
  const patches: UserPatch[] = [];

  for (let userIndex = 0; userIndex < 297; userIndex += 1) {
    const bank = Math.floor(userIndex / 3) + 1;
    const slot = ((userIndex % 3) + 1) as 1 | 2 | 3;
    const midiRange = getUserPatchMidiRange(userIndex);

    patches.push({
      bank,
      slot,
      label: `${bank.toString().padStart(2, "0")}-${slot}`,
      bankMsb: midiRange.bankMsb,
      program: midiRange.program,
      userIndex,
    });
  }

  return patches;
}

export function getUserPatchMidiRange(userIndex: number) {
  if (userIndex < 0 || userIndex > 296) {
    throw new RangeError("GR-55 user patch index must be between 0 and 296");
  }

  if (userIndex < 128) {
    return { bankMsb: 0, program: userIndex };
  }

  if (userIndex < 256) {
    return { bankMsb: 1, program: userIndex - 128 };
  }

  return { bankMsb: 2, program: userIndex - 256 };
}

export const USER_PATCHES = buildUserPatchMap();
