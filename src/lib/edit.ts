// Attributes that make an element editable in the admin editor. On the public site they render nothing.
// Paths are "<contentKey>.<field>.<index>..." into the content object, e.g. "home.hero.title".

type Attrs = Record<string, string>;

export function editor(locals: App.Locals, base = '') {
  const on = !!locals.editing;
  const full = (p: string) => (base ? `${base}.${p}` : p);
  return {
    on,
    /** Inline text */
    t: (p: string): Attrs => (on ? { 'data-e': full(p) } : {}),
    /** Image src (+ optional alt path) */
    img: (p: string, alt?: string): Attrs => (on ? { 'data-e-img': full(p), ...(alt ? { 'data-e-alt': full(alt) } : {}) } : {}),
    /** Background image */
    bg: (p: string): Attrs => (on ? { 'data-e-bg': full(p) } : {}),
    /** Container whose direct children are the items of an array. tpl is the value used when adding to an empty list. */
    list: (p: string, tpl?: unknown): Attrs =>
      on ? { 'data-e-list': full(p), ...(tpl !== undefined ? { 'data-e-tpl': JSON.stringify(tpl) } : {}) } : {},
    /** Link href (text is edited separately with t) */
    href: (p: string): Attrs => (on ? { 'data-e-href': full(p) } : {}),
    /** Sub-editor rooted at a deeper path */
    at: (p: string) => editor(locals, full(p)),
    path: full,
  };
}
export type Editor = ReturnType<typeof editor>;
