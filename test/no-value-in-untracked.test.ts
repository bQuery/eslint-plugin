import plugin from '../src/index.js';
import { ruleTester } from './rule-tester';

const rule = plugin.rules['no-value-in-untracked'];

ruleTester.run('no-value-in-untracked', rule, {
  valid: [
    // Explicit untracked reads.
    `import { untrack, signal } from '@bquery/bquery/reactive';
     const count = signal(0);
     untrack(() => count.peek());`,
    // Tracked contexts.
    `import { effect, computed, signal } from '@bquery/bquery';
     const count = signal(0);
     effect(() => count.value);
     computed(() => count.value * 2);`,
    // Writes are not reads.
    `import { watch, signal } from '@bquery/bquery';
     const a = signal(0); const b = signal(0);
     watch(a, () => { b.value = 1; b.value++; b.value += 1; [b.value] = [2]; ({ x: b.value } = { x: 3 }); });`,
    // Callback parameters and locals hold plain values.
    `import { watch, signal } from '@bquery/bquery';
     const user = signal({ value: 1 });
     watch(user, (next, prev) => { next.value; prev?.value; const input = document.createElement('input'); input.value; });`,
    // Nested functions are not part of the untracked callback.
    `import { watch, effect, signal } from '@bquery/bquery';
     const a = signal(0); const b = signal(0);
     watch(a, () => { effect(() => b.value); });`,
    // The watch source argument is tracked.
    `import { watch, signal } from '@bquery/bquery';
     const a = signal(0);
     watch(a, () => {}, { equals: (x, y) => a.value === x && x === y });`,
    // Not bQuery's helpers; unresolved globals.
    `import { untrack } from 'other-lib';
     const s = { value: 1 };
     untrack(() => s.value);`,
    `import { untrack } from '@bquery/bquery';
     untrack(() => globalThing.value);`,
    // Computed member access is left alone.
    `import { untrack, signal } from '@bquery/bquery';
     const s = signal(1);
     untrack(() => s['value']);`,
    // Only confirmed bQuery signals have `.peek()`: a DOM input's `.value`
    // is not a signal read (and `input.peek()` would throw).
    `import { watch, signal } from '@bquery/bquery/reactive';
     const query = signal('');
     const input = document.querySelector('input');
     watch(query, () => search(input.value));`,
    // Map entries, objects with a `value` field.
    `import { untrack } from '@bquery/bquery/reactive';
     const fields = new Map();
     const entry = fields.get('name');
     const option = { value: 1 };
     untrack(() => [entry.value, option.value]);`,
    // Parameters of an enclosing function.
    `import { watch, signal } from '@bquery/bquery';
     const query = signal('');
     export function bind(field) { watch(query, () => field.value); }`,
    // Imports from other modules may or may not be signals.
    `import { watch, signal } from '@bquery/bquery';
     import { filter } from './state';
     const query = signal('');
     watch(query, () => filter.value);`,
    // Factories that are not bQuery's, or not signal factories.
    `import { untrack } from '@bquery/bquery/reactive';
     import { signal } from '@preact/signals-core';
     import { effect } from '@bquery/bquery/reactive';
     const a = signal(0);
     const b = effect(() => {});
     untrack(() => a.value + b.value);`,
    // A `let` that is reassigned may no longer hold the signal.
    `import { untrack, signal } from '@bquery/bquery/reactive';
     let current = signal(0);
     current = { value: 1 };
     untrack(() => current.value);`,
    // Destructured bindings are not followed.
    `import { untrack, signal } from '@bquery/bquery/reactive';
     const [first] = [signal(0)];
     untrack(() => first.value);`,
  ],
  invalid: [
    {
      code: `import { untrack, signal } from '@bquery/bquery/reactive';
const count = signal(0);
const snapshot = untrack(() => count.value);`,
      errors: [
        {
          messageId: 'valueInUntracked',
          data: { name: 'count', helper: 'untrack' },
          suggestions: [
            {
              messageId: 'usePeek',
              data: { name: 'count', helper: 'untrack' },
              output: `import { untrack, signal } from '@bquery/bquery/reactive';
const count = signal(0);
const snapshot = untrack(() => count.peek());`,
            },
          ],
        },
      ],
    },
    {
      code: `import { watch as observe, signal } from '@bquery/bquery';
const query = signal(''); const page = signal(1);
observe(query, (next) => { load(next, page.value); });`,
      errors: [
        {
          messageId: 'valueInUntracked',
          data: { name: 'page', helper: 'watch' },
          suggestions: [
            {
              messageId: 'usePeek',
              output: `import { watch as observe, signal } from '@bquery/bquery';
const query = signal(''); const page = signal(1);
observe(query, (next) => { load(next, page.peek()); });`,
            },
          ],
        },
      ],
    },
    {
      code: `import * as reactive from '@bquery/bquery/reactive';
const filter = reactive.signal(''); const sort = reactive.computed(() => 'asc');
reactive.watchDebounce(filter, function () { render(filter.value, sort?.value); }, 100);
reactive.watchThrottle(filter, () => sort.value(), 100);`,
      errors: [
        {
          messageId: 'valueInUntracked',
          data: { name: 'filter', helper: 'watchDebounce' },
          suggestions: [
            {
              messageId: 'usePeek',
              output: `import * as reactive from '@bquery/bquery/reactive';
const filter = reactive.signal(''); const sort = reactive.computed(() => 'asc');
reactive.watchDebounce(filter, function () { render(filter.peek(), sort?.value); }, 100);
reactive.watchThrottle(filter, () => sort.value(), 100);`,
            },
          ],
        },
        {
          messageId: 'valueInUntracked',
          data: { name: 'sort', helper: 'watchDebounce' },
          suggestions: [
            {
              messageId: 'usePeek',
              output: `import * as reactive from '@bquery/bquery/reactive';
const filter = reactive.signal(''); const sort = reactive.computed(() => 'asc');
reactive.watchDebounce(filter, function () { render(filter.value, sort?.peek()); }, 100);
reactive.watchThrottle(filter, () => sort.value(), 100);`,
            },
          ],
        },
        {
          messageId: 'valueInUntracked',
          data: { name: 'sort', helper: 'watchThrottle' },
          suggestions: [
            {
              messageId: 'usePeek',
              output: `import * as reactive from '@bquery/bquery/reactive';
const filter = reactive.signal(''); const sort = reactive.computed(() => 'asc');
reactive.watchDebounce(filter, function () { render(filter.value, sort?.value); }, 100);
reactive.watchThrottle(filter, () => sort.peek()(), 100);`,
            },
          ],
        },
      ],
    },
    {
      // Renamed factory imports and the root namespace; TS wrappers on the
      // initialiser; a never-reassigned `let`.
      code: `import { computed as derive, signal as createSignal, untrack } from '@bquery/bquery';
import type { Signal } from '@bquery/bquery/reactive';
const total = derive(() => 1);
let count = createSignal(0) as Signal<number>;
untrack(() => total.value + count.value);`,
      errors: [
        {
          messageId: 'valueInUntracked',
          data: { name: 'total', helper: 'untrack' },
          suggestions: [
            {
              messageId: 'usePeek',
              output: `import { computed as derive, signal as createSignal, untrack } from '@bquery/bquery';
import type { Signal } from '@bquery/bquery/reactive';
const total = derive(() => 1);
let count = createSignal(0) as Signal<number>;
untrack(() => total.peek() + count.value);`,
            },
          ],
        },
        {
          messageId: 'valueInUntracked',
          data: { name: 'count', helper: 'untrack' },
          suggestions: [
            {
              messageId: 'usePeek',
              output: `import { computed as derive, signal as createSignal, untrack } from '@bquery/bquery';
import type { Signal } from '@bquery/bquery/reactive';
const total = derive(() => 1);
let count = createSignal(0) as Signal<number>;
untrack(() => total.value + count.peek());`,
            },
          ],
        },
      ],
    },
    {
      // Namespace import of the full bundle; signal factories from other modules.
      code: `import * as bq from '@bquery/bquery/full';
import { useCookie } from '@bquery/bquery/platform';
const theme = useCookie('theme');
const page = bq.linkedSignal(() => 1, () => {});
bq.untrack(() => [theme.value, page.value]);`,
      errors: [
        {
          messageId: 'valueInUntracked',
          data: { name: 'theme', helper: 'untrack' },
          suggestions: [
            {
              messageId: 'usePeek',
              output: `import * as bq from '@bquery/bquery/full';
import { useCookie } from '@bquery/bquery/platform';
const theme = useCookie('theme');
const page = bq.linkedSignal(() => 1, () => {});
bq.untrack(() => [theme.peek(), page.value]);`,
            },
          ],
        },
        {
          messageId: 'valueInUntracked',
          data: { name: 'page', helper: 'untrack' },
          suggestions: [
            {
              messageId: 'usePeek',
              output: `import * as bq from '@bquery/bquery/full';
import { useCookie } from '@bquery/bquery/platform';
const theme = useCookie('theme');
const page = bq.linkedSignal(() => 1, () => {});
bq.untrack(() => [theme.value, page.peek()]);`,
            },
          ],
        },
      ],
    },
  ],
});
