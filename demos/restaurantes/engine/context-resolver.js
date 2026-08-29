/**
 * CONTEXT RESOLVER
 *
 * Resolves ambiguous references in conversation:
 *   "esa"       → last mentioned product
 *   "la otra"   → second-to-last mentioned product
 *   "las dos"   → last two mentioned products
 *   "la misma"  → same product as before
 *   "sin queso" → which item? (if multiple in draft)
 *
 * Works with conversationState.mentionedProducts
 * and orderDraft.items to resolve references.
 */

import { getLastMentionedProduct } from './conversation-state.js';

const PRONOUNS_LAST = ['esa', 'eso', 'esta', 'ese', 'la misma', 'el mismo', 'lo mismo', 'otra vez', 'la misma cosa', 'lo de antes'];
const PRONOUNS_PREV = ['la otra', 'el otro', 'la anterior', 'la de antes'];
const PRONOUNS_BOTH = ['las dos', 'los dos', 'ambas', 'ambos', 'las mismas', 'los mismos'];
const PRONOUNS_ALL = ['todas', 'todos', 'todo'];

/**
 * Resolve a product reference that might be a pronoun or anaphora
 *
 * @param {string} ref - The text reference (could be "esa", a product name, etc.)
 * @param {object} state - conversationState
 * @param {object} draft - orderDraft
 * @returns {{ resolved: boolean, products: Array<{productId, productName}>, type: string }}
 */
export function resolveReference(ref, state, draft) {
  if (!ref) return { resolved: false, products: [], type: 'empty' };

  const norm = ref.toLowerCase().trim();

  // Check "last" pronouns
  if (PRONOUNS_LAST.some(p => norm === p || norm.includes(p))) {
    const last = getLastMentionedProduct(state);
    if (last) {
      return { resolved: true, products: [last], type: 'last_mentioned' };
    }
    return { resolved: false, products: [], type: 'no_context' };
  }

  // Check "previous" pronouns
  if (PRONOUNS_PREV.some(p => norm === p || norm.includes(p))) {
    if (state.mentionedProducts.length >= 2) {
      const prev = state.mentionedProducts[state.mentionedProducts.length - 2];
      return { resolved: true, products: [prev], type: 'previous_mentioned' };
    }
    return { resolved: false, products: [], type: 'no_context' };
  }

  // Check "both" pronouns
  if (PRONOUNS_BOTH.some(p => norm === p || norm.includes(p))) {
    if (state.mentionedProducts.length >= 2) {
      const last2 = state.mentionedProducts.slice(-2);
      return { resolved: true, products: last2, type: 'both_mentioned' };
    }
    return { resolved: false, products: [], type: 'no_context' };
  }

  // Check "all" pronouns
  if (PRONOUNS_ALL.some(p => norm === p)) {
    if (draft.items.length > 0) {
      const all = draft.items.map(i => ({ productId: i.productId, productName: i.productName }));
      return { resolved: true, products: all, type: 'all_in_draft' };
    }
    return { resolved: false, products: [], type: 'empty_draft' };
  }

  // Not a pronoun — return unresolved so caller uses product search
  return { resolved: false, products: [], type: 'not_pronoun' };
}

/**
 * Resolve a modification target when multiple items are in the draft
 *
 * @param {string} modText - Modification text (e.g., "sin cebolla")
 * @param {object} draft - orderDraft
 * @param {object} state - conversationState
 * @returns {{ targetIndex: number, ambiguous: boolean, candidates: number[] }}
 */
export function resolveModificationTarget(modText, draft, state) {
  if (draft.items.length === 0) {
    return { targetIndex: -1, ambiguous: false, candidates: [] };
  }

  if (draft.items.length === 1) {
    return { targetIndex: 0, ambiguous: false, candidates: [0] };
  }

  // Check last mentioned product
  const last = getLastMentionedProduct(state);
  if (last) {
    const idx = draft.items.findIndex(i => i.productId === last.productId);
    if (idx !== -1) {
      return { targetIndex: idx, ambiguous: false, candidates: [idx] };
    }
  }

  // Can't determine — ambiguous
  return {
    targetIndex: -1,
    ambiguous: true,
    candidates: draft.items.map((_, i) => i)
  };
}

/**
 * Resolve quantity when user says "otra", "una más", "dos más"
 *
 * @param {string} text - User text
 * @param {object} state - conversationState
 * @returns {{ isRelative: boolean, quantity: number, productRef: object|null }}
 */
export function resolveQuantityReference(text, state) {
  const norm = text.toLowerCase().trim();

  // "otra" / "una más" → +1 of last mentioned
  if (/^(otra|uno más|una más|otro|dame otra)$/i.test(norm)) {
    const last = getLastMentionedProduct(state);
    return { isRelative: true, quantity: 1, productRef: last };
  }

  // "dos más", "tres más" → +N of last mentioned
  const moreMatch = norm.match(/^(\w+)\s+más$/);
  if (moreMatch) {
    const numWord = moreMatch[1];
    const NUM_MAP = { una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 };
    const qty = NUM_MAP[numWord] || parseInt(numWord);
    if (!isNaN(qty)) {
      const last = getLastMentionedProduct(state);
      return { isRelative: true, quantity: qty, productRef: last };
    }
  }

  return { isRelative: false, quantity: 0, productRef: null };
}
