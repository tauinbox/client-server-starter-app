/**
 * Minimal nginx config parser shared by the `check-nginx-*` scripts.
 */

/**
 * Splits the config into directives and blocks, dropping comments. Quoted
 * strings are kept intact, so a `#`, `;` or brace inside quotes is not
 * structure. Returns a tree of { name, args, children? } nodes.
 */
export function parse(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === '#') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '{' || c === '}' || c === ';') {
      tokens.push(c);
      i++;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
      tokens.push(text.slice(i, j + 1));
      i = j + 1;
    } else {
      let j = i;
      while (j < text.length && !/[\s{};"'#]/.test(text[j])) j++;
      tokens.push(text.slice(i, j));
      i = j;
    }
  }

  let pos = 0;
  function block() {
    const nodes = [];
    let words = [];
    while (pos < tokens.length) {
      const t = tokens[pos++];
      if (t === ';') {
        if (words.length) nodes.push({ name: words[0], args: words.slice(1) });
        words = [];
      } else if (t === '{') {
        nodes.push({ name: words[0], args: words.slice(1), children: block() });
        words = [];
      } else if (t === '}') {
        return nodes;
      } else {
        words.push(t);
      }
    }
    return nodes;
  }
  return block();
}

export function* walk(nodes) {
  for (const node of nodes) {
    yield node;
    if (node.children) yield* walk(node.children);
  }
}

/** Removes the quotes around a parsed argument. */
export function unquote(arg) {
  return /^(["']).*\1$/s.test(arg) ? arg.slice(1, -1) : arg;
}
