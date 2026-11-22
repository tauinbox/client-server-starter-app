import stylelint from 'stylelint';

// `a:hover` (0,1,1) outranks the one class (0,1,0) that colours a Material
// component on an <a> or <button> host; :where() has no specificity.

const ruleName = 'nxs/element-state-in-where';

const messages = stylelint.utils.ruleMessages(ruleName, {
  rejected: (selector) =>
    `"${selector}" outranks the class of a Material component on an a or button host. Wrap it in :where().`
});

const ELEMENT_STATE =
  /(^|[\s>+~(])(a|button)(:(hover|focus|focus-visible|focus-within|active|visited)|\[)/;

function splitTopLevel(selector) {
  const parts = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < selector.length; i++) {
    const char = selector[i];

    if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (char === ',' && depth === 0) {
      parts.push(selector.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(selector.slice(start).trim());

  return parts.filter(Boolean);
}

function stripWhere(selector) {
  let out = '';
  let i = 0;

  while (i < selector.length) {
    if (selector.startsWith(':where(', i)) {
      let depth = 1;

      i += ':where('.length;
      while (i < selector.length && depth > 0) {
        if (selector[i] === '(') depth++;
        else if (selector[i] === ')') depth--;
        i++;
      }
    } else {
      out += selector[i];
      i++;
    }
  }

  return out;
}

function parentRule(node) {
  let { parent } = node;

  while (parent && parent.type !== 'rule' && parent.type !== 'root') {
    ({ parent } = parent);
  }

  return parent?.type === 'rule' ? parent : undefined;
}

function resolveSelectors(rule) {
  const own = splitTopLevel(rule.selector);
  const parent = parentRule(rule);

  if (!parent) return own;

  return resolveSelectors(parent).flatMap((outer) =>
    own.map((inner) =>
      inner.includes('&') ? inner.replaceAll('&', outer) : `${outer} ${inner}`
    )
  );
}

const ruleFunction = (primary) => (root, result) => {
  if (!stylelint.utils.validateOptions(result, ruleName, { actual: primary })) {
    return;
  }

  root.walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name)) {
      return;
    }

    const offending = resolveSelectors(rule).find((selector) =>
      ELEMENT_STATE.test(stripWhere(selector))
    );

    if (offending) {
      stylelint.utils.report({
        ruleName,
        result,
        node: rule,
        message: messages.rejected(offending)
      });
    }
  });
};

ruleFunction.ruleName = ruleName;
ruleFunction.messages = messages;
ruleFunction.meta = {};

export default stylelint.createPlugin(ruleName, ruleFunction);
