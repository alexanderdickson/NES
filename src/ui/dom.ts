type Child = Node | string | number | null | undefined | false;

export interface ElProps {
  class?: string;
  text?: string;
  title?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  href?: string;
  style?: Partial<CSSStyleDeclaration>;
  [key: `on${string}`]: EventListener | undefined;
  [key: `data-${string}`]: string | undefined;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, raw] of Object.entries(props)) {
    if (raw === undefined || raw === null) continue;
    if (key === "class") node.className = String(raw);
    else if (key === "text") node.textContent = String(raw);
    else if (key === "style" && typeof raw === "object") Object.assign(node.style, raw);
    else if (key.startsWith("on") && typeof raw === "function")
      node.addEventListener(key.slice(2).toLowerCase(), raw as EventListener);
    else node.setAttribute(key, String(raw));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function parseHex(input: string): number | null {
  const cleaned = input.trim().replace(/^[$]/, "").replace(/^0x/i, "");
  if (cleaned === "" || !/^[0-9a-f]+$/i.test(cleaned)) return null;
  return Number.parseInt(cleaned, 16);
}
