import type { ViewRenderer } from "./context.ts";
import type { ListingLine } from "../core/disassembler.ts";
import { hex2, hex4 } from "../core/disassembler.ts";
import { clear, el, parseHex } from "./dom.ts";

function formatBytes(bytes: readonly number[] | undefined): string {
  if (!bytes) return "";
  return bytes.map((b) => hex2(b)).join(" ");
}

function lineToText(line: ListingLine): string {
  if (line.kind === "label") {
    return `\n${line.label ?? ""}:`;
  }
  const addr = hex4(line.address);
  const bytes = formatBytes(line.bytes).padEnd(11, " ");
  const text = line.text ?? "";
  const comment = line.comment ? `  ; ${line.comment}` : "";
  return `  ${addr}  ${bytes} ${text}${comment}`;
}

export const renderDisassembly: ViewRenderer = (container, ctx) => {
  clear(container);
  const { disasm, mem } = ctx;

  const stats = el("div", { class: "stats" }, [
    el("span", {}, [`Entry (RESET): $${hex4(mem.resetVector)}`]),
    el("span", {}, [`NMI: $${hex4(mem.nmiVector)}`]),
    el("span", {}, [`IRQ: $${hex4(mem.irqVector)}`]),
    el("span", {}, [`Instructions: ${String(disasm.stats.instructionCount)}`]),
    el("span", {}, [`Code: ${String(disasm.stats.codeBytes)} B`]),
    el("span", {}, [`Data: ${String(disasm.stats.dataBytes)} B`]),
  ]);

  const pre = el("pre", { class: "listing" });

  const renderListing = (): void => {
    const text = disasm.lines.map(lineToText).join("\n");
    pre.textContent = text;
  };
  renderListing();

  const gotoInput = el("input", {
    type: "text",
    placeholder: "address e.g. C000",
    class: "addr-input",
  });
  const gotoBtn = el("button", {
    text: "Go",
    onclick: () => {
      const target = parseHex(gotoInput.value);
      if (target === null) return;
      const needle = `  ${hex4(target)}  `;
      const idx = (pre.textContent ?? "").indexOf(needle);
      if (idx < 0) return;
      // Approximate scroll position by line number.
      const before = (pre.textContent ?? "").slice(0, idx).split("\n").length;
      const lineHeight = pre.scrollHeight / Math.max(1, (pre.textContent ?? "").split("\n").length);
      pre.scrollTop = Math.max(0, (before - 2) * lineHeight);
    },
  });

  const toolbar = el("div", { class: "toolbar" }, [
    el("label", { text: "Go to:" }),
    gotoInput,
    gotoBtn,
  ]);

  container.append(stats, toolbar, pre);
};
