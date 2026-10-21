// GI actors require a running Shell; keep the production rendering code real
// and substitute only actor storage, signals and allocation at that boundary.
export class Widget {
  constructor(props = {}) { Object.assign(this, props); this.children = []; this.signals = new Map(); this.width = 200; }
  add_child(child) { this.children.push(child); child.parent = this; }
  add_actor(child) { this.add_child(child); }
  set_child_at_index(child, index) { this.children.splice(this.children.indexOf(child), 1); this.children.splice(index, 0, child); }
  connect(signal, cb) { const id = this.signals.size + 1; this.signals.set(id, {signal, cb}); return id; }
  disconnect(id) { this.signals.delete(id); }
  emit(signal) { for (const s of this.signals.values()) if (s.signal === signal) s.cb(this); }
  set_style(style) { this.style = style; }
  set_width(width) { this.width = width; }
  setSensitive(value) { this.sensitive = value; }
  destroy() { this.destroyed = true; this.signals.clear(); [...this.children].forEach(c => c.destroy()); if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); }
}
export const St = { BoxLayout: Widget, Widget, Label: Widget, ScrollView: Widget };
class Item extends Widget { constructor(text, props = {}) { super(props); this.text = text; this.label = new Widget({text}); } }
export const PopupMenu = { PopupBaseMenuItem: Widget, PopupMenuItem: Item, PopupSeparatorMenuItem: Widget };
export function textTree(actor) { return [actor.text ?? '', actor.accessible_name ?? '', ...actor.children.map(textTree)].join(' '); }
