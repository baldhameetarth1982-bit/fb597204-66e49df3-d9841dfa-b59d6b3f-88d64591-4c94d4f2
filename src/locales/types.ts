/** One entry per key: [English, Hindi, Gujarati]. All three are required. */
export type Catalog = Record<string, readonly [en: string, hi: string, gu: string]>;

export const LANG_INDEX = { en: 0, hi: 1, gu: 2 } as const;
export type Lang = keyof typeof LANG_INDEX;
