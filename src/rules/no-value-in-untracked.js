/**
 * `no-value-in-untracked` — flag `.value` reads inside callbacks that do not
 * subscribe to what they read, and suggest `.peek()` to make that explicit.
 *
 * - `untrack(fn)` runs `fn` with dependency tracking switched off.
 * - The callback of `watch(source, cb)` (and `watchDebounce` /
 *   `watchThrottle`) only re-runs when `source` changes: other signals read
 *   inside it never trigger it (for `watch` they only cause redundant
 *   re-evaluations of the internal effect).
 *
 * Only identifiers that provably hold a bQuery signal are reported: a
 * `const` (or never reassigned `let` / `var`) initialised with a call to one
 * of bQuery's signal factories (`signal()`, `computed()`, `useSignal()`, …).
 * Anything else — DOM elements, `Map` entries, parameters, imports from other
 * modules, globals — may have a `.value` without a `.peek()`, so it is left
 * alone.
 *
 * @module @bquery/eslint-plugin/rules/no-value-in-untracked
 */

import { bquerySources, docsUrl, findVariable, isFunction, matchBQueryCall } from '../utils.js';

const SOURCES = bquerySources('reactive');

/**
 * bQuery factories whose result has a tracked `.value` and an untracked
 * `.peek()` (they return `Signal`, `Computed`, `LinkedSignal` or
 * `ReadonlySignal`), grouped by the module that exports them. Checked against
 * the published `@bquery/bquery` 1.18 declaration files.
 *
 * @type {Array<[Set<string>, Set<string>]>}
 */
const SIGNAL_FACTORIES = [
  [
    bquerySources('reactive'),
    new Set(['signal', 'computed', 'linkedSignal', 'persistedSignal', 'readonly']),
  ],
  [bquerySources('component'), new Set(['useSignal', 'useComputed', 'useSlot'])],
  [bquerySources('platform'), new Set(['useCookie'])],
  [bquerySources('motion'), new Set(['reducedMotionSignal'])],
  [bquerySources('a11y'), new Set(['keyboardUserSignal', 'focusVisible'])],
  [bquerySources('router'), new Set(['isActiveSignal'])],
  [bquerySources('dnd'), new Set(['draggablePosition', 'sortableOrder'])],
];

/** Untracking helpers → index of the untracked callback argument. */
const CALLBACK_INDEX = new Map([
  ['untrack', 0],
  ['watch', 1],
  ['watchDebounce', 1],
  ['watchThrottle', 1],
]);
const NAMES = new Set(CALLBACK_INDEX.keys());

/**
 * Whether a `.value` member expression is written rather than read.
 *
 * @param {import('../utils.js').AnyNode} node - Member expression
 * @returns {boolean} True for assignment, update and `delete` targets
 */
const isWriteTarget = (node) => {
  let child = node;
  let parent = node.parent;
  // Climb through destructuring patterns: `[a.value] = list`, `({ x: a.value } = obj)`.
  while (
    parent &&
    (parent.type === 'ArrayPattern' ||
      parent.type === 'RestElement' ||
      (parent.type === 'Property' &&
        parent.value === child &&
        parent.parent.type === 'ObjectPattern') ||
      parent.type === 'ObjectPattern' ||
      (parent.type === 'AssignmentPattern' && parent.left === child))
  ) {
    child = parent;
    parent = parent.parent;
  }
  if (!parent) return false;
  switch (parent.type) {
    case 'AssignmentExpression':
      // Compound assignments (`+=`) read too, but the intent is a write.
      return parent.left === child;
    case 'UpdateExpression':
      return true;
    case 'UnaryExpression':
      return parent.operator === 'delete';
    case 'ForInStatement':
    case 'ForOfStatement':
      return parent.left === child;
    default:
      return false;
  }
};

/**
 * Whether a function is the untracked callback of a bQuery `untrack()` /
 * `watch*()` call.
 *
 * @param {import('eslint').Rule.RuleContext} context - Rule context
 * @param {import('../utils.js').AnyNode} fn - Function node
 * @returns {string | null} The helper name, or `null`
 */
const untrackedHelper = (context, fn) => {
  const call = fn.parent;
  if (call?.type !== 'CallExpression') return null;
  const match = matchBQueryCall(context, call, SOURCES, NAMES);
  if (!match || call.arguments[CALLBACK_INDEX.get(match.name) ?? -1] !== fn) return null;
  return match.name;
};

