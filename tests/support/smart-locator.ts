import type { Locator, Page } from '@playwright/test';

/**
 * Self-healing element resolution.
 *
 * A page object declares ranked candidates for one logical control. When the primary selector stops
 * matching after a UI change, the next candidate is used, the repair is recorded, and the test
 * carries on. The repair is then reported — the point is to survive the refactor without losing the
 * signal that a selector needs updating.
 */

export interface HealEvent {
  readonly element: string;
  readonly broken: string;
  readonly working: string;
  readonly at: string;
}

const healLog = new Map<string, HealEvent>();

export function healEvents(): HealEvent[] {
  return [...healLog.values()];
}

export function clearHealEvents(): void {
  healLog.clear();
}

export function describeHeals(): string {
  return healEvents()
    .map((e) => `${e.element}: replace "${e.broken}" with "${e.working}"`)
    .join('\n');
}

/**
 * @param page      the page to search
 * @param element   human-readable name, used in logs and the triage report
 * @param candidates ranked selectors; index 0 is the intended one
 */
export async function smartLocator(
  page: Page,
  element: string,
  candidates: readonly string[],
): Promise<Locator> {
  if (candidates.length === 0) {
    throw new Error(`smartLocator("${element}") was given no candidates`);
  }

  for (const [index, selector] of candidates.entries()) {
    const locator = page.locator(selector);
    if ((await locator.count()) > 0) {
      if (index > 0) {
        healLog.set(element, {
          element,
          broken: candidates[0]!,
          working: selector,
          at: new Date().toISOString(),
        });
        console.warn(`[self-heal] ${element}: "${candidates[0]}" no longer matches; used "${selector}"`);
      }
      return locator.first();
    }
  }

  throw new Error(
    `No candidate selector matched for "${element}". Tried:\n  ${candidates.join('\n  ')}`,
  );
}
