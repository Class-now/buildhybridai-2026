import type { EntityType, Span } from './types';

/**
 * Deterministic detectors. They run on every device, online or offline, with or
 * without an on-device model, so the shield never depends on the cloud.
 */
interface Rule {
  type: EntityType;
  re: RegExp;
  /** capture group that holds the value (default 0 = whole match) */
  group?: number;
  validate?: (value: string) => boolean;
}

function luhn(num: string): boolean {
  const digits = num.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

const NAME = "[A-Z][a-zA-Z'\\-]+(?:[ ]+(?:[A-Z]\\.|[A-Z][a-zA-Z'\\-]+)){0,3}";

const RULES: Rule[] = [
  { type: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { type: 'URL', re: /\bhttps?:\/\/[^\s)>\]]+/g },
  // Labelled date of birth, keep other dates (deadlines matter to the answer).
  {
    type: 'DOB',
    re: /\b(?:DOB|D\.O\.B\.|Date of birth|Born|Birth date)[:\s]+((?:\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4})|(?:[A-Z][a-z]+\.? \d{1,2},? \d{4})|(?:\d{1,2} [A-Z][a-z]+ \d{4}))/gi,
    group: 1,
  },
  { type: 'ACCOUNT', re: /\b(?:\d[ -]?){13,19}\b/g, validate: luhn },
  { type: 'ACCOUNT', re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g }, // IBAN
  { type: 'ID', re: /\b\d{3}-\d{2}-\d{4}\b/g }, // US SSN shape
  // Labelled identifiers: MRN, policy, account, case, member, claim numbers...
  {
    type: 'ID',
    re: /\b(?:MRN|Medical record(?: number)?|Patient ID|Policy(?: number| no\.?| #)?|Account(?: number| no\.?| #)?|Acct\.?(?: #)?|Case(?: number| no\.?| #)?|Member ID|Claim(?: number| no\.?| #)?|Reference(?: number| no\.?)?|Ref\.?|Invoice(?: number| no\.?| #)?|Tenant ID|Lease ID|Passport(?: number| no\.?)?|License(?: number| no\.?)?|NHS number|Insurance ID|Group(?: number| no\.?| #)?)[:#\s]+([A-Z0-9][A-Z0-9\-\/]{3,})/gi,
    group: 1,
    validate: (v) => /\d/.test(v),
  },
  // Phone numbers (international and North American shapes).
  {
    type: 'PHONE',
    re: /(?:\+\d{1,3}[ .\-]?)?(?:\(\d{2,4}\)[ .\-]?|\b\d{2,4}[ .\-])\d{3,4}[ .\-]\d{3,4}\b/g,
    validate: (v) => v.replace(/\D/g, '').length >= 9,
  },
  // Street addresses: "1234 Elm Street", "88 Rue de ..." (number + capitalised words + suffix)
  {
    type: 'ADDRESS',
    re: /\b\d{1,5}[A-Za-z]?(?:[ ]+[A-Z][a-zA-Z.]+){1,4}[ ]+(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Lane|Ln\.?|Drive|Dr\.?|Court|Ct\.?|Way|Place|Pl\.?|Terrace|Close|Crescent)(?:,?[ ]+(?:Apt\.?|Apartment|Unit|Suite|#)[ ]*[A-Za-z0-9\-]+)?/g,
  },
  { type: 'ADDRESS', re: /\b\d{1,5}[ ]+Broadway(?:[ ]+(?:Suite|Ste\.?|Unit|#)[ ]*[A-Za-z0-9\-]+)?/g },
  { type: 'ADDRESS', re: /\bP\.?O\.? Box[ ]+\d+/gi },
  // Organisations with a telling suffix (clinics, landlords, insurers, banks).
  {
    type: 'ORG',
    re: /\b(?:St\.[ ]+)?(?:[A-Z][a-zA-Z&'\-]+[ ]+){1,5}(?:LLC|Inc\.?|Ltd\.?|Corp\.?|Center|Centre|Hospital|Clinic|Health Plan|Health|Partners|Bank|Credit Union|Management(?: LLC)?|Insurance|Mutual|Associates|Group|University|School|Pharmacy)\b/g,
    validate: (v) => !/^(?:The|This|Your|Our|Appeals|Member|Notice)\b/.test(v),
  },
  // Names after honorifics / salutations / labels.
  {
    type: 'PERSON',
    re: new RegExp(`\\b(?:Mr|Mrs|Ms|Mx|Miss|Dr|Prof)\\.?[ ]+(${NAME})`, 'g'),
    group: 1,
  },
  {
    type: 'PERSON',
    re: new RegExp(`\\b(?:Dear|Patient|Name|Tenant|Landlord|Signed|Sincerely|Regards|Attn|Attention|Physician|Provider|Applicant|Insured|Claimant|Employee|Resident|Member|Contact|Caregiver|Caregiver on file|Client|Borrower|Guardian)[:,]?[ \\n]+(${NAME})`, 'g'),
    group: 1,
  },
];

const NOT_NAMES = new Set([
  'The', 'This', 'That', 'Your', 'You', 'We', 'Our', 'Please', 'Thank', 'Thanks', 'Sir', 'Madam', 'Customer',
  'Patient', 'Tenant', 'Team', 'Department', 'Office', 'Member', 'Policyholder', 'Doctor', 'All', 'Dr', 'Mr', 'Mrs', 'Ms', 'Mx', 'Prof', 'Tenant', 'Services', 'Unit',
]);

export function detectWithRules(text: string): Span[] {
  const spans: Span[] = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    for (const m of text.matchAll(rule.re)) {
      const g = rule.group ?? 0;
      let value = m[g];
      if (!value) continue;
      value = value.replace(/[.,;:]+$/, '').trim();
      if (!value) continue;
      if (rule.validate && !rule.validate(value)) continue;
      if (rule.type === 'PERSON' && NOT_NAMES.has(value.split(/\s+/)[0])) continue;
      const offsetInMatch = g === 0 ? 0 : m[0].indexOf(m[g]);
      const start = (m.index ?? 0) + offsetInMatch;
      spans.push({ start, end: start + value.length, text: value, type: rule.type, detector: 'rules' });
    }
  }
  return spans;
}
