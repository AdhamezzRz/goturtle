/**
 * Egyptian national ID (الرقم القومي) — 14 digits:
 *   C YYMMDD GG SSSS K
 *   C    century (2 = 1900s, 3 = 2000s)
 *   YYMMDD date of birth
 *   GG   governorate of birth (88 = born abroad)
 *   SSSS sequence (the 4th digit is odd for males, even for females)
 *   K    check digit
 */
export const EGYPT_GOVERNORATE_CODES: Readonly<Record<string, string>> = {
  '01': 'Cairo', '02': 'Alexandria', '03': 'Port Said', '04': 'Suez', '11': 'Damietta', '12': 'Dakahlia',
  '13': 'Sharqia', '14': 'Qalyubia', '15': 'Kafr El Sheikh', '16': 'Gharbia', '17': 'Monufia', '18': 'Beheira',
  '19': 'Ismailia', '21': 'Giza', '22': 'Beni Suef', '23': 'Fayoum', '24': 'Minya', '25': 'Assiut', '26': 'Sohag',
  '27': 'Qena', '28': 'Aswan', '29': 'Luxor', '31': 'Red Sea', '32': 'New Valley', '33': 'Matrouh',
  '34': 'North Sinai', '35': 'South Sinai', '88': 'Foreign',
};

export interface NationalIdInfo {
  dateOfBirth: string; // YYYY-MM-DD
  governorate: string;
  gender: 'MALE' | 'FEMALE';
}

/** Parses and validates the structure of an Egyptian national ID; null when invalid. */
export function parseEgyptNationalId(raw: string, today: Date = new Date()): NationalIdInfo | null {
  if (!/^[23]\d{13}$/.test(raw)) return null;
  const century = raw[0] === '2' ? 1900 : 2000;
  const year = century + Number(raw.slice(1, 3));
  const month = Number(raw.slice(3, 5));
  const day = Number(raw.slice(5, 7));
  const dob = new Date(Date.UTC(year, month - 1, day));
  if (dob.getUTCFullYear() !== year || dob.getUTCMonth() !== month - 1 || dob.getUTCDate() !== day) return null;
  if (dob.getTime() > today.getTime()) return null;
  const governorate = EGYPT_GOVERNORATE_CODES[raw.slice(7, 9)];
  if (!governorate) return null;
  return {
    dateOfBirth: dob.toISOString().slice(0, 10),
    governorate,
    gender: Number(raw[12]) % 2 === 1 ? 'MALE' : 'FEMALE',
  };
}

/** Full years between a YYYY-MM-DD birthday and `today`. */
export function ageOn(dateOfBirth: string, today: Date = new Date()): number {
  const [y, m, d] = dateOfBirth.split('-').map(Number);
  let age = today.getUTCFullYear() - y;
  const beforeBirthday = today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d);
  if (beforeBirthday) age--;
  return age;
}

export const MIN_HERO_AGE = 18;
