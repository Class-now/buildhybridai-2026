export type EntityType =
  | 'PERSON'
  | 'ORG'
  | 'ADDRESS'
  | 'EMAIL'
  | 'PHONE'
  | 'ID'
  | 'ACCOUNT'
  | 'DOB'
  | 'URL'
  | 'OTHER';

export const ENTITY_LABEL: Record<EntityType, string> = {
  PERSON: 'Person',
  ORG: 'Organization',
  ADDRESS: 'Address',
  EMAIL: 'Email',
  PHONE: 'Phone',
  ID: 'ID number',
  ACCOUNT: 'Account / card',
  DOB: 'Date of birth',
  URL: 'Link',
  OTHER: 'Identifier',
};

/** Where a detection came from. */
export type Detector = 'rules' | 'nano';

export interface Span {
  start: number;
  end: number;
  text: string;
  type: EntityType;
  detector: Detector;
}

/** A unique sensitive value and the placeholder that replaces it. */
export interface Entity {
  key: string; // normalized value
  value: string; // as written (first occurrence)
  type: EntityType;
  placeholder: string; // e.g. [PERSON_1]
  detector: Detector;
  masked: boolean; // user can un-mask
  count: number;
  /** Other spellings of the same value (e.g. "Maria E. Alvarez" for "Maria Elena Alvarez"). */
  aliases?: string[];
}

export interface ShieldResult {
  original: string;
  spans: Span[];
  entities: Entity[];
  nanoUsed: boolean;
  nanoNote?: string;
  ms: number;
}
