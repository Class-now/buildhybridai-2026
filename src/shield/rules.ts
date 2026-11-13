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

// Latin names, including Spanish ones with accents ("José Núñez", "María de la Fuente").
const UP = 'A-ZÁÉÍÓÚÑÜ';
const LOW = "a-zA-Záéíóúñü'\\-";
const NAME = `[${UP}][${LOW}]+(?:[ ](?:[${UP}]\\.|[${UP}][${LOW}]+|(?:de|del|la|y)(?=[ ][${UP}]))){0,4}`;

// Japanese: kanji / kana runs. Names are written family name first, often with a space.
const JA_NAME = '[\\p{Script=Han}々]{1,4}(?:[ 　][\\p{Script=Han}々\\p{Script=Hiragana}\\p{Script=Katakana}ー]{1,5})?';
// Words that come before 様 / 殿 but are not names (お客様, 保護者様, ご担当者様...).
const JA_NOT_NAME = /^(?:お?客|皆|各位|保護者|担当者?|ご?家族|加入者|被保険者|世帯主|利用者|会員|患者|契約者|代表者|関係者|先生|ご?本人|申請者|受給者)$/u;

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

  /* ---------------- Spanish ---------------- */
  { type: 'ID', re: /\b\d{8}[- ]?[A-HJ-NP-TV-Z]\b/g }, // DNI
  { type: 'PHONE', re: /(?:\+34[ ]?)?\b[6789]\d{2}(?:[ ]\d{2}){3}\b/g }, // "963 41 27 90"
  { type: 'ID', re: /\b[XYZ][- ]?\d{7}[- ]?[A-HJ-NP-TV-Z]\b/g }, // NIE
  {
    type: 'ID',
    re: /\b(?:DNI|NIE|NIF|N\.?º? de (?:afiliación|póliza|expediente|cuenta|contrato|cliente|historia clínica)|Número de (?:afiliación|póliza|expediente|cuenta|contrato|cliente|historia clínica)|Expediente|Póliza|Referencia|N\.?º? (?:SS|Seguridad Social)|NUSS|Tarjeta sanitaria)[:#\s]+(?:n\.?º\s*)?([A-Z0-9][A-Z0-9\-\/]{3,})/gi,
    group: 1,
    validate: (v) => /\d/.test(v),
  },
  {
    type: 'ADDRESS',
    re: /\b(?:C\/|Calle|Avda\.?|Avenida|Plaza|Pza\.?|Paseo|Camino|Carretera|Ronda|Travesía)[ ]+(?:(?:de|del|la|las|los|y)[ ]+)*[A-ZÁÉÍÓÚÑ][\wáéíóúñ.]*(?:[ ]+(?:(?:de|del|la|las|los|y)[ ]+)*[A-ZÁÉÍÓÚÑ][\wáéíóúñ.]*){0,4},?[ ]+(?:n\.?º[ ]*)?\d{1,4}(?:[ ,]+\d{1,2}º?[ ]?[A-Z]?)?/g,
  },
  {
    type: 'ORG',
    re: /\b(?:Hospital|Clínica|Centro de Salud|Banco|Ayuntamiento de|Inmobiliaria|Seguros|Mutua)(?:[ ]+(?:(?:de|del|la|las|los|y|San|Santa)[ ]+)*[A-ZÁÉÍÓÚÑ][\wáéíóúñ\-]+){1,4}/g,
  },
  { type: 'ORG', re: /\b(?:[A-ZÁÉÍÓÚÑ][\wáéíóúñ&\-]+[ ]+){1,4}S\.(?:L|A)\.(?:U\.)?/g },
  {
    type: 'PERSON',
    re: new RegExp(`\\b(?:Sr|Sra|Srta|Dr|Dra|D|Dña)\\.[ ]+(${NAME})`, 'g'),
    group: 1,
  },
  {
    type: 'PERSON',
    re: new RegExp(`\\b(?:Don|Doña|Estimado|Estimada|Paciente|Nombre|Titular|Inquilino|Inquilina|Arrendatario|Arrendataria|Firmado|Atentamente|Asegurado|Asegurada|Médico|Médica)[:,]?[ \\n]+(${NAME})`, 'g'),
    group: 1,
  },

  /* ---------------- Japanese ---------------- */
  { type: 'ADDRESS', re: /〒?[ ]?\d{3}-\d{4}/g }, // postal code
  {
    type: 'ADDRESS',
    re: /(?:東京都|北海道|(?:京都|大阪)府|[\p{Script=Han}]{2,3}県)[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々ヶ]{1,20}?(?:[0-9０-９]+(?:丁目|番地?|号|[-‐－ー]))+[0-9０-９]*(?:[ 　]?[\p{Script=Han}\p{Script=Katakana}ー]{1,15}[0-9０-９]{1,5}号?室?)?/gu,
  },
  {
    type: 'DOB',
    re: /生年月日[:：\s]*((?:昭和|平成|令和)?\d{1,4}年\d{1,2}月\d{1,2}日|\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2})/gu,
    group: 1,
  },
  {
    type: 'ID',
    re: /(?:被保険者番号|保険証番号|記号番号|記号・番号|患者ID|患者番号|診察券番号|カルテ番号|契約番号|お客様番号|証券番号|口座番号|個人番号|マイナンバー|受付番号|管理番号|整理番号)[:：\s]*([0-9A-Za-z][0-9A-Za-z\-]{3,})/gu,
    group: 1,
  },
  {
    type: 'ORG',
    re: /(?:(?:株式会社|医療法人(?:社団|財団)?)[\p{Script=Han}\p{Script=Katakana}ー]{1,15}|[\p{Script=Han}\p{Script=Katakana}ー]{2,15}(?:病院|クリニック|医院|診療所|株式会社|銀行|信用金庫|保険|不動産|市役所|区役所|町役場|管理組合))/gu,
    // Generic public schemes ("国民健康保険") are not identifying.
    validate: (v) => !/^(?:当|貴|弊|同|本|各|この|その)/u.test(v) && !/(?:健康|介護|雇用|社会|労災|生命|損害|火災|自動車)保険$/u.test(v),
  },
  {
    type: 'PERSON',
    re: new RegExp(`(?:氏名|お名前|患者氏名|患者名|被保険者氏名|契約者氏名|世帯主|ご契約者|担当医|主治医|担当)[:：\\s　]*(${JA_NAME})`, 'gu'),
    group: 1,
  },
  {
    type: 'PERSON',
    re: new RegExp(`(${JA_NAME})[ 　]?(?:様|さま|殿|先生)`, 'gu'),
    group: 1,
    validate: (v) => !JA_NOT_NAME.test(v.replace(/[ 　]/g, '')),
  },
];

// Words that make a capitalized phrase a department or heading, not a person ("Patient Financial Services", "Patient Billing").
const NOT_NAME_WORDS = new Set(['Billing', 'Financial', 'Services', 'Service', 'Account', 'Accounts', 'Portal', 'Support', 'Relations', 'Center', 'Department', 'Office', 'Unit', 'Statement', 'ID', 'Number']);

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
      if (rule.type === 'PERSON' && (NOT_NAMES.has(value.split(/\s+/)[0]) || value.split(/\s+/).some((w) => NOT_NAME_WORDS.has(w)))) continue;
      const offsetInMatch = g === 0 ? 0 : m[0].indexOf(m[g]);
      const start = (m.index ?? 0) + offsetInMatch;
      spans.push({ start, end: start + value.length, text: value, type: rule.type, detector: 'rules' });
    }
  }
  return spans;
}
