// In-memory chrome.bookmarks for tests: one instance = one Chrome profile's
// bookmark store, shared by every extension id loaded into that profile.
// `faults` injects errors: { create(args) -> Error|undefined, getTree() -> Error|undefined }.
export function mockBookmarks(faults = {}) {
  let nextId = 10;
  const nodes = new Map();
  const root = { id: "0", title: "", children: [] };
  const bar = { id: "1", parentId: "0", title: "Bookmarks bar", children: [] };
  const other = { id: "2", parentId: "0", title: "Other bookmarks", children: [] };
  root.children.push(bar, other);
  for (const node of [root, bar, other]) nodes.set(node.id, node);
  const copy = (node) => JSON.parse(JSON.stringify(node));
  const strip = (node) => { const out = { ...node }; delete out.children; return copy(out); };
  const childrenOf = (id) => {
    const node = nodes.get(String(id));
    if (!node) throw new Error(`BOOKMARK_NOT_FOUND:${id}`);
    return node.children || [];
  };
  function removeRecursive(id) {
    const node = nodes.get(String(id));
    if (!node) return;
    for (const child of node.children || []) removeRecursive(child.id);
    const parent = nodes.get(String(node.parentId));
    if (parent?.children) parent.children = parent.children.filter((child) => child.id !== node.id);
    nodes.delete(node.id);
  }
  return {
    faults,
    async getTree() {
      const fault = faults.getTree?.();
      if (fault) throw fault;
      return [copy(root)];
    },
    async getChildren(id) { return childrenOf(id).map(strip); },
    async create({ parentId, title = "", url = undefined }) {
      const fault = faults.create?.({ parentId, title, url });
      if (fault) throw fault;
      const parent = nodes.get(String(parentId));
      if (!parent || (url && parent.url)) throw new Error("BOOKMARK_PARENT_INVALID");
      const id = String(nextId++);
      const node = { id, parentId: String(parentId), title: String(title), ...(url ? { url: String(url) } : { children: [] }) };
      nodes.set(id, node);
      parent.children.push(node);
      return strip(node);
    },
    async update(id, changes = {}) {
      const node = nodes.get(String(id));
      if (!node) throw new Error("BOOKMARK_NOT_FOUND");
      if (Object.hasOwn(changes, "title")) node.title = String(changes.title);
      if (Object.hasOwn(changes, "url")) node.url = String(changes.url);
      return strip(node);
    },
    async removeTree(id) { removeRecursive(String(id)); },
    debugTree() { return copy(root); }
  };
}
