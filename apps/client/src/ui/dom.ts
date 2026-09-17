/** Tiny DOM helpers so the panels stay readable without a UI framework. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Pick<HTMLElementTagNameMap[K], "textContent" | "className" | "id">> = {},
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

export function button(label: string, onClick: () => void): HTMLButtonElement {
  const node = el("button", { textContent: label });
  node.addEventListener("click", onClick);
  return node;
}

export function requireElement(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing #${id} in index.html`);
  return node;
}