/**
 * Unwrap TypeScript-only wrappers (`x as T`, `x!`, `x satisfies T`, `<T>x`).
 *
 * @param {import('../utils.js').AnyNode} node - Expression
 * @returns {import('../utils.js').AnyNode} The wrapped runtime expression
 */
const unwrap = (node) => {
  let current = node;
  while (
    current?.type === 'TSAsExpression' ||
    current?.type === 'TSNonNullExpression' ||
    current?.type === 'TSSatisfiesExpression' ||
    current?.type === 'TSTypeAssertion'
  ) {
    current = current.expression;
  }
  return current;
};

/**
 * Whether a variable provably holds a bQuery signal: it has a single
 * `const` / `let` / `var` declaration with a plain identifier, is initialised
 * with a call to a bQuery signal factory (named, renamed or namespace
 * import), and is never reassigned.
 *
 * @param {import('eslint').Rule.RuleContext} context - Rule context
 * @param {import('eslint').Scope.Variable} variable - Variable to inspect
 * @returns {boolean} True for confirmed signals
 */
const holdsSignal = (context, variable) => {
  if (variable.defs.length !== 1) return false;
  const [def] = variable.defs;
  if (def.type !== 'Variable' || def.node.id.type !== 'Identifier') return false;
  if (def.parent.kind !== 'const') {
    // `let` / `var`: the initialiser is the only write.
    if (variable.references.some((reference) => reference.isWrite() && !reference.init)) {
      return false;
    }
  }
  const init = unwrap(def.node.init);
  if (init?.type !== 'CallExpression') return false;
  return SIGNAL_FACTORIES.some(([sources, names]) =>
    Boolean(matchBQueryCall(context, init, sources, names))
  );
};

/**
 * Whether `inner` lies inside `outer` (by source range).
 *
 * @param {import('../utils.js').AnyNode} inner - Candidate descendant
 * @param {import('../utils.js').AnyNode} outer - Candidate ancestor
 * @returns {boolean} True when `inner` is within `outer`
 */
const isWithin = (inner, outer) =>
  inner.range[0] >= outer.range[0] && inner.range[1] <= outer.range[1];

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'suggestion',
    hasSuggestions: true,
    docs: {
      description:
        'Flag `.value` reads of bQuery signals inside `untrack()` and `watch()` callbacks, which do not subscribe, and suggest `.peek()`',
      recommended: true,
      url: docsUrl('no-value-in-untracked'),
    },
    schema: [],
    messages: {
      valueInUntracked:
        '`{{name}}.value` inside a `{{helper}}()` callback does not subscribe to `{{name}}`. Use `{{name}}.peek()` to make the untracked read explicit.',
      usePeek: 'Replace `{{name}}.value` with `{{name}}.peek()`.',
    },
  },

  create(context) {
    const { sourceCode } = context;
    return {
      /** @param {import('../utils.js').AnyNode} node */
      'MemberExpression[computed=false][property.name="value"]'(node) {
        if (node.object.type !== 'Identifier' || isWriteTarget(node)) return;

        // Only reads made by the callback body itself, not by nested
        // functions (which may be effects or run later).
        const fn = sourceCode.getAncestors(node).findLast(isFunction);
        if (!fn) return;
        const helper = untrackedHelper(context, fn);
        if (!helper) return;

        // Skip the callback's own parameters and locals (e.g. `newValue`):
        // they hold plain values, not signals.
        const name = node.object.name;
        const variable = findVariable(sourceCode.getScope(node), name);
        if (!variable || variable.defs.length === 0) return;
        if (variable.defs.some((def) => isWithin(def.name, fn))) return;
        // Only identifiers that provably hold a bQuery signal: `.peek()` does
        // not exist on a DOM input, a `Map` entry or an unknown import.
        if (!holdsSignal(context, variable)) return;

        const data = { name, helper };
        context.report({
          node,
          messageId: 'valueInUntracked',
          data,
          suggest: [
            {
              messageId: 'usePeek',
              data,
              fix: (fixer) =>
                fixer.replaceTextRange(
                  [node.object.range[1], node.range[1]],
                  node.optional ? '?.peek()' : '.peek()'
                ),
            },
          ],
        });
      },
    };
  },
};
