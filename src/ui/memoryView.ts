import type { AppContext, ViewRenderer } from "./context.ts";
import { hex2, hex4 } from "../core/disassembler.ts";
import { clear, el, parseHex } from "./dom.ts";

const PAGE_BYTES = 0x100; // 16 rows x 16 columns
let pageBase = 0xc000;
let highlight = -1;

function clampPage(base: number): number {
  return Math.max(0, Math.min(0xffff - PAGE_BYTES + 1, base & 0xfff0));
}

function renderDump(ctx: AppContext, onSelect: (addr: number) => void): HTMLElement {
  const { mem } = ctx;
  const table = el("table", { class: "hexdump" });

  const header = el("tr", {}, [el("th", { text: "addr" })]);
  for (let c = 0; c < 16; c++) header.append(el("th", { text: hex2(c) }));
  header.append(el("th", { text: "ascii" }));
  table.append(header);

  for (let row = 0; row < PAGE_BYTES / 16; row++) {
    const rowAddr = pageBase + row * 16;
    const tr = el("tr", {}, [el("td", { class: "rowaddr", text: `$${hex4(rowAddr)}` })]);
    let ascii = "";
    for (let c = 0; c < 16; c++) {
      const addr = rowAddr + c;
      const value = mem.read(addr);
      ascii += value >= 0x20 && value < 0x7f ? String.fromCharCode(value) : ".";
      const cell = el("td", {
        class: addr === highlight ? "byte selected" : "byte",
        text: hex2(value),
        title: `$${hex4(addr)}`,
        onclick: () => {
          highlight = addr;
          onSelect(addr);
        },
      });
      tr.append(cell);
    }
    tr.append(el("td", { class: "ascii", text: ascii }));
    table.append(tr);
  }
  return table;
}

export const renderMemory: ViewRenderer = (container, ctx) => {
  clear(container);
  const { mem } = ctx;

  const addrInput = el("input", { type: "text", value: hex4(pageBase), class: "addr-input" });
  const valueInput = el("input", { type: "text", placeholder: "00", class: "byte-input" });
  const peekOut = el("span", { class: "peek-out" });

  const dumpHost = el("div", { class: "dump-host" });

  const refresh = (): void => {
    clear(dumpHost);
    dumpHost.append(
      renderDump(ctx, (addr) => {
        addrInput.value = hex4(addr);
        valueInput.value = hex2(mem.read(addr));
        peekOut.textContent = `[$${hex4(addr)}] = $${hex2(mem.read(addr))} (${String(mem.read(addr))})`;
      }),
    );
  };

  const peek = (): void => {
    const addr = parseHex(addrInput.value);
    if (addr === null) {
      peekOut.textContent = "Invalid address";
      return;
    }
    highlight = addr & 0xffff;
    pageBase = clampPage(addr - (addr % PAGE_BYTES));
    valueInput.value = hex2(mem.read(addr));
    peekOut.textContent = `[$${hex4(addr)}] = $${hex2(mem.read(addr))} (${String(mem.read(addr))})`;
    refresh();
  };

  const poke = (): void => {
    const addr = parseHex(addrInput.value);
    const value = parseHex(valueInput.value);
    if (addr === null || value === null) {
      peekOut.textContent = "Invalid address or value";
      return;
    }
    mem.write(addr, value);
    highlight = addr & 0xffff;
    const isPrg = addr >= 0x8000;
    peekOut.textContent = `Poked $${hex2(value & 0xff)} to $${hex4(addr)}${isPrg ? " (PRG — re-disassembled)" : ""}`;
    if (isPrg) ctx.reDisassemble();
    refresh();
  };

  const nav = (delta: number): void => {
    pageBase = clampPage(pageBase + delta);
    addrInput.value = hex4(pageBase);
    refresh();
  };

  const controls = el("div", { class: "toolbar" }, [
    el("label", { text: "Address:" }),
    addrInput,
    el("button", { text: "Peek", onclick: peek }),
    el("label", { text: "Value:" }),
    valueInput,
    el("button", { text: "Poke", onclick: poke }),
    peekOut,
  ]);

  const pager = el("div", { class: "toolbar" }, [
    el("button", { text: "<< -256", onclick: () => nav(-PAGE_BYTES) }),
    el("button", { text: "< -16", onclick: () => nav(-16) }),
    el("button", { text: "+16 >", onclick: () => nav(16) }),
    el("button", { text: "+256 >>", onclick: () => nav(PAGE_BYTES) }),
    el("span", {
      class: "hint",
      text: "RAM $0000–$1FFF · IO $2000–$401F · PRG $8000–$FFFF (poking PRG edits the ROM)",
    }),
  ]);

  refresh();
  container.append(controls, pager, dumpHost);
};
