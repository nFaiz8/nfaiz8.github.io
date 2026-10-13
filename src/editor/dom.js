// h('button', { class: 'btn', onclick }, 'save'): build an element. Props that are DOM properties
// (value, checked, disabled…) are set as properties; the rest as attributes. null/false are skipped.
export function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k in e && k !== 'list') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  return e;
}
