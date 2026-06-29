export type AddressingMode =
  | "imp" // implied
  | "acc" // accumulator
  | "imm" // immediate
  | "zp" // zero page
  | "zpx" // zero page,X
  | "zpy" // zero page,Y
  | "izx" // (indirect,X)
  | "izy" // (indirect),Y
  | "abs" // absolute
  | "abx" // absolute,X
  | "aby" // absolute,Y
  | "ind" // (indirect)
  | "rel"; // relative

export interface Opcode {
  readonly mnemonic: string;
  readonly mode: AddressingMode;
  /** Documented (legal) opcode? */
  readonly official: boolean;
}

/** Number of operand bytes that follow the opcode for a given addressing mode. */
export const OPERAND_BYTES: Readonly<Record<AddressingMode, number>> = {
  imp: 0,
  acc: 0,
  imm: 1,
  zp: 1,
  zpx: 1,
  zpy: 1,
  izx: 1,
  izy: 1,
  abs: 2,
  abx: 2,
  aby: 2,
  ind: 2,
  rel: 1,
};
